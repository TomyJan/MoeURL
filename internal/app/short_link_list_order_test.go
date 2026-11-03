package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestShortLinkListOrderRoutes catches lost deterministic order in ordinary GET and private POST list transport.
func TestShortLinkListOrderRoutes(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	id := func(n int) string { return fmt.Sprintf("04710000-0000-0000-0000-%012x", n) }
	// Equal timestamps must follow UUID order even when rows were inserted in reverse.
	for n := 43; n >= 1; n-- {
		day := 2
		if n >= 22 && n <= 42 {
			day = 1
		}
		if n == 43 {
			day = 3
		}
		_, err := a.pool.Exec(t.Context(), `insert into short_link
			(id,owner_id,domain_id,slug,target_url,status,title,tags,note,created_at,updated_at)
			select $1,u.id,d.id,$2,'https://example.com/order47','active','Order47',array['order47'],'private-order47%_\canary',$3,now()
			from app_user u cross join domain d where u.username='admin' and d.is_default`,
			id(n), fmt.Sprintf("order47x%d", n), time.Date(2026, 11, day, 0, 0, 0, 0, time.UTC))
		require.NoError(t, err)
	}
	// Independent known day groups, including larger IDs that must remain in the older group.
	numbers := []int{43, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
		42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22}
	want := make([]string, len(numbers))
	for i, n := range numbers {
		want[i] = id(n)
	}
	for _, prefix := range []string{"/api/v1/short-link", "/api/v1/admin/short-link"} {
		for _, private := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/private=%t", prefix, private), func(t *testing.T) {
				for _, page := range []int{1, 2, 3, 4, 3, 1, 2} {
					path := fmt.Sprintf("%s/list?page=%d&pageSize=20&status=active&q=Order47&tag=order47", prefix, page)
					r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
					if private {
						body, err := json.Marshal(map[string]any{"page": page, "pageSize": 20, "status": "active", "q": "Order47", "tag": "order47", "noteStatus": "present", "noteQuery": `%_\`})
						require.NoError(t, err)
						r = httptest.NewRequestWithContext(t.Context(), http.MethodPost, prefix+"/note/search", strings.NewReader(string(body)))
						r.Header.Set("Content-Type", "application/json")
					}
					r.AddCookie(cookie)
					w := httptest.NewRecorder()
					a.server.Handler.ServeHTTP(w, r)
					require.Equal(t, http.StatusOK, w.Code, w.Body.String())
					require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
					require.NotContains(t, w.Body.String(), "private-order47")
					require.NotContains(t, w.Body.String(), "noteQuery")
					var response struct {
						Code int `json:"code"`
						Data struct {
							Items []map[string]json.RawMessage `json:"items"`
						} `json:"data"`
						Meta struct {
							Page, PageSize, Total int
						} `json:"meta"`
					}
					require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
					require.Zero(t, response.Code, w.Body.String())
					require.Equal(t, page, response.Meta.Page)
					require.Equal(t, 20, response.Meta.PageSize)
					require.Equal(t, 43, response.Meta.Total)
					got := []string{}
					for _, item := range response.Data.Items {
						var itemID string
						require.NoError(t, json.Unmarshal(item["id"], &itemID))
						got = append(got, itemID)
						for _, field := range []string{"note", "noteUpdatedAt", "hasNote", "noteQuery"} {
							require.NotContains(t, item, field)
						}
					}
					start := min((page-1)*20, len(want))
					require.Equal(t, want[start:min(start+20, len(want))], got, "page %d", page)
				}
			})
		}
	}
}
