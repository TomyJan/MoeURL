package targetpolicy

import (
	"context"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
)

// AuthorizeAdminCheck rereads the current administrator for a caller-owned
// read transaction; it never trusts the session's permission snapshot.
func AuthorizeAdminCheck(ctx context.Context, q *sqlc.Queries, actor auth.CurrentUser) error {
	id, err := actorID(actor.ID)
	if err != nil {
		return err
	}
	grants, err := q.GetTargetPolicyAdmin(ctx, id)
	return authorizeAdmin(grants, err)
}
