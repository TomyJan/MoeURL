package app

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/stretchr/testify/require"
)

// TestRedirectPreferenceProtocol detects missing routes, lost persistence,
// account leakage and accidental writes to the three older preference resources.
func TestRedirectPreferenceProtocol(t *testing.T) {
	application := newTestApplication(t)
	admin := domainOrderLogin(t, application)
	const otherID = "00000000-0000-0000-0000-000000000391"
	_, err := application.pool.Exec(t.Context(), `insert into app_user(id,username,password_hash,nickname,group_id,status,builtin,created_at,updated_at)
		select $1,'redirect-other',password_hash,'Other',group_id,'active',false,now(),now() from app_user where username='admin'`, otherID)
	require.NoError(t, err)
	session, err := auth.NewSessionService(application.pool, time.Hour).Create(t.Context(), otherID)
	require.NoError(t, err)
	other := &http.Cookie{Name: auth.SessionCookieName, Value: session.ID}
	const snapshot = `select jsonb_build_object('users',(select jsonb_agg(to_jsonb(u) order by id) from app_user u),
		'interface',(select jsonb_agg(to_jsonb(p) order by user_id) from user_preference p),
		'domain',(select jsonb_agg(to_jsonb(p) order by user_id) from user_domain_preference p),
		'timezone',(select jsonb_agg(to_jsonb(p) order by user_id) from user_time_zone_preference p))::text`
	var before, after string
	require.NoError(t, application.pool.QueryRow(t.Context(), snapshot).Scan(&before))
	const path = "/api/v1/user/redirect-preference"
	unset := domainOrderRequest(t, application, admin, http.MethodGet, path, "")
	require.JSONEq(t, `{"preference":{"redirectMode":null,"updatedAt":null}}`, string(unset))
	saved := domainOrderRequest(t, application, admin, http.MethodPost, path+"/update", `{"redirectMode":"confirmation","expectedUpdatedAt":null}`)
	var document struct {
		Preference struct {
			RedirectMode string `json:"redirectMode"`
			UpdatedAt    string `json:"updatedAt"`
		} `json:"preference"`
	}
	require.NoError(t, json.Unmarshal(saved, &document))
	require.Equal(t, "confirmation", document.Preference.RedirectMode)
	version, err := time.Parse(time.RFC3339Nano, document.Preference.UpdatedAt)
	require.NoError(t, err)
	require.False(t, version.IsZero())
	require.JSONEq(t, `{"preference":{"redirectMode":"confirmation","updatedAt":"`+document.Preference.UpdatedAt+`"}}`, string(saved))
	require.JSONEq(t, string(saved), string(domainOrderRequest(t, application, admin, http.MethodGet, path, "")))
	require.JSONEq(t, `{"preference":{"redirectMode":null,"updatedAt":null}}`, string(domainOrderRequest(t, application, other, http.MethodGet, path, "")))
	require.NoError(t, application.pool.QueryRow(t.Context(), snapshot).Scan(&after))
	require.Equal(t, before, after)
}
