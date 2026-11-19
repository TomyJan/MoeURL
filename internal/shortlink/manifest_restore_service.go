package shortlink

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/createquota"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const manifestRestoreDigestPrefix = "moeurl:manifest-restore:v1:"

type manifestRestoreRecord struct {
	domainOrigin             string
	slug                     string
	targetURL                string
	title                    string
	tags                     []string
	status                   string
	redirectMode             string
	intermediateDelaySeconds int16
	expiresAt                pgtype.Timestamptz
	maxVisits                pgtype.Int8
}

// RestoreManifest atomically recreates manifest rows as new links owned by the current actor.
func (s *Service) RestoreManifest(ctx context.Context, actor auth.CurrentUser, input ManifestRestoreInput) (BatchCreateResult, error) {
	actorID, err := uuid.Parse(actor.ID)
	if err != nil || actorID == uuid.Nil || actorID.String() != actor.ID {
		return BatchCreateResult{}, ErrPermissionDenied
	}
	requestID, digest, records, err := normalizeManifestRestore(input)
	if err != nil {
		return BatchCreateResult{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	result := BatchCreateResult{RequestID: requestID.String()}
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		if err := targetpolicy.LockTargets(ctx, tx); err != nil {
			return err
		}
		if err := createquota.LockCreation(ctx, tx); err != nil {
			return err
		}
		if err := domain.LockShortLinkCreation(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		current, err := q.LockBulkCreateActor(ctx, uuidToPgtype(actorID))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		if current.Status != "active" || current.DeletedAt.Valid {
			return ErrPermissionDenied
		}
		group, err := q.LockTransferActorGroup(ctx, current.GroupID)
		if err != nil {
			return err
		}
		grants, err := permission.DecodeSnapshot(group.Permissions)
		if err != nil {
			return err
		}
		if err := authorizeManifestRestore(group.Key, grants, records); err != nil {
			return err
		}

		receipt, err := q.GetBulkCreateReceipt(ctx, sqlc.GetBulkCreateReceiptParams{
			ActorID: uuidToPgtype(actorID), RequestID: uuidToPgtype(requestID),
		})
		if err == nil {
			if !bytes.Equal(receipt.RequestHash, digest[:]) {
				return ErrBulkCreateConflict
			}
			result.CreatedCount = int(receipt.CreatedCount)
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		domains, err := q.ListAvailableShortLinkDomains(ctx, sqlc.ListAvailableShortLinkDomainsParams{
			GroupKey: group.Key, CanDefault: grants.Has(permission.DomainUseDefault),
			CanAssigned: grants.Has(permission.DomainUseAssigned),
		})
		if err != nil {
			return err
		}
		domainByOrigin := make(map[string]sqlc.ListAvailableShortLinkDomainsRow, len(domains))
		for _, available := range domains {
			origin, err := normalizeManifestStoredOrigin(available.Host)
			if err == nil {
				domainByOrigin[origin] = available
			}
		}
		domainIDs := make(map[string]pgtype.UUID)
		for _, record := range records {
			if _, exists := domainIDs[record.domainOrigin]; exists {
				continue
			}
			available, exists := domainByOrigin[record.domainOrigin]
			if !exists {
				return ErrDomainUnavailable
			}
			required := permission.DomainUseAssigned
			if available.IsDefault {
				required = permission.DomainUseDefault
			}
			selected, err := q.GetGrantedShortLinkDomainForCreate(ctx, sqlc.GetGrantedShortLinkDomainForCreateParams{
				GroupKey: group.Key, RequiredPermission: required, CustomSlug: true,
				UseDefault: available.IsDefault, DomainID: uuidToPgtype(uuid.UUID(available.ID.Bytes)),
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrDomainUnavailable
			}
			if err != nil {
				return err
			}
			selectedOrigin, err := normalizeManifestStoredOrigin(selected.Host)
			if err != nil || selectedOrigin != record.domainOrigin {
				return ErrDomainUnavailable
			}
			domainIDs[record.domainOrigin] = selected.ID
		}

		targets := make([]string, len(records))
		for index, record := range records {
			targets[index] = record.targetURL
		}
		if err := checkNewTargets(ctx, q, targets); err != nil {
			return err
		}
		if err := createquota.ConsumeMany(ctx, q, uuidToPgtype(actorID), len(records)); err != nil {
			return err
		}
		now, err := q.GetDatabaseTime(ctx)
		if err != nil {
			return err
		}
		for _, record := range records {
			if record.expiresAt.Valid && !record.expiresAt.Time.After(now.Time) {
				return ErrInvalidExpiration
			}
		}

		for _, record := range records {
			_, err := q.CreateShortLink(ctx, sqlc.CreateShortLinkParams{
				ID: uuidToPgtype(uuid.New()), OwnerID: uuidToPgtype(actorID), DomainID: domainIDs[record.domainOrigin],
				Slug: record.slug, TargetUrl: record.targetURL, Status: record.status,
				RedirectMode: record.redirectMode, IntermediateDelaySeconds: record.intermediateDelaySeconds,
				ExpiresAt: record.expiresAt, MaxVisits: record.maxVisits,
				Title: pgtype.Text{String: record.title, Valid: true}, Tags: metadataTags(record.tags),
			})
			if isSlugConflict(err) {
				return ErrSlugConflict
			}
			if err != nil {
				return err
			}
		}
		if err := q.InsertBulkCreateReceipt(ctx, sqlc.InsertBulkCreateReceiptParams{
			ActorID: uuidToPgtype(actorID), RequestID: uuidToPgtype(requestID),
			RequestHash: digest[:], CreatedCount: int16(len(records)),
		}); err != nil {
			return err
		}
		result.CreatedCount = len(records)
		return nil
	})
	if err != nil {
		return BatchCreateResult{}, err
	}
	return result, nil
}

// normalizeManifestStoredOrigin accepts current origins and legacy scheme-less domain hosts.
func normalizeManifestStoredOrigin(host string) (string, error) {
	if !strings.Contains(host, "://") {
		host = "https://" + host
	}
	return domain.NormalizeOrigin(host, true)
}

// authorizeManifestRestore applies current database grants to every reconstructed field.
func authorizeManifestRestore(groupKey string, grants permission.Snapshot, records []manifestRestoreRecord) error {
	if (groupKey != permission.GroupUser && groupKey != permission.GroupAdmin) ||
		!grants.Has(permission.ShortLinkCreate) || !grants.Has(permission.ShortLinkCustomSlug) || !grants.Has(permission.ShortLinkSetMetadata) {
		return ErrPermissionDenied
	}
	for _, record := range records {
		if record.status == "disabled" && !grants.Has(permission.ShortLinkUpdateOwn) {
			return ErrPermissionDenied
		}
		if required := redirectModePermission(record.redirectMode); required != "" && !grants.Has(required) {
			return ErrPermissionDenied
		}
		if record.expiresAt.Valid && !grants.Has(permission.ShortLinkSetExpiration) {
			return ErrPermissionDenied
		}
		if record.intermediateDelaySeconds != defaultIntermediateDelay && !grants.Has(permission.ShortLinkUseIntermediate) {
			return ErrPermissionDenied
		}
		if record.maxVisits.Valid && !grants.Has(permission.ShortLinkSetMaxVisits) {
			return ErrPermissionDenied
		}
	}
	return nil
}

// consumeManifestRestoreQuota preserves the existing twenty-item quota helper limit in one transaction.
func consumeManifestRestoreQuota(count int, consume func(int) error) error {
	if count < 1 || count > manifestRestoreMaxItems || consume == nil {
		return ErrInvalidInput
	}
	for count > 0 {
		batch := count
		if batch > 20 {
			batch = 20
		}
		if err := consume(batch); err != nil {
			return err
		}
		count -= batch
	}
	return nil
}

// normalizeManifestRestore validates the direct service contract and drops snapshot-only data.
func normalizeManifestRestore(input ManifestRestoreInput) (uuid.UUID, [sha256.Size]byte, []manifestRestoreRecord, error) {
	requestID, err := uuid.Parse(input.RequestID)
	if err != nil || requestID == uuid.Nil || requestID.String() != input.RequestID || len(input.Items) == 0 || len(input.Items) > manifestRestoreMaxItems {
		return uuid.Nil, [sha256.Size]byte{}, nil, ErrInvalidInput
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return uuid.Nil, [sha256.Size]byte{}, nil, ErrInvalidInput
	}
	actualPayloadSize := input.rawPayloadSize
	if actualPayloadSize <= 0 {
		actualPayloadSize = len(encoded)
	}
	if actualPayloadSize > manifestRestoreRequestLimit {
		return uuid.Nil, [sha256.Size]byte{}, nil, ErrInvalidInput
	}
	payloadDigest := input.rawPayloadDigest
	if payloadDigest == ([sha256.Size]byte{}) {
		payloadDigest = sha256.Sum256(encoded)
	}
	versionedDigest := sha256.Sum256(append([]byte(manifestRestoreDigestPrefix), payloadDigest[:]...))

	records := make([]manifestRestoreRecord, len(input.Items))
	seenSlugs := make(map[string]struct{}, len(input.Items))
	for i, item := range input.Items {
		record, err := normalizeManifestRestoreItem(item)
		if err != nil {
			return uuid.Nil, [sha256.Size]byte{}, nil, err
		}
		if _, exists := seenSlugs[record.slug]; exists {
			return uuid.Nil, [sha256.Size]byte{}, nil, ErrInvalidInput
		}
		seenSlugs[record.slug] = struct{}{}
		records[i] = record
	}
	return requestID, versionedDigest, records, nil
}

func normalizeManifestRestoreItem(item ManifestRestoreItem) (manifestRestoreRecord, error) {
	origin, err := domain.NormalizeOrigin(item.DomainOrigin, true)
	if err != nil {
		return manifestRestoreRecord{}, ErrInvalidInput
	}
	slug, err := normalizeCustomSlug(item.Slug)
	if err != nil || slug != item.Slug {
		return manifestRestoreRecord{}, ErrInvalidInput
	}
	if !utf8.ValidString(item.TargetURL) || containsControl(item.TargetURL) || validateTargetURL(item.TargetURL) != nil {
		return manifestRestoreRecord{}, ErrInvalidInput
	}
	if !utf8.ValidString(item.Title) {
		return manifestRestoreRecord{}, ErrInvalidInput
	}
	title := strings.TrimSpace(item.Title)
	if utf8.RuneCountInString(title) > 120 || containsControl(title) {
		return manifestRestoreRecord{}, ErrInvalidInput
	}
	tags, err := normalizeTags(item.Tags)
	if err != nil {
		return manifestRestoreRecord{}, ErrInvalidInput
	}
	if !isAllowedStatus(item.Status) || !isAllowedRedirectMode(item.RedirectMode) {
		return manifestRestoreRecord{}, ErrInvalidInput
	}
	delay, err := normalizeManifestRestoreDelay(item.IntermediateDelaySeconds, item.RedirectMode)
	if err != nil {
		return manifestRestoreRecord{}, err
	}
	expiresAt, err := parseManifestRestoreExpiration(item.ExpiresAt)
	if err != nil {
		return manifestRestoreRecord{}, err
	}
	maxVisits, err := parseBulkVisitLimit(item.MaxVisits)
	if err != nil {
		return manifestRestoreRecord{}, err
	}
	return manifestRestoreRecord{
		domainOrigin: origin, slug: slug, targetURL: item.TargetURL, title: title, tags: tags,
		status: item.Status, redirectMode: item.RedirectMode, intermediateDelaySeconds: delay,
		expiresAt: expiresAt, maxVisits: maxVisits,
	}, nil
}

func normalizeManifestRestoreDelay(value, mode string) (int16, error) {
	if mode == RedirectModeIntermediate {
		return parseBulkCountdown(value, mode)
	}
	parsed, err := strconv.ParseInt(value, 10, 16)
	if err != nil || parsed < 3 || parsed > 10 {
		return 0, ErrInvalidInput
	}
	return int16(parsed), nil
}

func parseManifestRestoreExpiration(value string) (pgtype.Timestamptz, error) {
	if value == "" {
		return pgtype.Timestamptz{}, nil
	}
	if !strings.HasSuffix(value, "Z") {
		return pgtype.Timestamptz{}, ErrInvalidInput
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || parsed.Year() < 1 || parsed.UTC().Format(time.RFC3339Nano) != value {
		return pgtype.Timestamptz{}, ErrInvalidInput
	}
	return pgtype.Timestamptz{Time: parsed.UTC(), Valid: true}, nil
}
