package domain_test

import (
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"
)

// Catches referenced defaults preventing deletion, stale versions surviving cleanup and partial audit failures.
func TestGroupDefaultDomainDeleteAtomicity(t *testing.T) {
	for _, failAudit := range []bool{false, true} {
		name := "clear_and_delete"
		if failAudit {
			name = "audit_failure_rolls_back_everything"
		}
		t.Run(name, func(t *testing.T) {
			s, pool, admin, user, target := orderFixture(t)
			ctx := t.Context()
			_, err := pool.Exec(ctx, `update user_group set default_domain_id=$1 where key in ('user','admin')`, target.ID)
			require.NoError(t, err)
			_, err = pool.Exec(ctx, `insert into user_domain_preference(user_id,domain_id) values($1,$2)`, user.ID, target.ID)
			require.NoError(t, err)
			var userAt, adminAt, preferenceAt time.Time
			require.NoError(t, pool.QueryRow(ctx, `select updated_at from user_group where key='user'`).Scan(&userAt))
			require.NoError(t, pool.QueryRow(ctx, `select updated_at from user_group where key='admin'`).Scan(&adminAt))
			require.NoError(t, pool.QueryRow(ctx, `select updated_at from user_domain_preference where user_id=$1`, user.ID).Scan(&preferenceAt))
			if failAudit {
				_, err = pool.Exec(ctx, `alter table audit_log add constraint fail_group_default_audit check(resource_type<>'user_group') not valid`)
				require.NoError(t, err)
			}
			err = s.Delete(ctx, admin, domain.ChangeInput{ID: target.ID, ExpectedUpdatedAt: target.UpdatedAt})
			if failAudit {
				var failure *pgconn.PgError
				require.True(t, errors.As(err, &failure), "audit insert must fail, got %v", err)
				require.Equal(t, "23514", failure.Code)
				var retained int
				require.NoError(t, pool.QueryRow(ctx, `select count(*) from user_group where default_domain_id=$1`, target.ID).Scan(&retained))
				require.Equal(t, 2, retained)
				var unchanged bool
				require.NoError(t, pool.QueryRow(ctx, `select p.domain_id=$1 and p.updated_at=$2 and u.updated_at=$3 and a.updated_at=$4
					from user_domain_preference p cross join user_group u cross join user_group a
					where p.user_id=$5 and u.key='user' and a.key='admin'`, target.ID, preferenceAt, userAt, adminAt, user.ID).Scan(&unchanged))
				require.True(t, unchanged)
			} else {
				require.NoError(t, err)
				var cleared int
				require.NoError(t, pool.QueryRow(ctx, `select count(*) from user_group where key in ('user','admin') and default_domain_id is null
					and ((key='user' and updated_at>$1) or (key='admin' and updated_at>$2))`, userAt, adminAt).Scan(&cleared))
				require.Equal(t, 2, cleared)
				var preferenceCleared bool
				require.NoError(t, pool.QueryRow(ctx, `select domain_id is null and updated_at>$2 from user_domain_preference where user_id=$1`, user.ID, preferenceAt).Scan(&preferenceCleared))
				require.True(t, preferenceCleared)
				var audits int
				require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_type='user_group' and action='update' and changed_fields=array['default_domain_id']`).Scan(&audits))
				require.Equal(t, 2, audits)
			}
			var exists bool
			require.NoError(t, pool.QueryRow(ctx, `select exists(select 1 from domain where id=$1)`, target.ID).Scan(&exists))
			require.Equal(t, failAudit, exists)
		})
	}
}
