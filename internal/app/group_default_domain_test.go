package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Catches missing production wiring, stale group writes, leaked defaults and changed legacy creation.
func TestGroupDefaultDomainHTTPContract(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const assigned = "00000000-0000-0000-0000-000000002801"
	_, err := application.pool.Exec(t.Context(), `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at)
		values($1,'https://group.example.com','Group','short_link',true,false,now(),now())`, assigned)
	require.NoError(t, err)
	_, err = application.pool.Exec(t.Context(), `insert into domain_user_group(domain_id,user_group_id) select $1,id from user_group where key in ('user','admin')`, assigned)
	require.NoError(t, err)
	type setting struct {
		GroupKey  string  `json:"groupKey"`
		DomainID  *string `json:"domainId"`
		UpdatedAt string  `json:"updatedAt"`
		Editable  bool    `json:"editable"`
	}
	read := func(key string) setting {
		t.Helper()
		var data struct {
			Setting    setting               `json:"setting"`
			Candidates []struct{ ID string } `json:"candidates"`
		}
		require.NoError(t, json.Unmarshal(groupDefaultRequest(t, application, cookie, "GET", "/api/v1/admin/user-group/domain-default?groupKey="+key, "", "", 0), &data))
		require.Equal(t, key, data.Setting.GroupKey)
		return data.Setting
	}
	write := func(key string, domainID *string, at string, want int) setting {
		t.Helper()
		encoded, err := json.Marshal(domainID)
		require.NoError(t, err)
		body := fmt.Sprintf(`{"groupKey":%q,"domainId":%s,"expectedUpdatedAt":%q}`, key, encoded, at)
		data := groupDefaultRequest(t, application, cookie, "POST", "/api/v1/admin/user-group/set-domain-default", body, "application/json; charset=utf-8", want)
		if want != 0 {
			return setting{}
		}
		var response struct{ Setting setting }
		require.NoError(t, json.Unmarshal(data, &response))
		return response.Setting
	}
	self := func(wantStatus string, wantID *string) {
		t.Helper()
		var response struct {
			Selection struct {
				DomainID *string `json:"domainId"`
				Status   string  `json:"status"`
			} `json:"selection"`
		}
		require.NoError(t, json.Unmarshal(groupDefaultRequest(t, application, cookie, "GET", "/api/v1/domain/group-default", "", "", 0), &response))
		require.Equal(t, wantStatus, response.Selection.Status)
		require.Equal(t, wantID, response.Selection.DomainID)
	}
	initial := read("user")
	require.True(t, initial.Editable)
	require.Nil(t, initial.DomainID)
	selected := assigned
	saved := write("user", &selected, initial.UpdatedAt, 0)
	require.Equal(t, &selected, saved.DomainID)
	require.NotEqual(t, initial.UpdatedAt, saved.UpdatedAt)
	require.Equal(t, saved, read("user"))
	unchanged := write("user", &selected, saved.UpdatedAt, 0)
	require.Equal(t, saved, unchanged)
	write("user", &selected, initial.UpdatedAt, 300202)
	self("not_set", nil)
	admin := read("admin")
	admin = write("admin", &selected, admin.UpdatedAt, 0)
	self("available", &selected)
	// A saved group default does not redefine old callers' omitted-domain semantics.
	var created struct{ ShortLink struct{ URL string } }
	require.NoError(t, json.Unmarshal(groupDefaultRequest(t, application, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://example.com/legacy-group"}`, "application/json", 0), &created))
	require.True(t, strings.HasPrefix(created.ShortLink.URL, "https://go.example.com/"))
	_, err = application.pool.Exec(t.Context(), `delete from domain_user_group where domain_id=$1 and user_group_id=(select id from user_group where key='admin')`, assigned)
	require.NoError(t, err)
	self("unavailable", nil)
	require.Equal(t, &selected, read("admin").DomainID, "management can inspect and clear its saved unavailable UUID")
	write("admin", &selected, admin.UpdatedAt, 120001)
	admin = write("admin", nil, admin.UpdatedAt, 0)
	self("not_set", nil)
	guest := read("guest")
	require.False(t, guest.Editable)
	require.Nil(t, guest.DomainID)
	write("guest", nil, guest.UpdatedAt, 300203)
	for _, query := range []string{"", "?groupKey=", "?groupKey=user&groupKey=admin", "?groupKey=team", "?groupKey=user&extra=x"} {
		groupDefaultRequest(t, application, cookie, "GET", "/api/v1/admin/user-group/domain-default"+query, "", "", 100001)
	}
	groupDefaultRequest(t, application, cookie, "GET", "/api/v1/domain/group-default?groupKey=user", "", "", 100001)
	groupDefaultRequest(t, application, nil, "GET", "/api/v1/domain/group-default", "", "", 120001)
	for _, body := range []string{
		`null`, `{}`, `[]`, `{"groupKey":"admin","domainId":null}`, `{"groupKey":"admin","domainId":null,"expectedUpdatedAt":null}`,
		fmt.Sprintf(`{"groupKey":"admin","domainId":false,"expectedUpdatedAt":%q}`, admin.UpdatedAt),
		fmt.Sprintf(`{"groupKey":"admin","domainId":null,"expectedUpdatedAt":%q,"extra":true}`, admin.UpdatedAt),
		fmt.Sprintf(`{"groupKey":"admin","domainId":null,"expectedUpdatedAt":%q} {}`, admin.UpdatedAt),
	} {
		groupDefaultRequest(t, application, cookie, "POST", "/api/v1/admin/user-group/set-domain-default", body, "application/json", 100001)
	}
	groupDefaultRequest(t, application, cookie, "POST", "/api/v1/admin/user-group/set-domain-default", fmt.Sprintf(`{"groupKey":"admin","domainId":null,"expectedUpdatedAt":%q}`, admin.UpdatedAt), "text/plain", 100001)
	// New domain fields must stay outside the original strict group response.
	var original struct{ Groups []map[string]json.RawMessage }
	require.NoError(t, json.Unmarshal(groupDefaultRequest(t, application, cookie, "GET", "/api/v1/admin/user-group/list", "", "", 0), &original))
	for _, group := range original.Groups {
		require.Len(t, group, 7)
		require.NotContains(t, group, "defaultDomainId")
		require.NotContains(t, group, "default_domain_id")
	}
	// Raw revocation of a protected permission intentionally leaves an invalid legacy catalog row.
	// Test new authorization after the legacy response compatibility check, not through that corrupt catalog.
	_, err = application.pool.Exec(t.Context(), `update user_group set permissions=permissions-'domain:manage' where key='admin'`)
	require.NoError(t, err)
	groupDefaultRequest(t, application, cookie, "GET", "/api/v1/admin/user-group/domain-default?groupKey=user", "", "", 120001)
	write("admin", nil, admin.UpdatedAt, 120001)
}

// groupDefaultRequest checks the actual HTTP envelope, privacy header and error status.
func groupDefaultRequest(t *testing.T, application *App, cookie *http.Cookie, method, path, body, media string, want int) json.RawMessage {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	if cookie != nil {
		r.AddCookie(cookie)
	}
	if media != "" {
		r.Header.Set("Content-Type", media)
	}
	w := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(w, r)
	var result struct {
		Code int
		Data json.RawMessage
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.Equal(t, want, result.Code, "%s %s: %s", method, path, w.Body.String())
	wantStatus := http.StatusOK
	if want == 900000 {
		wantStatus = http.StatusInternalServerError
	}
	require.Equal(t, wantStatus, w.Code)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	return result.Data
}
