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
	"github.com/TomyJan/MoeURL/internal/domain"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// Catches an unprotected or missing route and a session identity lost between
// Cookie middleware and the actual reauthorized, versioned database write.
func TestRouterDomainOrderSessionBoundary(t *testing.T) {
	// Package TestMain releases the shared PostgreSQL container after every database test.
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	const adminID = "00000000-0000-0000-0000-000000002711"
	const userID = "00000000-0000-0000-0000-000000002712"
	const domainID = "00000000-0000-0000-0000-000000002713"
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-000000002721','admin','Admin','["admin:access","domain:manage"]',true,now(),now()),
		('00000000-0000-0000-0000-000000002722','user','User','[]',true,now(),now());
		insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-000000002711','router-order-admin','Admin','00000000-0000-0000-0000-000000002721','active',false,now(),now()),
		('00000000-0000-0000-0000-000000002712','router-order-user','User','00000000-0000-0000-0000-000000002722','active',false,now(),now());
		insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values
		('00000000-0000-0000-0000-000000002713','https://router-order.example.com','Router order','short_link',true,false,now(),now());`)
	require.NoError(t, err)
	var version time.Time
	require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from domain where id=$1`, domainID).Scan(&version))
	sessions := auth.NewSessionService(pool, time.Hour)
	admin, err := sessions.Create(t.Context(), adminID)
	require.NoError(t, err)
	user, err := sessions.Create(t.Context(), userID)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), DomainOrder: domain.NewService(pool, permission.NewDatabaseService(pool))})
	payload := fmt.Sprintf(`{"id":%q,"sortOrder":-27,"expectedUpdatedAt":%q}`, domainID, version.UTC().Format(time.RFC3339Nano))
	for _, test := range []struct {
		name, token string
		code        int
	}{
		{"anonymous", "", 120001}, {"ordinary session", user.ID, 120001}, {"admin session", admin.ID, 0}, {"stale admin retry", admin.ID, 210103},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/domain/set-order", strings.NewReader(payload))
			r.Header.Set("Content-Type", "application/json")
			if test.token != "" {
				r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: test.token})
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			var result struct {
				Code int
				Data struct{ Domain domain.Domain }
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
			require.Equal(t, http.StatusOK, w.Code)
			require.Equal(t, test.code, result.Code)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			if test.code == 0 {
				require.Equal(t, int32(-27), result.Data.Domain.SortOrder)
				require.Equal(t, domainID, result.Data.Domain.ID)
				require.NotEqual(t, version.UTC().Format(time.RFC3339Nano), result.Data.Domain.UpdatedAt)
			}
		})
	}
	var sort int32
	var actor string
	var fields []string
	require.NoError(t, pool.QueryRow(t.Context(), `select sort_order from domain where id=$1`, domainID).Scan(&sort))
	require.Equal(t, int32(-27), sort)
	require.NoError(t, pool.QueryRow(t.Context(), `select actor_id::text,changed_fields from audit_log where resource_id=$1`, domainID).Scan(&actor, &fields))
	require.Equal(t, adminID, actor)
	require.Equal(t, []string{"sort_order"}, fields)
}
