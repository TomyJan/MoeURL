package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"
)

// TestAppDomainOrderLists catches creation-time ordering overriding configured
// priorities, lost default precedence, and unauthorized choices leaking out.
func TestAppDomainOrderLists(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	var defaultID string
	if err := application.pool.QueryRow(t.Context(), `select id::text from domain where is_default`).Scan(&defaultID); err != nil {
		t.Fatal(err)
	}
	const later = "00000000-0000-0000-0000-000000007271"
	const first = "00000000-0000-0000-0000-000000007272"
	const tied = "00000000-0000-0000-0000-000000007273"
	const hidden = "00000000-0000-0000-0000-000000007274"
	if _, err := application.pool.Exec(t.Context(), `update domain set sort_order=10000 where is_default`); err != nil {
		t.Fatal(err)
	}
	if _, err := application.pool.Exec(t.Context(), `
		insert into domain(id,host,display_name,purpose,enabled,is_default,sort_order,created_at,updated_at) values
		($1,'https://later.example.com','Later','short_link',true,false,20,'2020-01-01T00:00:00Z',now()),
		($2,'https://first.example.com','First','short_link',true,false,-20,'2021-01-01T00:00:00Z',now()),
		($3,'https://tied.example.com','Tied','short_link',true,false,-20,'2021-01-01T00:00:00Z',now()),
		($4,'https://hidden.example.com','Hidden','short_link',true,false,-10000,'2022-01-01T00:00:00Z',now());
	`, later, first, tied, hidden); err != nil {
		t.Fatal(err)
	}
	if _, err := application.pool.Exec(t.Context(), `insert into domain_user_group(domain_id,user_group_id) select d.id,g.id from domain d cross join user_group g where d.id=any($1::uuid[]) and g.key='admin'`, []string{later, first, tied}); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		path string
		want []string
	}{
		{"/api/v1/admin/domain/list", []string{defaultID, hidden, first, tied, later}},
		{"/api/v1/domain/available", []string{defaultID, first, tied, later}},
	} {
		t.Run(check.path, func(t *testing.T) {
			result := domainOrderRequest(t, application, cookie, http.MethodGet, check.path, "")
			var items struct {
				Items []struct {
					ID        string `json:"id"`
					SortOrder *int32 `json:"sortOrder"`
				} `json:"items"`
			}
			if err := json.Unmarshal(result, &items); err != nil {
				t.Fatal(err)
			}
			var actual []string
			for _, item := range items.Items {
				actual = append(actual, item.ID)
				if check.path == "/api/v1/domain/available" && item.SortOrder != nil {
					t.Fatal("available projection leaked private ordering metadata")
				}
			}
			if !slices.Equal(actual, check.want) {
				t.Fatalf("authorized stable order: got %v want %v", actual, check.want)
			}
			if check.path == "/api/v1/admin/domain/list" && (items.Items[0].SortOrder == nil || *items.Items[0].SortOrder != 10000) {
				t.Fatal("managed domain must expose its persisted order")
			}
		})
	}
}

// TestAppDomainOrderContract catches a missing production route or service and
// a response that does not persist only the requested order with a new revision.
func TestAppDomainOrderContract(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	var id string
	var revision time.Time
	if err := application.pool.QueryRow(t.Context(), `select id::text,updated_at from domain where is_default`).Scan(&id, &revision); err != nil {
		t.Fatal(err)
	}
	result := domainOrderRequest(t, application, cookie, http.MethodPost, "/api/v1/admin/domain/set-order", fmt.Sprintf(`{"id":%q,"sortOrder":-20,"expectedUpdatedAt":%q}`, id, revision.UTC().Format(time.RFC3339Nano)))
	var body struct {
		Domain struct {
			ID        string `json:"id"`
			SortOrder *int32 `json:"sortOrder"`
			UpdatedAt string `json:"updatedAt"`
		} `json:"domain"`
	}
	if err := json.Unmarshal(result, &body); err != nil {
		t.Fatal(err)
	}
	if body.Domain.ID != id || body.Domain.SortOrder == nil || *body.Domain.SortOrder != -20 || body.Domain.UpdatedAt == revision.UTC().Format(time.RFC3339Nano) {
		t.Fatalf("order response did not persist and advance: %#v", body.Domain)
	}
	var persisted int32
	if err := application.pool.QueryRow(t.Context(), `select sort_order from domain where id=$1`, id).Scan(&persisted); err != nil || persisted != -20 {
		t.Fatalf("order not persisted: %d %v", persisted, err)
	}
}

// domainOrderLogin uses the synthetic account created in each isolated App fixture.
func domainOrderLogin(t *testing.T, application *App) *http.Cookie {
	t.Helper()
	w := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"admin","password":"secure-password"}`))
	r.Header.Set("Content-Type", "application/json")
	application.server.Handler.ServeHTTP(w, r)
	if cookies := w.Result().Cookies(); w.Code == http.StatusOK && len(cookies) == 1 {
		return cookies[0]
	}
	t.Fatalf("isolated account login failed: HTTP%d", w.Code)
	return nil
}

// domainOrderRequest exercises the real app boundary and rejects cacheable or failed responses.
func domainOrderRequest(t *testing.T, application *App, cookie *http.Cookie, method, path, body string) json.RawMessage {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(w, r)
	var result struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Code != 0 || w.Code != http.StatusOK {
		t.Fatalf("%s %s: HTTP%d code=%d decode=%v body=%s", method, path, w.Code, result.Code, err, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("domain response may be cached")
	}
	return result.Data
}
