package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/stretchr/testify/require"
)

// Missing production routes, lost CAS versions or selecting an owner from input
// must fail this real HTTP/session/PostgreSQL contract.
func TestListPreferenceProtocol(t *testing.T) {
	application := newTestApplication(t)
	admin := domainOrderLogin(t, application)
	const path = "/api/v1/user/list-preference"
	const snapshot = `select jsonb_build_object(
		'interface',(select jsonb_agg(to_jsonb(p) order by user_id) from user_preference p),
		'domain',(select jsonb_agg(to_jsonb(p) order by user_id) from user_domain_preference p),
		'timezone',(select jsonb_agg(to_jsonb(p) order by user_id) from user_time_zone_preference p),
		'redirect',(select jsonb_agg(to_jsonb(p) order by user_id) from user_redirect_preference p))::text`
	var before, after string
	require.NoError(t, application.pool.QueryRow(t.Context(), snapshot).Scan(&before))
	unset := domainOrderRequest(t, application, admin, http.MethodGet, path, "")
	require.JSONEq(t, `{"preference":{"pageSize":null,"updatedAt":null}}`, string(unset))
	var version *string
	for _, size := range []any{20, 50, 100, nil} {
		body, err := json.Marshal(map[string]any{"pageSize": size, "expectedUpdatedAt": version})
		require.NoError(t, err)
		saved := domainOrderRequest(t, application, admin, http.MethodPost, path+"/update", string(body))
		var document struct {
			Preference struct {
				PageSize  *int   `json:"pageSize"`
				UpdatedAt string `json:"updatedAt"`
			} `json:"preference"`
		}
		require.NoError(t, json.Unmarshal(saved, &document))
		if size == nil {
			require.Nil(t, document.Preference.PageSize)
		} else {
			require.NotNil(t, document.Preference.PageSize)
			require.Equal(t, size, *document.Preference.PageSize)
		}
		parsed, err := time.Parse(time.RFC3339Nano, document.Preference.UpdatedAt)
		require.NoError(t, err)
		require.False(t, parsed.IsZero())
		if version != nil {
			previous, err := time.Parse(time.RFC3339Nano, *version)
			require.NoError(t, err)
			require.True(t, parsed.After(previous))
		}
		version = &document.Preference.UpdatedAt
		require.JSONEq(t, string(saved), string(domainOrderRequest(t, application, admin, http.MethodGet, path, "")))
	}
	// A new session sees the cleared value with its real revision, not a fake unset row.
	var adminID string
	require.NoError(t, application.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&adminID))
	session, err := auth.NewSessionService(application.pool, time.Hour).Create(t.Context(), adminID)
	require.NoError(t, err)
	data := domainOrderRequest(t, application, &http.Cookie{Name: auth.SessionCookieName, Value: session.ID}, http.MethodGet, path, "")
	require.JSONEq(t, fmt.Sprintf(`{"preference":{"pageSize":null,"updatedAt":%q}}`, *version), string(data))
	require.NoError(t, application.pool.QueryRow(t.Context(), snapshot).Scan(&after))
	require.Equal(t, before, after)
}
