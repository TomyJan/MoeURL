package http_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBulkCreateTitlesRouter persists visible titles through the real session, permissions and atomic write.
func TestBulkCreateTitlesRouter(t *testing.T) {
	for _, name := range []string{
		"titles and receipt persist atomically",
		"framing and invalid metadata never write",
		"cookie identity and guest cannot write",
		"cross protocol key reuse conflicts in both directions",
		"revoked metadata denies empty titles and replay but not legacy",
	} {
		t.Run(name, func(t *testing.T) { runBulkCreateTitlesRouterCase(t, name) })
	}
}

// runBulkCreateTitlesRouterCase owns a fresh database, session and permissions for the selected scenario.
func runBulkCreateTitlesRouterCase(t *testing.T, name string) {
	t.Helper()
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	const actorID = "00000000-0000-0000-0000-000000005401"
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
	('00000000-0000-0000-0000-000000005402','user','User','["short_link:create","domain:use_default","short_link:set_metadata"]',true,now(),now());
	insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
	('00000000-0000-0000-0000-000000005401','titles-router','Titles','00000000-0000-0000-0000-000000005402','active',false,now(),now());
	insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values
	('00000000-0000-0000-0000-000000005403','https://titles.example.com','Titles','short_link',true,true,now(),now());
	insert into domain_user_group(domain_id,user_group_id) values
	('00000000-0000-0000-0000-000000005403','00000000-0000-0000-0000-000000005402');`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	session, err := sessions.Create(t.Context(), actorID)
	require.NoError(t, err)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLinkBatchCreate: service, ShortLinkBatchCreateTitles: service})
	const endpoint = "/api/v1/short-link/batch-create-with-titles"
	post := func(t *testing.T, path, payload, expected string, authenticated bool) (int, int) {
		t.Helper()
		request := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		if expected != "" {
			request.Header.Set("X-MoeURL-Expected-User-ID", expected)
		}
		if authenticated {
			request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		require.Equal(t, 200, response.Code, response.Body.String())
		require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
		var body struct {
			Code int `json:"code"`
			Data struct {
				CreatedCount int `json:"createdCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		return body.Code, body.Data.CreatedCount
	}
	counts := func() []int {
		var links, audits, receipts int
		require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log where resource_type='short_link' and action='create'),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
		return []int{links, audits, receipts}
	}
	const key = "11111111-1111-4111-8111-111111115401"
	payload := `{"requestId":"` + key + `","items":[{"targetUrl":"https://example.com/one","title":"　示例, \"标题\"　"},{"targetUrl":"https://example.com/two","title":""}]}`
	require.Equal(t, []int{0, 0, 0}, counts(), "each scenario owns an empty database")
	seedReceipt := func() {
		code, count := post(t, endpoint, payload, actorID, true)
		require.Zero(t, code)
		require.Equal(t, 2, count)
		require.Equal(t, []int{2, 2, 1}, counts())
	}
	switch name {
	case "titles and receipt persist atomically":
		code, count := post(t, endpoint, payload, actorID, true)
		require.Zero(t, code)
		require.Equal(t, 2, count)
		var title, owner, mode string
		var tags []string
		require.NoError(t, pool.QueryRow(t.Context(), `select title,owner_id::text,redirect_mode,tags from short_link where target_url='https://example.com/one'`).Scan(&title, &owner, &mode, &tags))
		require.Equal(t, `示例, "标题"`, title)
		require.Equal(t, actorID, owner)
		require.Equal(t, "direct", mode)
		require.Empty(t, tags)
		require.Equal(t, []int{2, 2, 1}, counts())
		code, count = post(t, endpoint, payload, actorID, true)
		require.Zero(t, code)
		require.Equal(t, 2, count)
		require.Equal(t, []int{2, 2, 1}, counts())
		code, _ = post(t, endpoint, strings.Replace(payload, "　示例", "示例", 1), actorID, true)
		require.Equal(t, 200120, code, "raw title changes must conflict even if normalized storage is equal")
	case "framing and invalid metadata never write":
		before := counts()
		row := `{"targetUrl":"https://example.org/strict","title":"ok"}`
		for _, invalid := range []string{
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"\u`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"\ud800"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"\ud801"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"\udfff"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"\ud800\u0041"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"\ud800\\udc00"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"\ud800\uZZZZ"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"\uZZZZ"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"\uD80"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"\ud800x"}]}`,
			`{"requestId":"%s","items":null}`,
			`{"requestId":"%s","items":[]}`,
			`{"requestId":"%s","items":[null]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":null}]}`,
			`{"requestId":"%s","items":[{"targetUrl":null,"title":"ok"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"x","title":"y"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"x","tags":[]}]}`,
			`{"requestId":"%s","items":[` + row + `],"targetUrls":[]}`,
			`{"requestId":"%s","items":[` + row + `],"items":[` + row + `]}`,
			`{"requestId":"%s","items":[` + row + `]} {}`,
			`{"requestId":"%s","items":[` + row + `,` + row + `]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"a\nb"}]}`,
			`{"requestId":"%s","items":[{"targetUrl":"https://example.org/strict","title":"` + strings.Repeat("界", 121) + `"}]}`,
		} {
			code, _ := post(t, endpoint, fmt.Sprintf(invalid, uuid.NewString()), actorID, true)
			require.Equal(t, 100001, code, invalid)
			require.Equal(t, before, counts())
		}
		// Legitimate replacement characters, supplementary characters and literal escape text remain distinct content.
		for _, tc := range []struct{ wire, title string }{
			{`\ufffd`, "�"}, {"�", "�"}, {`\ud83d\ude00`, "😀"}, {`\u0041`, "A"}, {`\\ud800`, `\ud800`},
		} {
			requestID, target := uuid.NewString(), "https://example.org/unicode/"+uuid.NewString()
			body := `{"requestId":"` + requestID + `","items":[{"targetUrl":"` + target + `","title":"` + tc.wire + `"}]}`
			code, count := post(t, endpoint, body, actorID, true)
			require.Zero(t, code)
			require.Equal(t, 1, count)
			var stored string
			require.NoError(t, pool.QueryRow(t.Context(), `select title from short_link where target_url=$1`, target).Scan(&stored))
			require.Equal(t, tc.title, stored)
			code, _ = post(t, endpoint, body, actorID, true)
			require.Zero(t, code)
			for _, invalidTitle := range []string{`\ud800`, `\ud801`, `\udfff`} {
				before := counts()
				invalid := `{"requestId":"` + requestID + `","items":[{"targetUrl":"` + target + `","title":"` + invalidTitle + `"}]}`
				code, _ = post(t, endpoint, invalid, actorID, true)
				require.Equal(t, 100001, code)
				require.Equal(t, before, counts())
			}
		}
	case "cookie identity and guest cannot write":
		before := counts()
		code, _ := post(t, endpoint, payload, "00000000-0000-0000-0000-000000005499", true)
		require.Equal(t, 120001, code)
		code, _ = post(t, endpoint, payload, "", false)
		require.Equal(t, 120001, code)
		require.Equal(t, before, counts())
	case "cross protocol key reuse conflicts in both directions":
		seedReceipt()
		before := counts()
		code, _ := post(t, "/api/v1/short-link/batch-create", `{"requestId":"`+key+`","targetUrls":["https://example.com/one","https://example.com/two"]}`, actorID, true)
		require.Equal(t, 200120, code)
		other := uuid.NewString()
		code, _ = post(t, "/api/v1/short-link/batch-create", `{"requestId":"`+other+`","targetUrls":["https://example.org/legacy"]}`, actorID, true)
		require.Zero(t, code)
		code, _ = post(t, endpoint, `{"requestId":"`+other+`","items":[{"targetUrl":"https://example.org/legacy","title":""}]}`, actorID, true)
		require.Equal(t, 200120, code)
		require.Equal(t, []int{before[0] + 1, before[1] + 1, before[2] + 1}, counts())
	case "revoked metadata denies empty titles and replay but not legacy":
		seedReceipt()
		_, err := pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default"]' where key='user'`)
		require.NoError(t, err)
		before := counts()
		for _, body := range []string{payload, `{"requestId":"` + uuid.NewString() + `","items":[{"targetUrl":"https://example.org/empty","title":""}]}`} {
			code, _ := post(t, endpoint, body, actorID, true)
			require.Equal(t, 120001, code)
			require.Equal(t, before, counts())
		}
		code, _ := post(t, "/api/v1/short-link/batch-create", `{"requestId":"`+uuid.NewString()+`","targetUrls":["https://example.org/still-legacy"]}`, actorID, true)
		require.Zero(t, code)
	default:
		t.Fatalf("unknown titles router scenario %q", name)
	}
}
