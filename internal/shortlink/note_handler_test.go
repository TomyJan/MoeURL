package shortlink_test

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// noteHTTPFixture uses real sessions, authorization and SQL; malformed requests must leave the full database unchanged.
func noteHTTPFixture(t *testing.T) (*pgxpool.Pool, http.Handler, string, string, string, shortlink.NoteInput) {
	t.Helper()
	pool, service, admin, owner, _, input := noteFixture(t)
	sessions := auth.NewSessionService(pool, time.Hour)
	ownerSession, err := sessions.Create(t.Context(), owner.ID)
	require.NoError(t, err)
	adminSession, err := sessions.Create(t.Context(), admin.ID)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLinkNote: service})
	return pool, router, ownerSession.ID, adminSession.ID, owner.ID, input
}

func noteCall(t *testing.T, router http.Handler, method, path, token, body string, headers http.Header) (int, shortlink.NoteResult) {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	for key, values := range headers {
		r.Header[key] = values
	}
	if token != "" {
		r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	var result struct {
		Code int                  `json:"code"`
		Data shortlink.NoteResult `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	return result.Code, result.Data
}

// TestNoteScalarCorpus catches byte-count limits, changed BOM/combining text and permissive broken Unicode handling.
func TestNoteScalarCorpus(t *testing.T) {
	_, router, token, _, actor, input := noteHTTPFixture(t)
	raw, err := os.ReadFile("../../testdata/short-link-note.json")
	require.NoError(t, err)
	var cases []struct {
		Name, Input, Want, RawHex, JSONString string
		Repeat, WantRepeat                    int
		Invalid                               bool
	}
	require.NoError(t, json.Unmarshal(raw, &cases))
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			value := tc.Input
			want := tc.Want
			if tc.Repeat > 0 {
				value = strings.Repeat(tc.Input, tc.Repeat)
			}
			if tc.WantRepeat > 0 {
				want = strings.Repeat(tc.Input, tc.WantRepeat)
			}
			encoded, err := json.Marshal(value)
			require.NoError(t, err)
			if tc.JSONString != "" {
				encoded = []byte(tc.JSONString)
			}
			if tc.RawHex != "" {
				invalid, err := hex.DecodeString(tc.RawHex)
				require.NoError(t, err)
				encoded = append(append([]byte{'"'}, invalid...), '"')
			}
			body := fmt.Sprintf(`{"id":%q,"note":%s,"expectedUpdatedAt":%q}`, input.ID, encoded, input.ExpectedUpdatedAt)
			code, result := noteCall(t, router, "POST", "/api/v1/short-link/note/update", token, body, http.Header{"X-Moeurl-Expected-User-Id": {actor}})
			if tc.Invalid {
				require.Equal(t, 100001, code)
				require.Zero(t, result)
			} else {
				require.Zero(t, code)
				require.Equal(t, want, result.Note)
				input.ExpectedUpdatedAt = result.UpdatedAt
			}
		})
	}
}

// TestNoteHTTPFraming catches accepting partial replacements, ambiguous IDs, duplicate fields or oversized framing.
func TestNoteHTTPFraming(t *testing.T) {
	pool, router, owner, admin, _, input := noteHTTPFixture(t)
	valid := fmt.Sprintf(`{"id":%q,"note":"private","expectedUpdatedAt":%q}`, input.ID, input.ExpectedUpdatedAt)
	for _, scope := range []struct{ path, token string }{{"/api/v1/short-link", owner}, {"/api/v1/admin/short-link", admin}} {
		for i, body := range append([]string{valid[:len(valid)-1], valid[:len(valid)-1] + `,}`}, []string{"", `null`, `[]`, `{}`, `{"id":`, valid + ` {}`, valid + ` trailing`, strings.Replace(valid, `"note":"private"`, `"note":null`, 1), strings.Replace(valid, `"note":"private"`, `"note":1`, 1), strings.Replace(valid, `"note":"private"`, `"note":[]`, 1), strings.Replace(valid, `"note":"private"`, `"note":"x","note":"y"`, 1), strings.Replace(valid, `"note":"private",`, ``, 1), strings.Replace(valid, `"note":`, `"unknown":false,"note":`, 1), strings.Replace(valid, `"note":"private"`, `"note":"\ud800x"`, 1), strings.Replace(valid, `"note":"private"`, `"note":"\ud800\u0041"`, 1), strings.Replace(valid, `"note":"private"`, `"note":"\uZZZZ"`, 1), strings.Repeat(" ", 16385) + valid}...) {
			t.Run(fmt.Sprintf("%s/body%d", scope.path, i), func(t *testing.T) {
				before := batchTagsSnapshot(t, pool)
				code, _ := noteCall(t, router, "POST", scope.path+"/note/update", scope.token, body, nil)
				require.Equal(t, 100001, code)
				require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			})
		}
		for _, query := range []string{"", "id", "id=", "id=" + input.ID + "&", "id=" + input.ID + "&id=" + input.ID, "id=" + input.ID + "&x=1", "id=%zz", "id=" + input.ID + ";x=1", "id=00000000-0000-0000-0000-000000000000", "id=AF000000-0000-0000-0000-000000000001"} {
			code, _ := noteCall(t, router, "GET", scope.path+"/note?"+query, scope.token, "", nil)
			require.Equal(t, 100001, code, query)
		}
		for _, media := range []string{"", "text/plain", "application/json; broken"} {
			code, _ := noteCall(t, router, "POST", scope.path+"/note/update", scope.token, valid, http.Header{"Content-Type": {media}})
			require.Equal(t, 100001, code)
		}
		code, _ := noteCall(t, router, "POST", scope.path+"/note/update?x=1", scope.token, valid, nil)
		require.Equal(t, 100001, code)
		// Exactly 16384 raw bytes, including leading whitespace, remains a valid complete request.
		code, saved := noteCall(t, router, "POST", scope.path+"/note/update", scope.token, strings.Repeat(" ", 16384-len(valid))+valid, nil)
		require.Zero(t, code)
		input.ExpectedUpdatedAt = saved.UpdatedAt
		valid = fmt.Sprintf(`{"id":%q,"note":"private","expectedUpdatedAt":%q}`, input.ID, input.ExpectedUpdatedAt)
	}
}

// TestNoteExpectedActorHeader catches stale-account reads/writes before either endpoint can access a note.
func TestNoteExpectedActorHeader(t *testing.T) {
	pool, router, owner, admin, actor, input := noteHTTPFixture(t)
	valid := fmt.Sprintf(`{"id":%q,"note":"private","expectedUpdatedAt":%q}`, input.ID, input.ExpectedUpdatedAt)
	for _, scope := range []struct{ path, token string }{{"/api/v1/short-link", owner}, {"/api/v1/admin/short-link", admin}} {
		for _, values := range [][]string{{""}, {"bad"}, {"00000000-0000-0000-0000-000000000000"}, {"af000000-0000-0000-0000-000000000001"}, {actor, actor}, {actor + "," + actor}, {strings.ToUpper("af000000-0000-0000-0000-000000000001")}} {
			before := batchTagsSnapshot(t, pool)
			for _, write := range []bool{false, true} {
				method, path, body := "GET", scope.path+"/note?id="+input.ID, ""
				if write {
					method, path, body = "POST", scope.path+"/note/update", valid
				}
				code, result := noteCall(t, router, method, path, scope.token, body, http.Header{"X-Moeurl-Expected-User-Id": values})
				require.Equal(t, 120001, code)
				require.Zero(t, result)
			}
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
		}
	}
	code, _ := noteCall(t, router, "GET", "/api/v1/short-link/note?id="+input.ID, owner, "", http.Header{"X-Moeurl-Expected-User-Id": {actor}})
	require.Zero(t, code)
	code, _ = noteCall(t, router, "GET", "/api/v1/short-link/note?id="+input.ID, "", "", http.Header{"X-Moeurl-Expected-User-Id": {actor}})
	require.Equal(t, 120001, code)
}

// TestNoteStreamAndInfrastructureFailure catches disconnected bodies and private SQL/text reaching diagnostics.
func TestNoteStreamAndInfrastructureFailure(t *testing.T) {
	wDefault := httptest.NewRecorder()
	shortlink.NewNoteHandler(nil, nil).ReadOwn(wDefault, httptest.NewRequestWithContext(t.Context(), "GET", "/?id", nil))
	require.Contains(t, wDefault.Body.String(), `"code":100001`)
	pool, service, _, owner, _, input := noteFixture(t)
	var logs bytes.Buffer
	h := shortlink.NewNoteHandler(service, slog.New(slog.NewJSONHandler(&logs, nil)))
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/", nil)
	r.Header.Set("Content-Type", "application/json")
	r.Body = io.NopCloser(batchTagsFailingReader{})
	w := httptest.NewRecorder()
	h.UpdateOwn(w, r)
	require.Contains(t, w.Body.String(), `"code":100001`)
	_, err := pool.Exec(t.Context(), `alter table audit_log add constraint reject_private_note check(false) not valid`)
	require.NoError(t, err)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), owner.ID)
	require.NoError(t, err)
	middleware := auth.CurrentUserMiddleware(auth.NewService(pool, time.Hour))
	r = httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(fmt.Sprintf(`{"id":%q,"note":"private-secret-note","expectedUpdatedAt":%q}`, input.ID, input.ExpectedUpdatedAt)))
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
	w = httptest.NewRecorder()
	middleware(http.HandlerFunc(h.UpdateOwn)).ServeHTTP(w, r)
	require.Equal(t, 500, w.Code)
	require.Contains(t, w.Body.String(), `"code":900000`)
	for _, secret := range []string{"private-secret-note", "reject_private_note", "SQLSTATE"} {
		require.NotContains(t, logs.String(), secret)
		require.NotContains(t, w.Body.String(), secret)
	}
	require.Contains(t, logs.String(), "error_category")
}

// TestNotePublicPrivacy catches adding private note content to a public response, legacy DTO or CSV export.
func TestNotePublicPrivacy(t *testing.T) {
	pool, service, admin, owner, _, input := noteFixture(t)
	saved, err := service.UpdateOwnNote(t.Context(), owner, input)
	require.NoError(t, err)
	_, err = service.Update(t.Context(), owner, shortlink.UpdateInput{ID: input.ID, Metadata: &shortlink.MetadataInput{Title: "changed title", Tags: []string{"changed"}}})
	require.NoError(t, err)
	read, err := service.ReadOwnNote(t.Context(), owner, input.ID)
	require.NoError(t, err)
	require.Equal(t, saved, read)
	for _, all := range []bool{false, true} {
		var exported shortlink.ListExport
		if all {
			exported, err = service.AdminExportList(t.Context(), admin, shortlink.ListExportInput{})
		} else {
			exported, err = service.ExportList(t.Context(), owner, shortlink.ListExportInput{})
		}
		require.NoError(t, err)
		require.Contains(t, exported.Content, "changed title")
		require.NotContains(t, exported.Content, "private note")
		require.NotContains(t, exported.Content, "note_updated_at")
	}
	stats, err := service.Statistics(t.Context(), owner, shortlink.StatisticsInput{ID: input.ID})
	require.NoError(t, err)
	raw, err := json.Marshal(stats)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "private note")
	require.NotContains(t, string(raw), `"note"`)
	_, err = pool.Exec(t.Context(), `update short_link set status='active',redirect_mode='direct',password_hash=null,expires_at=null where id=$1`, input.ID)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{Redirect: shortlink.NewRedirectService(pool, nil)})
	for _, path := range []string{"/go/handoff/preview", "/handoff"} {
		mode := "confirmation"
		if path == "/handoff" {
			mode = "direct"
		}
		_, err = pool.Exec(t.Context(), `update short_link set redirect_mode=$2 where id=$1`, input.ID, mode)
		require.NoError(t, err)
		r := httptest.NewRequestWithContext(t.Context(), "GET", "https://go.example.com"+path, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if path == "/handoff" {
			require.Equal(t, 302, w.Code)
			require.Equal(t, "https://example.com/long?q=1", w.Header().Get("Location"))
		} else {
			require.Equal(t, 200, w.Code)
			require.Contains(t, w.Body.String(), `"targetHost":"example.com"`)
		}
		require.NotContains(t, w.Body.String(), "private note")
		require.NotContains(t, w.Body.String(), `"note"`)
		require.NotContains(t, fmt.Sprint(w.Header()), "private note")
	}
}
