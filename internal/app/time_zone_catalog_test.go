package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// TestAppTimeZoneCatalog catches a stale preset validator, persistence that changes
// a selected identifier, lost CAS, or collateral writes to the account document.
func TestAppTimeZoneCatalog(t *testing.T) {
	application := newTestApplication(t)
	login := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(login, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"admin","password":"secure-password"}`)))
	cookies := login.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("login: HTTP=%d body=%s", login.Code, login.Body.String())
	}
	type preference struct {
		TimeZone  *string `json:"timeZone"`
		UpdatedAt *string `json:"updatedAt"`
	}
	call := func(method string, zone, version *string, want int, authenticated bool) preference {
		t.Helper()
		path, body := "/api/v1/user/time-zone-preference", ""
		if method == http.MethodPost {
			path += "/update"
			encoded, err := json.Marshal(map[string]*string{"timeZone": zone, "expectedUpdatedAt": version})
			if err != nil {
				t.Fatal(err)
			}
			body = string(encoded)
		}
		r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if authenticated {
			r.AddCookie(cookies[0])
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
			t.Fatalf("zone=%v HTTP=%d code=%d want=%d err=%v body=%s", zone, w.Code, result.Code, want, err, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private time-zone response is cacheable")
		}
		return result.Data.Preference
	}
	const snapshot = `select jsonb_build_object('users',(select jsonb_agg(to_jsonb(u) order by id) from app_user u),'interface',(select jsonb_agg(to_jsonb(p) order by user_id) from user_preference p),'domain',(select jsonb_agg(to_jsonb(p) order by user_id) from user_domain_preference p))::text`
	var before string
	if err := application.pool.QueryRow(t.Context(), snapshot).Scan(&before); err != nil {
		t.Fatal(err)
	}
	var current *string
	save := func(zone *string) {
		t.Helper()
		old := current
		got := call(http.MethodPost, zone, old, 0, true)
		if got.UpdatedAt == nil || (zone == nil) != (got.TimeZone == nil) || (zone != nil && *zone != *got.TimeZone) {
			t.Fatalf("saved identifier or revision differs: input=%v response=%#v", zone, got)
		}
		read := call(http.MethodGet, nil, nil, 0, true)
		if read.UpdatedAt == nil || *read.UpdatedAt != *got.UpdatedAt || (zone == nil) != (read.TimeZone == nil) || (zone != nil && *zone != *read.TimeZone) {
			t.Fatalf("persisted value differs: %#v", read)
		}
		if old != nil {
			previous, err := time.Parse(time.RFC3339Nano, *old)
			if err != nil {
				t.Fatal(err)
			}
			next, err := time.Parse(time.RFC3339Nano, *got.UpdatedAt)
			if err != nil || !next.After(previous) {
				t.Fatalf("revision did not increase: %v %v %v", previous, next, err)
			}
		}
		call(http.MethodPost, zone, old, 300104, true)
		current = got.UpdatedAt
	}
	for _, zone := range []string{"Pacific/Chatham", "Asia/Katmandu"} {
		save(&zone)
	}
	// Read the independent public source contract, then prove each choice survives
	// the complete production service and PostgreSQL constraint, not just a map lookup.
	raw, err := os.ReadFile("../user/time_zone_catalog_v0600.json")
	if err != nil {
		t.Fatal(err)
	}
	var zones []string
	if err := json.Unmarshal(raw, &zones); err != nil {
		t.Fatal(err)
	}
	for _, zone := range zones {
		save(&zone)
	}
	for _, zone := range []string{"", "utc", " UTC", "UTC ", "Etc/UTC", "Asia/Kathmandu", "../Asia/Tokyo", "/etc/localtime", "UTC+08:00", "Invalid/Zone"} {
		call(http.MethodPost, &zone, current, 100001, true)
	}
	zone := "Pacific/Chatham"
	call(http.MethodPost, &zone, current, 120001, false)
	save(nil)
	var after string
	if err := application.pool.QueryRow(t.Context(), snapshot).Scan(&after); err != nil || before != after {
		t.Fatalf("unrelated account or preference changed: %s / %s %v", before, after, err)
	}
}
