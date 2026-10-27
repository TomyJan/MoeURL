package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestAppDomainPreferenceContract catches missing production wiring, lost account isolation,
// stale writes and unauthorized domain choices through the real HTTP/SQL boundary.
func TestAppDomainPreferenceContract(t *testing.T) {
	application := newTestApplication(t)
	login := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(login, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"admin","password":"secure-password"}`)))
	cookies := login.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("login did not establish a session: HTTP %d", login.Code)
	}
	type preference struct {
		DomainID  *string `json:"domainId"`
		UpdatedAt *string `json:"updatedAt"`
	}
	request := func(method, path, body, media string, authenticated bool, wantCode int) preference {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
		if authenticated {
			r.AddCookie(cookies[0])
		}
		if media != "" {
			r.Header.Set("Content-Type", media)
		}
		w := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(w, r)
		var result struct {
			Code int `json:"code"`
			Data struct {
				Preference preference `json:"preference"`
			} `json:"data"`
		}
		if w.Code != http.StatusOK {
			t.Fatalf("%s %s returned HTTP %d, body=%s", method, path, w.Code, w.Body.String())
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Code != wantCode {
			t.Fatalf("%s %s code=%d want=%d decode=%v body=%s", method, path, result.Code, wantCode, err, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("private preference response may be cached: %s", w.Header().Get("Cache-Control"))
		}
		return result.Data.Preference
	}
	const readPath = "/api/v1/user/domain-preference"
	const writePath = readPath + "/update"
	request(http.MethodGet, readPath, "", "", false, 120001)
	unset := request(http.MethodGet, readPath, "", "", true, 0)
	if unset.DomainID != nil || unset.UpdatedAt != nil {
		t.Fatalf("unset preference: %#v", unset)
	}
	for _, body := range []string{"", `{`, `null`, `[]`, `{}`, `{"domainId":null}`, `{"expectedUpdatedAt":null}`, `{"domainId":2,"expectedUpdatedAt":null}`, `{"domainId":null,"expectedUpdatedAt":2}`, `{"domainId":null,"expectedUpdatedAt":null,"userId":"other"}`, `{"domainId":null,"expectedUpdatedAt":null} {}`, `{"domainId":null,"expectedUpdatedAt":null} garbage`, `{"domainId":"00000000-0000-0000-0000-000000000000","expectedUpdatedAt":null}`, `{"domainId":null,"expectedUpdatedAt":"invalid"}`, `{"domainId":null,"expectedUpdatedAt":"2026-10-20T00:00:00.1234567891Z"}`} {
		request(http.MethodPost, writePath, body, "application/json", true, 100001)
	}
	for _, media := range []string{"", "text/plain", "application/x-www-form-urlencoded", "application/json; broken"} {
		request(http.MethodPost, writePath, `{"domainId":null,"expectedUpdatedAt":null}`, media, true, 100001)
	}
	request(http.MethodPost, writePath, `{"domainId":null,"expectedUpdatedAt":null}`, "application/json", false, 120001)
	first := request(http.MethodPost, writePath, `{"domainId":null,"expectedUpdatedAt":null}`, "application/json;charset=utf-8", true, 0)
	if first.DomainID != nil || first.UpdatedAt == nil {
		t.Fatalf("first explicit clear must establish a concurrency version: %#v", first)
	}
	request(http.MethodPost, writePath, `{"domainId":null,"expectedUpdatedAt":null}`, "application/json", true, 300104)
	var domainID string
	if err := application.pool.QueryRow(t.Context(), `select id::text from domain where is_default and purpose='short_link'`).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	write := func(id, version *string, code int) preference {
		t.Helper()
		body, err := json.Marshal(map[string]*string{"domainId": id, "expectedUpdatedAt": version})
		if err != nil {
			t.Fatal(err)
		}
		return request(http.MethodPost, writePath, string(body), "application/json", true, code)
	}
	saved := write(&domainID, first.UpdatedAt, 0)
	if saved.DomainID == nil || *saved.DomainID != domainID || saved.UpdatedAt == nil || *saved.UpdatedAt == *first.UpdatedAt {
		t.Fatalf("save did not preserve the chosen domain and advance its version: %#v", saved)
	}
	read := request(http.MethodGet, readPath, "", "", true, 0)
	if read.DomainID == nil || *read.DomainID != domainID || read.UpdatedAt == nil || *read.UpdatedAt != *saved.UpdatedAt {
		t.Fatalf("persisted preference: %#v", read)
	}
	write(nil, first.UpdatedAt, 300104)
	parsed, err := time.Parse(time.RFC3339Nano, *saved.UpdatedAt)
	if err != nil {
		t.Fatal(err)
	}
	nanosecondVersion := parsed.Add(time.Nanosecond).Format(time.RFC3339Nano)
	write(nil, &nanosecondVersion, 300104)
	// Revoking use permission must stop a specified save while still allowing personal cleanup.
	if _, err := application.pool.Exec(t.Context(), `update user_group set permissions=permissions-'domain:use_default' where key='admin'`); err != nil {
		t.Fatal(err)
	}
	write(&domainID, saved.UpdatedAt, 120001)
	request(http.MethodGet, readPath, "", "", true, 0)
	cleared := write(nil, saved.UpdatedAt, 0)
	if cleared.DomainID != nil || cleared.UpdatedAt == nil {
		t.Fatalf("cleanup after revocation: %#v", cleared)
	}
	// Saving the independent preference cannot create a language/theme revision as a side effect.
	var interfaceRows int
	if err := application.pool.QueryRow(t.Context(), `select count(*) from user_preference`).Scan(&interfaceRows); err != nil || interfaceRows != 0 {
		t.Fatalf("domain preference touched language/theme: count=%d err=%v", interfaceRows, err)
	}
	for _, id := range []string{"00000000-0000-0000-0000-000000000999", domainID} {
		write(&id, cleared.UpdatedAt, 120001)
	}
	var selected *string
	if err := application.pool.QueryRow(t.Context(), `select domain_id::text from user_domain_preference`).Scan(&selected); err != nil || selected != nil {
		t.Fatalf("denied requests modified stored selection: %v %v", selected, err)
	}
	if _, err := application.pool.Exec(t.Context(), `update app_user set status='disabled' where username='admin'`); err != nil {
		t.Fatal(err)
	}
	request(http.MethodGet, readPath, "", "", true, 120001)
	request(http.MethodPost, writePath, fmt.Sprintf(`{"domainId":null,"expectedUpdatedAt":%q}`, *cleared.UpdatedAt), "application/json", true, 120001)
}

// TestAppDomainPreferencePreservesCreateAPI checks that account defaults cannot redefine legacy request semantics.
func TestAppDomainPreferencePreservesCreateAPI(t *testing.T) {
	application := newTestApplication(t)
	login := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(login, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"admin","password":"secure-password"}`)))
	cookies := login.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("login did not establish a session")
	}
	const assignedID = "00000000-0000-0000-0000-000000000726"
	if _, err := application.pool.Exec(t.Context(), `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values($1,'https://personal.example.com','Personal','short_link',true,false,now(),now())`, assignedID); err != nil {
		t.Fatal(err)
	}
	if _, err := application.pool.Exec(t.Context(), `insert into domain_user_group(domain_id,user_group_id) select $1,id from user_group where key='admin'`, assignedID); err != nil {
		t.Fatal(err)
	}
	post := func(path, body string, want int) json.RawMessage {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(cookies[0])
		w := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(w, r)
		var result struct {
			Code int
			Data json.RawMessage
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Code != want || w.Code != 200 {
			t.Fatalf("%s result=%s error=%v", path, w.Body.String(), err)
		}
		return result.Data
	}
	post("/api/v1/user/domain-preference/update", `{"domainId":"`+assignedID+`","expectedUpdatedAt":null}`, 0)
	for _, tc := range []struct{ body, prefix string }{
		{`{"targetUrl":"https://example.com/legacy"}`, "https://go.example.com/"},
		{`{"targetUrl":"https://example.com/explicit","domainId":"` + assignedID + `"}`, "https://personal.example.com/"},
	} {
		var created struct {
			ShortLink struct{ URL string }
		}
		if err := json.Unmarshal(post("/api/v1/short-link/create", tc.body, 0), &created); err != nil || !strings.HasPrefix(created.ShortLink.URL, tc.prefix) {
			t.Fatalf("legacy create semantics changed: url=%s wantPrefix=%s decode=%v", created.ShortLink.URL, tc.prefix, err)
		}
	}
	var defaultID string
	if err := application.pool.QueryRow(t.Context(), `select id::text from domain where is_default and purpose='short_link'`).Scan(&defaultID); err != nil {
		t.Fatal(err)
	}
	post("/api/v1/short-link/create", `{"targetUrl":"https://example.com/invalid-explicit","domainId":"`+defaultID+`"}`, 200114)
}
