package domain_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func orderHTTP(t *testing.T, h *domain.OrderHandler, actor auth.CurrentUser, media, payload string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/domain/set-order", strings.NewReader(payload))
	r.Header.Set("Content-Type", media)
	r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "isolated-test-session"})
	w := httptest.NewRecorder()
	auth.CurrentUserMiddleware(domainUserResolver{actor: actor})(http.HandlerFunc(h.SetOrder)).ServeHTTP(w, r)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	return w
}

// Catches permissive JSON decoding, rounded versions and invalid requests reaching storage.
func TestDomainOrderHandlerStrictContract(t *testing.T) {
	s, pool, admin, user, d := orderFixture(t)
	h := domain.NewOrderHandler(s, nil)
	valid := fmt.Sprintf(`{"id":%q,"sortOrder":-20,"expectedUpdatedAt":%q}`, d.ID, d.UpdatedAt)
	for _, test := range []struct{ name, body, media string }{
		{"missing media", valid, ""}, {"wrong media", valid, "text/plain"}, {"broken media", valid, "application/json; broken"},
		{"empty", "", "application/json"}, {"truncated", "{", "application/json"}, {"null", "null", "application/json"}, {"array", "[]", "application/json"},
		{"missing id", fmt.Sprintf(`{"sortOrder":1,"expectedUpdatedAt":%q}`, d.UpdatedAt), "application/json"},
		{"missing order", fmt.Sprintf(`{"id":%q,"expectedUpdatedAt":%q}`, d.ID, d.UpdatedAt), "application/json"},
		{"missing version", fmt.Sprintf(`{"id":%q,"sortOrder":1}`, d.ID), "application/json"},
		{"unknown", strings.TrimSuffix(valid, "}") + `,"actor":"admin"}`, "application/json"},
		{"trailing", valid + ` {}`, "application/json"}, {"trailing junk", valid + ` garbage`, "application/json"},
		{"null id", strings.Replace(valid, fmt.Sprintf(`"id":%q`, d.ID), `"id":null`, 1), "application/json"},
		{"null order", strings.Replace(valid, `"sortOrder":-20`, `"sortOrder":null`, 1), "application/json"},
		{"null version", strings.Replace(valid, fmt.Sprintf(`"expectedUpdatedAt":%q`, d.UpdatedAt), `"expectedUpdatedAt":null`, 1), "application/json"},
	} {
		t.Run(test.name, func(t *testing.T) {
			w := orderHTTP(t, h, admin, test.media, test.body)
			require.Equal(t, http.StatusOK, w.Code)
			var body struct {
				Code int
				Data any
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			require.Equal(t, 100001, body.Code)
			require.Nil(t, body.Data)
		})
	}
	for _, order := range []string{`"1"`, `1.5`, `1.0`, `1e1`, `true`, `{}`, `2147483648`, `-10001`, `10001`} {
		t.Run("order_"+order, func(t *testing.T) {
			w := orderHTTP(t, h, admin, "application/json", strings.Replace(valid, `"sortOrder":-20`, `"sortOrder":`+order, 1))
			require.Equal(t, http.StatusOK, w.Code)
			var body struct {
				Code int `json:"code"`
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			require.Equal(t, 100001, body.Code)
		})
	}
	for _, id := range []string{"", uuid.Nil.String(), strings.ToUpper("abcdef01-0000-0000-0000-000000000001"), "urn:uuid:" + d.ID, strings.ReplaceAll(d.ID, "-", ""), "invalid"} {
		t.Run("id_"+id, func(t *testing.T) {
			w := orderHTTP(t, h, admin, "application/json", strings.Replace(valid, fmt.Sprintf(`"id":%q`, d.ID), fmt.Sprintf(`"id":%q`, id), 1))
			var body struct{ Code int }
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			require.Equal(t, 100001, body.Code)
		})
	}
	for _, version := range []string{"", "2026-10-27", "0001-01-01T00:00:00Z", "2026-10-27T01:02:03", "2026-10-27T25:00:00Z", "2026-10-27T01:02:03,1Z", "2026-10-27T01:02:03.1234567890Z"} {
		t.Run("version_"+version, func(t *testing.T) {
			w := orderHTTP(t, h, admin, "application/json", strings.Replace(valid, fmt.Sprintf(`"expectedUpdatedAt":%q`, d.UpdatedAt), fmt.Sprintf(`"expectedUpdatedAt":%q`, version), 1))
			var body struct{ Code int }
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			require.Equal(t, 100001, body.Code)
		})
	}
	for _, test := range []struct {
		name    string
		actor   auth.CurrentUser
		payload string
		code    int
	}{
		{"ordinary user", user, valid, 120001},
		{"guest", auth.CurrentUser{}, valid, 120001},
		{"missing", admin, strings.Replace(valid, d.ID, uuid.NewString(), 1), 210102},
		{"stale", admin, strings.Replace(valid, d.UpdatedAt, "2020-01-01T00:00:00Z", 1), 210103},
	} {
		t.Run(test.name, func(t *testing.T) {
			w := orderHTTP(t, h, test.actor, "application/json", test.payload)
			require.Equal(t, http.StatusOK, w.Code)
			var body struct{ Code int }
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			require.Equal(t, test.code, body.Code)
		})
	}
	version, err := time.Parse(time.RFC3339Nano, d.UpdatedAt)
	require.NoError(t, err)
	nanos := version.Add(time.Nanosecond).Format(time.RFC3339Nano)
	w := orderHTTP(t, h, admin, "application/json", strings.Replace(valid, d.UpdatedAt, nanos, 1))
	var conflict struct{ Code int }
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &conflict))
	require.Equal(t, 210103, conflict.Code)
	var sort int32
	var stored time.Time
	require.NoError(t, pool.QueryRow(t.Context(), `select sort_order,updated_at from domain where id=$1`, d.ID).Scan(&sort, &stored))
	require.Zero(t, sort)
	require.Equal(t, d.UpdatedAt, stored.UTC().Format(time.RFC3339Nano))
	// Equivalent timezone is valid; it must identify the exact instant, without truncation.
	zoneVersion := version.In(time.FixedZone("UTC+8", 8*60*60)).Format(time.RFC3339Nano)
	w = orderHTTP(t, h, admin, "application/json; charset=utf-8", strings.Replace(valid, d.UpdatedAt, zoneVersion, 1))
	require.Equal(t, http.StatusOK, w.Code)
	var result struct {
		Code int
		Data struct{ Domain domain.Domain }
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.Zero(t, result.Code)
	require.Equal(t, int32(-20), result.Data.Domain.SortOrder)
	require.NotEqual(t, d.UpdatedAt, result.Data.Domain.UpdatedAt)
}

type orderFailurePort struct{ failure error }

func (p orderFailurePort) SetOrder(context.Context, auth.CurrentUser, domain.SetOrderInput) (domain.Domain, error) {
	return domain.Domain{}, p.failure
}

// Storage is the only fake boundary here: real decoding and error/log sanitization must remain.
func TestDomainOrderHandlerSanitizesInfrastructure(t *testing.T) {
	for _, failure := range []error{errors.New("postgres://secret@private-db"), context.DeadlineExceeded} {
		var logs bytes.Buffer
		h := domain.NewOrderHandler(orderFailurePort{failure}, slog.New(slog.NewJSONHandler(&logs, nil)))
		w := orderHTTP(t, h, auth.CurrentUser{}, "application/json", `{"id":"00000000-0000-0000-0000-000000000727","sortOrder":0,"expectedUpdatedAt":"2026-10-27T01:02:03Z"}`)
		require.Equal(t, http.StatusInternalServerError, w.Code)
		var body struct{ Code int }
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Equal(t, 900000, body.Code)
		require.NotContains(t, w.Body.String()+logs.String(), "postgres://secret")
	}
}
