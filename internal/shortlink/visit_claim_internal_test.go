package shortlink

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// TestVisitClaimRollsBackDatabaseFailures injects failures into real transaction boundaries.
func TestVisitClaimRollsBackDatabaseFailures(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	_, err := pool.Exec(ctx, `
		insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),'user','User','[]',true,now(),now());
		insert into app_user(id,username,password_hash,nickname,group_id,status,builtin,created_at,updated_at)
		select '00000000-0000-0000-0000-000000000501','alice','hash','Alice',id,'active',false,now(),now() from user_group;
		insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at)
		values('00000000-0000-0000-0000-000000000301','https://go.example.com','Short links','short_link',true,true,now(),now());
		insert into short_link(id,owner_id,domain_id,slug,target_url,status,max_visits,created_at,updated_at)
		values('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000301','claim','https://example.com','active',1,now(),now());
	`)
	require.NoError(t, err)
	failure := errors.New("injected database failure")
	for _, test := range []struct {
		name       string
		beginErr   error
		query      int
		queryErr   error
		commitErr  error
		want       error
		change     string
		continuing bool
		token      string
		host       string
	}{
		{name: "begin", beginErr: failure, want: failure},
		{name: "lock", query: 1, queryErr: failure, want: failure},
		{name: "missing", query: 1, queryErr: pgx.ErrNoRows, want: ErrShortLinkMissing},
		{name: "reread", query: 2, queryErr: failure, want: failure},
		{name: "claim", query: 3, queryErr: failure, want: failure},
		{name: "claim unavailable", query: 3, queryErr: pgx.ErrNoRows, want: ErrShortLinkExhausted},
		{name: "commit", commitErr: failure, want: failure},
		{name: "wrong host", host: "wrong.example.com", want: ErrShortLinkMissing},
		{name: "disabled", change: "status = 'disabled'", want: ErrShortLinkDisabled},
		{name: "exhausted", change: "visits_used = 1", want: ErrShortLinkExhausted},
		{name: "direct continue", continuing: true, want: ErrShortLinkNotInteractive},
		{name: "missing grant", change: "password_hash = 'hash'", continuing: true, token: "invalid-grant", want: ErrPasswordRequired},
		{name: "grant query", change: "password_hash = 'hash'", continuing: true, token: "invalid-grant", query: 3, queryErr: failure, want: failure},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := pool.Exec(ctx, `update short_link set visits_used = 0, status = 'active', password_hash = null where slug = 'claim'`)
			require.NoError(t, err)
			if test.change != "" {
				_, err = pool.Exec(ctx, `update short_link set `+test.change+` where slug = 'claim'`)
				require.NoError(t, err)
			}
			store := visitFaultStore{begin: func(ctx context.Context) (pgx.Tx, error) {
				deadline, ok := ctx.Deadline()
				require.True(t, ok)
				require.WithinDuration(t, time.Now().Add(visitClaimTimeout), deadline, time.Second)
				if test.beginErr != nil {
					return nil, test.beginErr
				}
				tx, err := pool.Begin(ctx)
				if err != nil {
					return nil, err
				}
				return &visitFaultTx{Tx: tx, failQuery: test.query, queryErr: test.queryErr, commitErr: test.commitErr}, nil
			}}
			service := NewRedirectService(pool, nil)
			service.visitTransactions = store
			host := test.host
			if host == "" {
				host = "go.example.com"
			}
			_, err = service.claimLimitedVisit(ctx, "claim", test.token, host, test.continuing)
			require.ErrorIs(t, err, test.want)
			var used int64
			require.NoError(t, pool.QueryRow(ctx, `select visits_used from short_link where slug = 'claim'`).Scan(&used))
			wantUsed := int64(0)
			if test.name == "exhausted" {
				wantUsed = 1
			}
			require.Equal(t, wantUsed, used, "failed transactions must not consume quota")
		})
	}
}

type visitFaultStore struct {
	begin func(context.Context) (pgx.Tx, error)
}

// Begin preserves the production transaction API while controlling one failure boundary.
func (s visitFaultStore) Begin(ctx context.Context) (pgx.Tx, error) { return s.begin(ctx) }

type visitFaultTx struct {
	pgx.Tx
	failQuery int
	queries   int
	queryErr  error
	commitErr error
}

// QueryRow delegates to PostgreSQL except at the selected failing statement.
func (tx *visitFaultTx) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	tx.queries++
	if tx.queries == tx.failQuery {
		return visitErrorRow{err: tx.queryErr}
	}
	return tx.Tx.QueryRow(ctx, query, args...)
}

// Commit simulates an uncommitted failure without discarding the real rollback path.
func (tx *visitFaultTx) Commit(ctx context.Context) error {
	if tx.commitErr != nil {
		return tx.commitErr
	}
	return tx.Tx.Commit(ctx)
}

type visitErrorRow struct{ err error }

// Scan returns the injected database error without fabricating query data.
func (row visitErrorRow) Scan(...any) error { return row.err }
