package app

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestShortLinkNoteSearchRoutes catches ignored private keywords and accidental note disclosure.
func TestShortLinkNoteSearchRoutes(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, fixture := range []struct{ slug, note string }{
		{"searchmatched", "private-needle%_\\-canary"},
		{"searchwildcard", "private-needleXYZ-canary"},
		{"searchempty", ""},
	} {
		_, err := a.pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,note,created_at,updated_at)
			select gen_random_uuid(),u.id,d.id,$1,'https://example.com/note-search','active',$2,now(),now()
			from app_user u cross join domain d where u.username='admin' and d.is_default`, fixture.slug, fixture.note)
		require.NoError(t, err)
	}
	for _, prefix := range []string{"/api/v1/short-link", "/api/v1/admin/short-link"} {
		for _, export := range []bool{false, true} {
			endpoint := prefix + "/note/search"
			body := map[string]any{"status": "", "q": "", "tag": "", "noteStatus": "present", "noteQuery": "NEEDLE%_\\"}
			if export {
				endpoint += "/export"
			} else {
				body["page"], body["pageSize"] = 1, 20
			}
			t.Run(endpoint, func(t *testing.T) {
				raw, err := json.Marshal(body)
				require.NoError(t, err)
				r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, endpoint, strings.NewReader(string(raw)))
				r.Header.Set("Content-Type", "application/json")
				r.AddCookie(cookie)
				w := httptest.NewRecorder()
				a.server.Handler.ServeHTTP(w, r)
				require.Equal(t, http.StatusOK, w.Code, w.Body.String())
				var response struct {
					Code int `json:"code"`
					Data struct {
						Items   []map[string]json.RawMessage `json:"items"`
						Content string                       `json:"content"`
					} `json:"data"`
					Meta struct {
						Total int64 `json:"total"`
					} `json:"meta"`
				}
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
				require.Zero(t, response.Code, w.Body.String())
				require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
				require.NotContains(t, w.Body.String(), "private-needle")
				require.NotContains(t, w.Body.String(), "noteQuery")
				if export {
					records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(response.Data.Content, "\ufeff"))).ReadAll()
					require.NoError(t, err)
					require.Len(t, records, 2)
					require.Len(t, records[0], 17)
					require.Equal(t, "searchmatched", records[1][2])
				} else {
					require.Equal(t, int64(1), response.Meta.Total)
					require.Len(t, response.Data.Items, 1)
					require.JSONEq(t, `"searchmatched"`, string(response.Data.Items[0]["slug"]))
					for _, field := range []string{"note", "noteUpdatedAt", "hasNote", "noteQuery"} {
						require.NotContains(t, response.Data.Items[0], field)
					}
				}
			})
		}
	}
}

// TestNoteSearchStrictRequest catches permissive JSON, Unicode and pagination framing at real endpoints.
func TestNoteSearchStrictRequest(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	valid := `{"page":1,"pageSize":20,"status":"","q":"","tag":"","noteStatus":"","noteQuery":""}`
	for _, tc := range []struct {
		name, body string
		code       int
	}{
		{"empty", valid, 0},
		{"max-page", strings.Replace(valid, `"page":1,"pageSize":20`, `"page":2147483647,"pageSize":1`, 1), 0},
		{"page-overflow", strings.Replace(valid, `"page":1,"pageSize":20`, `"page":2147483648,"pageSize":1`, 1), 100001},
		{"offset-overflow", strings.Replace(valid, `"page":1`, `"page":2147483649`, 1), 100001},
		{"fraction", strings.Replace(valid, `"page":1`, `"page":1.0`, 1), 100001},
		{"exponent", strings.Replace(valid, `"page":1`, `"page":1e0`, 1), 100001},
		{"negative-zero", strings.Replace(valid, `"page":1`, `"page":-0`, 1), 100001},
		{"string-number", strings.Replace(valid, `"page":1`, `"page":"1"`, 1), 100001},
		{"missing", strings.Replace(valid, `"page":1,`, "", 1), 100001},
		{"extra", strings.Replace(valid, `"page":1`, `"unknown":0,"page":1`, 1), 100001},
		{"duplicate", strings.Replace(valid, `"page":1`, `"page":1,"page":1`, 1), 100001},
		{"null", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":null`, 1), 100001},
		{"surrogate", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"\ud800"`, 1), 100001},
		{"low-surrogate", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"\udfff"`, 1), 100001},
		{"bad-utf8", strings.Replace(valid, `"noteQuery":""`, "\"noteQuery\":\""+string([]byte{0xff})+"\"", 1), 100001},
		{"edge-tab", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"\t x"`, 1), 100001},
		{"edge-nel", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"\u0085x"`, 1), 100001},
		{"blank-long", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"`+strings.Repeat(" ", 200)+`"`, 1), 0},
		{"hundred", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"`+strings.Repeat(`\ud83d\ude00`, 100)+`"`, 1), 0},
		{"hundred-one", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"`+strings.Repeat(`\ud83d\ude00`, 101)+`"`, 1), 100001},
		{"bom-kept", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"\ufeff"`, 1), 0},
		{"trimmed", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"\u2003test\u3000"`, 1), 0},
		{"oversized", strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"`+strings.Repeat(" ", 16384)+`"`, 1), 100001},
		{"trailing", valid + ` {}`, 100001},
		{"array", `[]`, 100001},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/note/search", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(cookie)
			w := httptest.NewRecorder()
			a.server.Handler.ServeHTTP(w, r)
			var result struct {
				Code int `json:"code"`
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
			require.Equal(t, tc.code, result.Code, w.Body.String())
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		})
	}
}
