package oidc

import (
	"context"
	"crypto/sha256"
	"encoding/base32"
	"encoding/json"
	"errors"
	"net/mail"
	"strings"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxExternalSubjectBytes = 1024

// DatabaseIdentityResolver maps verified provider subjects to local users transactionally.
type DatabaseIdentityResolver struct {
	pool *pgxpool.Pool
}

// NewDatabaseIdentityResolver creates an identity resolver backed by the application database.
func NewDatabaseIdentityResolver(pool *pgxpool.Pool) *DatabaseIdentityResolver {
	return &DatabaseIdentityResolver{pool: pool}
}

// ResolveOrCreate reuses a bound user or provisions one standard user for an allowed first login.
func (r *DatabaseIdentityResolver) ResolveOrCreate(ctx context.Context, provider RuntimeProvider, claims IdentityClaims) (auth.CurrentUser, error) {
	if r == nil || r.pool == nil || !provider.ID.Valid || claims.Subject == "" || len(claims.Subject) > maxExternalSubjectBytes || !utf8.ValidString(claims.Subject) {
		return auth.CurrentUser{}, ErrIdentityNotAllowed
	}
	var result auth.CurrentUser
	err := appdb.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		queries := sqlc.New(tx)
		lockKey := uuid.UUID(provider.ID.Bytes).String() + ":" + claims.Subject
		if err := queries.LockExternalIdentityKey(ctx, lockKey); err != nil {
			return err
		}
		currentProvider, err := queries.GetEnabledOIDCProviderByKey(ctx, provider.Key)
		if err != nil || !sameUUID(currentProvider.ID, provider.ID) {
			return ErrLoginFailed
		}

		row, err := queries.GetExternalIdentityUser(ctx, sqlc.GetExternalIdentityUserParams{ProviderID: provider.ID, Subject: claims.Subject})
		if err == nil {
			if row.Status != "active" {
				return ErrUserDisabled
			}
			if err := queries.TouchExternalIdentity(ctx, sqlc.TouchExternalIdentityParams{ProviderID: provider.ID, Subject: claims.Subject}); err != nil {
				return err
			}
			result, err = currentUserFromIdentityRow(row)
			return err
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if !firstLoginAllowed(claims, provider.AllowedEmailDomains) {
			return ErrIdentityNotAllowed
		}
		userID := uuid.New()
		username := externalUsername(provider.Key, claims.Subject)
		nickname := externalNickname(provider.DisplayName, claims)
		createdID, err := queries.CreateOIDCUser(ctx, sqlc.CreateOIDCUserParams{ID: uuidToPGUUID(userID), Username: username, Nickname: nickname})
		if err != nil {
			return err
		}
		if err := queries.CreateExternalIdentity(ctx, sqlc.CreateExternalIdentityParams{ProviderID: provider.ID, Subject: claims.Subject, UserID: createdID}); err != nil {
			return err
		}
		row, err = queries.GetExternalIdentityUser(ctx, sqlc.GetExternalIdentityUserParams{ProviderID: provider.ID, Subject: claims.Subject})
		if err != nil {
			return err
		}
		result, err = currentUserFromIdentityRow(row)
		return err
	})
	return result, err
}

// currentUserFromIdentityRow converts a joined identity row into the existing session model.
func currentUserFromIdentityRow(row sqlc.GetExternalIdentityUserRow) (auth.CurrentUser, error) {
	var permissions []string
	if err := json.Unmarshal(row.Permissions, &permissions); err != nil {
		return auth.CurrentUser{}, err
	}
	return auth.CurrentUser{
		ID: row.UserID, Username: row.Username, Nickname: row.Nickname,
		GroupKey: row.GroupKey, Permissions: permissions,
	}, nil
}

// firstLoginAllowed requires a verified mailbox in the provider's exact domain allowlist.
func firstLoginAllowed(claims IdentityClaims, allowedDomains []string) bool {
	if !claims.EmailVerified {
		return false
	}
	email := strings.TrimSpace(claims.Email)
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email {
		return false
	}
	at := strings.LastIndexByte(email, '@')
	if at <= 0 || at == len(email)-1 {
		return false
	}
	normalized, err := normalizeEmailDomains([]string{email[at+1:]})
	if err != nil {
		return false
	}
	for _, allowed := range allowedDomains {
		if normalized[0] == allowed {
			return true
		}
	}
	return false
}

// externalUsername derives a stable non-reversible local username from an external subject.
func externalUsername(providerKey string, subject string) string {
	digest := sha256.Sum256([]byte(subject))
	suffix := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(digest[:]))[:20]
	return "oidc-" + providerKey + "-" + suffix
}

// externalNickname selects and bounds a human-readable standard claim fallback.
func externalNickname(providerName string, claims IdentityClaims) string {
	for _, candidate := range []string{claims.Name, claims.PreferredUsername, emailLocalPart(claims.Email)} {
		candidate = strings.Join(strings.Fields(candidate), " ")
		if candidate != "" {
			return truncateRunes(candidate, 64)
		}
	}
	fallback := strings.Join(strings.Fields(providerName), " ") + " user"
	return truncateRunes(strings.TrimSpace(fallback), 64)
}

// emailLocalPart extracts a nickname candidate from a syntactically simple mailbox.
func emailLocalPart(value string) string {
	value = strings.TrimSpace(value)
	if at := strings.LastIndexByte(value, '@'); at > 0 {
		return value[:at]
	}
	return ""
}

// truncateRunes preserves UTF-8 while enforcing a Unicode code-point limit.
func truncateRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}

var _ IdentityResolver = (*DatabaseIdentityResolver)(nil)
