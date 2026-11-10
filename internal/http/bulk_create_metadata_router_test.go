package http_test

import (
	"encoding/json"
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
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

const metadataRouterActor = "00000000-0000-0000-0000-000000005501"
const metadataRouterEndpoint = "/api/v1/short-link/batch-create-with-metadata"
const metadataRouterPayload = `{"requestId":"11111111-1111-4111-8111-111111115501","items":[{"targetUrl":"https://example.com/one","title":"　示例　","tags":["　工具　","a,b","A"]},{"targetUrl":"https://example.com/two","title":"","tags":[]}]}`

type metadataRouterFixture struct {
	pool   *pgxpool.Pool
	post   func(path, payload, expected string, authenticated bool) (int, int)
	counts func() []int
}

// TestBulkMetadataStrictRouter catches discarded, ambiguous, lossy or invalid tag content before any write.
func TestBulkMetadataStrictRouter(t *testing.T) {
	f := newMetadataRouterFixture(t)
	wrap := func(row string) string {
		return `{"requestId":"11111111-1111-4111-8111-111111115502","items":[` + row + `]}`
	}
	row := `{"targetUrl":"https://example.org/strict","title":"ok","tags":[]}`
	for name, invalid := range map[string]string{
		"missing tags":         `{"targetUrl":"https://example.org/strict","title":"ok"}`,
		"null tags":            strings.Replace(row, `[]`, `null`, 1),
		"scalar tags":          strings.Replace(row, `[]`, `"tag"`, 1),
		"null tag":             strings.Replace(row, `[]`, `[null]`, 1),
		"number tag":           strings.Replace(row, `[]`, `[3]`, 1),
		"nested tag":           strings.Replace(row, `[]`, `[["x"]]`, 1),
		"object tag":           strings.Replace(row, `[]`, `[{"x":"y"}]`, 1),
		"duplicate tags field": strings.Replace(row, `"tags":[]`, `"tags":[],"tags":[]`, 1),
		"duplicate title":      strings.Replace(row, `"title":"ok"`, `"title":"ok","title":"other"`, 1),
		"unknown field":        strings.Replace(row, `"tags":[]`, `"tags":[],"note":"private"`, 1),
		"missing title":        strings.Replace(row, `"title":"ok",`, ``, 1),
		"null title":           strings.Replace(row, `"ok"`, `null`, 1),
		"null target":          strings.Replace(row, `"https://example.org/strict"`, `null`, 1),
		"empty tag":            strings.Replace(row, `[]`, `[""]`, 1),
		"whitespace tag":       strings.Replace(row, `[]`, `["　 "]`, 1),
		"duplicate normalized": strings.Replace(row, `[]`, `[" tag ","tag"]`, 1),
		"control tag":          strings.Replace(row, `[]`, `["a\nb"]`, 1),
		"long tag":             strings.Replace(row, `[]`, `["`+strings.Repeat("界", 33)+`"]`, 1),
		"eleven tags":          strings.Replace(row, `[]`, `["1","2","3","4","5","6","7","8","9","10","11"]`, 1),
		"unpaired high":        strings.Replace(row, `[]`, `["\ud800"]`, 1),
		"unpaired low":         strings.Replace(row, `[]`, `["\udfff"]`, 1),
		"escaped false pair":   strings.Replace(row, `[]`, `["\ud800\\udc00"]`, 1),
		"invalid pair":         strings.Replace(row, `[]`, `["\ud800\u0041"]`, 1),
		"invalid hex":          strings.Replace(row, `[]`, `["\uZZZZ"]`, 1),
		"invalid UTF8":         strings.Replace(row, `[]`, "[\""+string([]byte{0xff})+"\"]", 1),
	} {
		code, _ := f.post(metadataRouterEndpoint, wrap(invalid), metadataRouterActor, true)
		require.Equal(t, 100001, code, name)
		require.Equal(t, []int{0, 0, 0}, f.counts(), name)
	}
	for _, invalid := range []string{`null`, `[]`, `{}`, `{"requestId":null,"items":[` + row + `]}`, `{"requestId":"11111111-1111-4111-8111-111111115502","items":null}`, strings.Replace(wrap(row), `"items":`, `"items":[],"items":`, 1), wrap(row) + `{}`, wrap(row + `,` + row)} {
		code, _ := f.post(metadataRouterEndpoint, invalid, metadataRouterActor, true)
		require.Equal(t, 100001, code)
		require.Equal(t, []int{0, 0, 0}, f.counts())
	}
	for _, tc := range []struct{ wire, stored string }{{`\ud83d\ude00`, "😀"}, {`\ufffd`, "�"}, {"�", "�"}, {`\\ud800`, `\ud800`}, {strings.Repeat("界", 32), strings.Repeat("界", 32)}} {
		key, target := uuid.NewString(), "https://example.org/unicode/"+uuid.NewString()
		body := `{"requestId":"` + key + `","items":[{"targetUrl":"` + target + `","title":"ok","tags":["` + tc.wire + `"]}]}`
		code, count := f.post(metadataRouterEndpoint, body, metadataRouterActor, true)
		require.Zero(t, code)
		require.Equal(t, 1, count)
		var tags []string
		require.NoError(t, f.pool.QueryRow(t.Context(), `select tags from short_link where target_url=$1`, target).Scan(&tags))
		require.Equal(t, []string{tc.stored}, tags)
	}
}

// TestBulkMetadataCrossProtocol catches shared-key duplication in each of the six protocol directions.
func TestBulkMetadataCrossProtocol(t *testing.T) {
	const legacy = "/api/v1/short-link/batch-create"
	const titles = "/api/v1/short-link/batch-create-with-titles"
	protocols := []struct{ name, path, body string }{
		{"targets", legacy, `{"requestId":"11111111-1111-4111-8111-111111115503","targetUrls":["https://example.org/shared"]}`},
		{"titles", titles, `{"requestId":"11111111-1111-4111-8111-111111115503","items":[{"targetUrl":"https://example.org/shared","title":""}]}`},
		{"metadata", metadataRouterEndpoint, `{"requestId":"11111111-1111-4111-8111-111111115503","items":[{"targetUrl":"https://example.org/shared","title":"","tags":[]}]}`},
	}
	for i, first := range protocols {
		for j, second := range protocols {
			if i == j {
				continue
			}
			t.Run(first.name+" to "+second.name, func(t *testing.T) {
				f := newMetadataRouterFixture(t)
				code, count := f.post(first.path, first.body, metadataRouterActor, true)
				require.Zero(t, code)
				require.Equal(t, 1, count)
				require.Equal(t, []int{1, 1, 1}, f.counts())
				code, _ = f.post(second.path, second.body, metadataRouterActor, true)
				require.Equal(t, 200120, code)
				require.Equal(t, []int{1, 1, 1}, f.counts())
			})
		}
	}
}

// TestBulkMetadataRevokedReplay catches authorization performed only for new writes or nonempty tags.
func TestBulkMetadataRevokedReplay(t *testing.T) {
	f := newMetadataRouterFixture(t)
	code, count := f.post(metadataRouterEndpoint, metadataRouterPayload, metadataRouterActor, true)
	require.Zero(t, code)
	require.Equal(t, 2, count)
	require.Equal(t, []int{2, 2, 1}, f.counts())
	_, err := f.pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default"]' where key='user'`)
	require.NoError(t, err)
	for _, body := range []string{metadataRouterPayload, `{"requestId":"11111111-1111-4111-8111-111111115504","items":[{"targetUrl":"https://example.org/empty","title":"","tags":[]}]}`} {
		code, _ := f.post(metadataRouterEndpoint, body, metadataRouterActor, true)
		require.Equal(t, 120001, code)
		require.Equal(t, []int{2, 2, 1}, f.counts())
	}
	code, _ = f.post("/api/v1/short-link/batch-create", `{"requestId":"11111111-1111-4111-8111-111111115505","targetUrls":["https://example.org/legacy"]}`, metadataRouterActor, true)
	require.Zero(t, code)
	require.Equal(t, []int{3, 3, 2}, f.counts())
}

// TestBulkMetadataIdentity catches writes bound to a stale account or a guest.
func TestBulkMetadataIdentity(t *testing.T) {
	f := newMetadataRouterFixture(t)
	code, _ := f.post(metadataRouterEndpoint, metadataRouterPayload, "00000000-0000-0000-0000-000000005599", true)
	require.Equal(t, 120001, code)
	code, _ = f.post(metadataRouterEndpoint, metadataRouterPayload, "", false)
	require.Equal(t, 120001, code)
	require.Equal(t, []int{0, 0, 0}, f.counts())
}

// TestBulkMetadataAtomicRollback catches partial links, audit rows or a receipt after an insert failure.
func TestBulkMetadataAtomicRollback(t *testing.T) {
	f := newMetadataRouterFixture(t)
	_, err := f.pool.Exec(t.Context(), `create function fail_metadata_second() returns trigger language plpgsql as $$begin
	if new.target_url='https://example.com/two' then raise exception 'controlled metadata failure'; end if; return new; end$$;
	create trigger fail_metadata_second before insert on short_link for each row execute function fail_metadata_second()`)
	require.NoError(t, err)
	service := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
	var input shortlink.BatchCreateWithMetadataInput
	require.NoError(t, json.Unmarshal([]byte(metadataRouterPayload), &input))
	_, err = service.BatchCreateWithMetadata(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
	require.Error(t, err)
	require.Equal(t, []int{0, 0, 0}, f.counts())
}

// TestBulkMetadataConcurrentReceipt catches duplicate batches when two callers share an idempotency key.
func TestBulkMetadataConcurrentReceipt(t *testing.T) {
	for _, different := range []bool{false, true} {
		name := "same content"
		if different {
			name = "different raw tags"
		}
		t.Run(name, func(t *testing.T) {
			f := newMetadataRouterFixture(t)
			service := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
			var first, second shortlink.BatchCreateWithMetadataInput
			require.NoError(t, json.Unmarshal([]byte(metadataRouterPayload), &first))
			require.NoError(t, json.Unmarshal([]byte(metadataRouterPayload), &second))
			if different {
				second.Items[0].Tags[0] = "different"
			}
			type result struct {
				receipt shortlink.BatchCreateResult
				err     error
			}
			start, completed := make(chan struct{}), make(chan result, 2)
			for _, input := range []shortlink.BatchCreateWithMetadataInput{first, second} {
				go func() {
					<-start
					receipt, err := service.BatchCreateWithMetadata(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
					completed <- result{receipt, err}
				}()
			}
			close(start)
			deadline := time.NewTimer(10 * time.Second)
			defer deadline.Stop()
			var success, conflict int
			for range 2 {
				select {
				case r := <-completed:
					if r.err == nil {
						success++
						require.Equal(t, 2, r.receipt.CreatedCount)
					} else {
						require.ErrorIs(t, r.err, shortlink.ErrBulkCreateConflict)
						conflict++
					}
				case <-deadline.C:
					t.Fatal("concurrent batch did not finish")
				}
			}
			if different {
				require.Equal(t, 1, success)
				require.Equal(t, 1, conflict)
			} else {
				require.Equal(t, 2, success)
				require.Zero(t, conflict)
			}
			require.Equal(t, []int{2, 2, 1}, f.counts())
		})
	}
}

// newMetadataRouterFixture isolates each scenario and keeps real identity, grants, storage and receipts.
func newMetadataRouterFixture(t *testing.T) metadataRouterFixture {
	t.Helper()
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
	('00000000-0000-0000-0000-000000005502','user','User','["short_link:create","domain:use_default","short_link:set_metadata"]',true,now(),now());
	insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
	('00000000-0000-0000-0000-000000005501','metadata-router','Metadata','00000000-0000-0000-0000-000000005502','active',false,now(),now());
	insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values
	('00000000-0000-0000-0000-000000005503','https://metadata.example.com','Metadata','short_link',true,true,now(),now());
	insert into domain_user_group(domain_id,user_group_id) values
	('00000000-0000-0000-0000-000000005503','00000000-0000-0000-0000-000000005502');`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	session, err := sessions.Create(t.Context(), metadataRouterActor)
	require.NoError(t, err)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLinkBatchCreate: service, ShortLinkBatchCreateTitles: service, ShortLinkBatchCreateMetadata: service})
	post := func(path, payload, expected string, authenticated bool) (int, int) {
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
	require.Equal(t, []int{0, 0, 0}, counts())
	return metadataRouterFixture{pool: pool, post: post, counts: counts}
}

// TestBulkCreateMetadataRouter catches a missing route, dropped tags, non-atomic receipts and raw digest loss.
func TestBulkCreateMetadataRouter(t *testing.T) {
	t.Run("raw metadata persists and exact replay does not duplicate", func(t *testing.T) {
		f := newMetadataRouterFixture(t)
		code, count := f.post(metadataRouterEndpoint, metadataRouterPayload, metadataRouterActor, true)
		require.Zero(t, code)
		require.Equal(t, 2, count)
		require.Equal(t, []int{2, 2, 1}, f.counts())
		var title, owner, mode string
		var tags []string
		require.NoError(t, f.pool.QueryRow(t.Context(), `select title,owner_id::text,redirect_mode,tags from short_link where target_url='https://example.com/one'`).Scan(&title, &owner, &mode, &tags))
		require.Equal(t, "示例", title)
		require.Equal(t, []string{"工具", "a,b", "A"}, tags)
		require.Equal(t, metadataRouterActor, owner)
		require.Equal(t, "direct", mode)
		code, count = f.post(metadataRouterEndpoint, metadataRouterPayload, metadataRouterActor, true)
		require.Zero(t, code)
		require.Equal(t, 2, count)
		require.Equal(t, []int{2, 2, 1}, f.counts())
		for _, changed := range []string{strings.Replace(metadataRouterPayload, "　工具　", "工具", 1), strings.Replace(metadataRouterPayload, `"a,b","A"`, `"A","a,b"`, 1)} {
			code, _ = f.post(metadataRouterEndpoint, changed, metadataRouterActor, true)
			require.Equal(t, 200120, code)
			require.Equal(t, []int{2, 2, 1}, f.counts())
		}
	})
}
