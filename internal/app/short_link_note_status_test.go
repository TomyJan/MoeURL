package app

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestShortLinkNoteStatusHTTP catches an ignored filter, count drift and private fields in list responses.
func TestShortLinkNoteStatusHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var owner string
	require.NoError(t, a.pool.QueryRow(t.Context(), "select id::text from app_user where username='admin'").Scan(&owner))
	for _, fixture := range []struct{ slug, note string }{
		{"filterwithnote", "private-canary-not-for-list"},
		{"filterwithoutnote", ""},
		{"filterbomnote", "\ufeff"},
	} {
		_, err := a.pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,note,created_at,updated_at)
			select gen_random_uuid(),$1,d.id,$2,'https://example.com/filter','active',$3,now(),now() from domain d where is_default`, owner, fixture.slug, fixture.note)
		require.NoError(t, err)
	}
	for _, prefix := range []string{"/api/v1/short-link", "/api/v1/admin/short-link"} {
		for _, tc := range []struct {
			status string
			want   []string
		}{
			{"present", []string{"filterwithnote", "filterbomnote"}},
			{"absent", []string{"filterwithoutnote"}},
		} {
			t.Run(prefix+"/"+tc.status, func(t *testing.T) {
				r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, prefix+"/list?noteStatus="+tc.status, nil)
				r.AddCookie(cookie)
				w := httptest.NewRecorder()
				a.server.Handler.ServeHTTP(w, r)
				require.Equal(t, http.StatusOK, w.Code, w.Body.String())
				var body struct {
					Code int `json:"code"`
					Data struct {
						Items []map[string]json.RawMessage `json:"items"`
					} `json:"data"`
					Meta struct {
						Total int64 `json:"total"`
					} `json:"meta"`
				}
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
				require.Zero(t, body.Code, w.Body.String())
				got := make([]string, 0, len(body.Data.Items))
				for _, item := range body.Data.Items {
					var slug string
					require.NoError(t, json.Unmarshal(item["slug"], &slug))
					got = append(got, slug)
					for _, field := range []string{"note", "noteUpdatedAt", "hasNote", "noteStatus"} {
						require.NotContains(t, item, field)
					}
				}
				require.NotContains(t, w.Body.String(), "private-canary-not-for-list")
				require.ElementsMatch(t, tc.want, got)
				require.Equal(t, int64(len(tc.want)), body.Meta.Total, fmt.Sprintf("filtered total for %s", tc.status))
			})
		}
	}
}

// TestShortLinkNoteStatusInvalidHTTP catches ambiguous new filters accepted as ordinary lists.
func TestShortLinkNoteStatusInvalidHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, prefix := range []string{"/api/v1/short-link", "/api/v1/admin/short-link"} {
		for _, query := range []string{"noteStatus=Present", "noteStatus=present%20", "noteStatus=all", "noteStatus=present&noteStatus=absent", "noteStatus", "noteStatus=%zz"} {
			t.Run(prefix+"/"+query, func(t *testing.T) {
				r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, prefix+"/list?"+query, nil)
				r.AddCookie(cookie)
				w := httptest.NewRecorder()
				a.server.Handler.ServeHTTP(w, r)
				require.Equal(t, http.StatusOK, w.Code)
				var body struct {
					Code int `json:"code"`
				}
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
				require.Equal(t, 100001, body.Code, w.Body.String())
			})
		}
	}
}

// TestShortLinkNoteStatusExportHTTP catches filtering after export limits or leaking private text into CSV.
func TestShortLinkNoteStatusExportHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,note,created_at,updated_at)
		select gen_random_uuid(),u.id,d.id,'exportfilter'||g.n,'https://example.com','active',case when g.n=1 then 'export-private-canary' else '' end,now(),now()
		from app_user u cross join domain d cross join generate_series(1,1002) g(n) where u.username='admin' and d.is_default`)
	require.NoError(t, err)
	for _, prefix := range []string{"/api/v1/short-link", "/api/v1/admin/short-link"} {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, prefix+"/export?noteStatus=present", nil)
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		a.server.Handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var body struct {
			Code int `json:"code"`
			Data struct {
				Content string `json:"content"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Zero(t, body.Code, w.Body.String())
		require.NotContains(t, body.Data.Content, "export-private-canary")
		records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(body.Data.Content, "\ufeff"))).ReadAll()
		require.NoError(t, err)
		require.Len(t, records, 2)
		require.Len(t, records[0], 17)
		require.Equal(t, "exportfilter1", records[1][2])
	}
}
