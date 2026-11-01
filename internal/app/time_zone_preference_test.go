package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

// TestAppTimeZonePreferenceContract catches missing production routes, permissive JSON,
// lost account isolation, imprecise CAS and writes to unrelated account preferences.
func TestAppTimeZonePreferenceContract(t *testing.T) {
	application := newTestApplication(t)
	login := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(login, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"admin","password":"secure-password"}`)))
	cookies := login.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("login session: HTTP %d body=%s", login.Code, login.Body.String())
	}
	type preference struct {
		TimeZone  *string `json:"timeZone"`
		UpdatedAt *string `json:"updatedAt"`
	}
	request := func(method, path, body, media string, authenticated bool, want int) preference {
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
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != http.StatusOK || result.Code != want {
			t.Fatalf("%s %s HTTP=%d code=%d want=%d err=%v body=%s", method, path, w.Code, result.Code, want, err, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("cacheable private response: %v", w.Header())
		}
		if want == 0 {
			var raw map[string]json.RawMessage
			if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
				t.Fatal(err)
			}
			var data map[string]json.RawMessage
			if err := json.Unmarshal(raw["data"], &data); err != nil || len(data) != 1 {
				t.Fatalf("unexpected data: %s %v", raw["data"], err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(data["preference"], &fields); err != nil || len(fields) != 2 || fields["timeZone"] == nil || fields["updatedAt"] == nil {
				t.Fatalf("unexpected preference fields: %s %v", data["preference"], err)
			}
		}
		return result.Data.Preference
	}
	const readPath = "/api/v1/user/time-zone-preference"
	const writePath = readPath + "/update"
	unset := request(http.MethodGet, readPath, "", "", true, 0)
	if unset.TimeZone != nil || unset.UpdatedAt != nil {
		t.Fatalf("unset preference: %#v", unset)
	}
	request(http.MethodGet, readPath, "", "", false, 120001)
	var before string
	const oldSnapshot = `select jsonb_build_object('users',(select jsonb_agg(to_jsonb(u) order by id) from app_user u),'interface',(select jsonb_agg(to_jsonb(p) order by user_id) from user_preference p),'domain',(select jsonb_agg(to_jsonb(p) order by user_id) from user_domain_preference p))::text`
	if err := application.pool.QueryRow(t.Context(), oldSnapshot).Scan(&before); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{"", `{`, `null`, `[]`, `{}`, `{"timeZone":null}`, `{"expectedUpdatedAt":null}`, `{"timeZone":3,"expectedUpdatedAt":null}`, `{"timeZone":null,"expectedUpdatedAt":false}`, `{"timeZone":null,"expectedUpdatedAt":null,"userId":"other"}`, `{"timeZone":null,"expectedUpdatedAt":null} {}`, `{"timeZone":null,"expectedUpdatedAt":null} garbage`, `{"timeZone":null,"timeZone":"UTC","expectedUpdatedAt":null}`, `{"timeZone":null,"expectedUpdatedAt":null,"expectedUpdatedAt":null}`, `{"TimeZone":null,"expectedUpdatedAt":null}`, `{"timeZone":"utc","expectedUpdatedAt":null}`, `{"timeZone":" UTC","expectedUpdatedAt":null}`, `{"timeZone":"UTC ","expectedUpdatedAt":null}`, `{"timeZone":"Etc/UTC","expectedUpdatedAt":null}`, `{"timeZone":null,"expectedUpdatedAt":"invalid"}`, `{"timeZone":null,"expectedUpdatedAt":"2026-01-01T00:00:00.1234567891Z"}`, `{"timeZone":null,"expectedUpdatedAt":"0001-01-01T00:00:00Z"}`} {
		request(http.MethodPost, writePath, body, "application/json", true, 100001)
	}
	for _, media := range []string{"", "text/plain", "application/x-www-form-urlencoded", "application/json; broken"} {
		request(http.MethodPost, writePath, `{"timeZone":null,"expectedUpdatedAt":null}`, media, true, 100001)
	}
	request(http.MethodPost, writePath, `{"timeZone":null,"expectedUpdatedAt":null}`, "application/json", false, 120001)
	write := func(zone, version *string, want int) preference {
		t.Helper()
		body, err := json.Marshal(map[string]*string{"timeZone": zone, "expectedUpdatedAt": version})
		if err != nil {
			t.Fatal(err)
		}
		return request(http.MethodPost, writePath, string(body), "application/json; charset=utf-8", true, want)
	}
	first := write(nil, nil, 0)
	if first.TimeZone != nil || first.UpdatedAt == nil {
		t.Fatalf("first clear has no revision: %#v", first)
	}
	write(nil, nil, 300104)
	current := first
	for _, zone := range []string{"UTC", "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney"} {
		saved := write(&zone, current.UpdatedAt, 0)
		if saved.TimeZone == nil || *saved.TimeZone != zone || saved.UpdatedAt == nil {
			t.Fatalf("save %s: %#v", zone, saved)
		}
		oldTime, err := time.Parse(time.RFC3339Nano, *current.UpdatedAt)
		if err != nil {
			t.Fatal(err)
		}
		newTime, err := time.Parse(time.RFC3339Nano, *saved.UpdatedAt)
		if err != nil || !newTime.After(oldTime) {
			t.Fatalf("non-increasing version %v %v %v", oldTime, newTime, err)
		}
		if got := request(http.MethodGet, readPath, "", "", true, 0); !reflect.DeepEqual(got, saved) {
			t.Fatalf("persisted mismatch: %#v %#v", got, saved)
		}
		write(nil, current.UpdatedAt, 300104)
		badVersion := newTime.Add(time.Nanosecond).Format(time.RFC3339Nano)
		write(nil, &badVersion, 300104)
		current = saved
	}
	cleared := write(nil, current.UpdatedAt, 0)
	if cleared.TimeZone != nil || cleared.UpdatedAt == nil {
		t.Fatalf("clear: %#v", cleared)
	}
	var after string
	if err := application.pool.QueryRow(t.Context(), oldSnapshot).Scan(&after); err != nil || before != after {
		t.Fatalf("unrelated account or preference changed: before=%s after=%s err=%v", before, after, err)
	}
}
