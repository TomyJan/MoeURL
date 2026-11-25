package shortlink

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
)

const manifestRestoreServiceRequestID = "a1111111-1111-4111-8111-111111115609"

func validManifestRestoreServiceInput(count int) ManifestRestoreInput {
	items := make([]ManifestRestoreItem, count)
	for i := range items {
		items[i] = ManifestRestoreItem{
			DomainOrigin:             "https://go.example",
			Slug:                     fmt.Sprintf("doc%03d", i),
			TargetURL:                fmt.Sprintf("https://target.example/path/%d", i),
			Title:                    "Restored title",
			Tags:                     []string{"docs", "saved"},
			Status:                   "active",
			RedirectMode:             RedirectModeDirect,
			IntermediateDelaySeconds: "5",
		}
	}
	input := ManifestRestoreInput{RequestID: manifestRestoreServiceRequestID, Items: items}
	input.rawPayloadDigest = sha256.Sum256([]byte("exact original body"))
	input.rawPayloadSize = manifestRestoreServicePayloadSize(input)
	return input
}

func manifestRestoreServicePayloadSize(input ManifestRestoreInput) int {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(input); err != nil {
		panic(err)
	}
	return buffer.Len() - 1
}

func TestNormalizeManifestRestoreReconstructsOnlyAllowedFields(t *testing.T) {
	input := validManifestRestoreServiceInput(1)
	requestID, digest, records, err := normalizeManifestRestore(input)
	if err != nil {
		t.Fatalf("normalize valid manifest: %v", err)
	}
	if requestID.String() != input.RequestID {
		t.Fatalf("request id = %s, want %s", requestID, input.RequestID)
	}
	if len(records) != 1 {
		t.Fatalf("record count = %d, want 1", len(records))
	}
	record := records[0]
	if record.domainOrigin != "https://go.example" || record.slug != "doc000" || record.targetURL != "https://target.example/path/0" {
		t.Fatalf("unexpected core restore fields: %#v", record)
	}
	if record.title != "Restored title" || strings.Join(record.tags, ",") != "docs,saved" || record.status != "active" {
		t.Fatalf("unexpected metadata or status: %#v", record)
	}
	if record.redirectMode != RedirectModeDirect || record.intermediateDelaySeconds != defaultIntermediateDelay || record.expiresAt.Valid || record.maxVisits.Valid {
		t.Fatalf("unexpected default access fields: %#v", record)
	}
	versioned := sha256.Sum256(append([]byte("moeurl:manifest-restore:v1:"), input.rawPayloadDigest[:]...))
	if digest != versioned {
		t.Fatalf("digest = %s, want versioned raw-payload digest %s", hex.EncodeToString(digest[:]), hex.EncodeToString(versioned[:]))
	}
}

func TestNormalizeManifestRestoreAcceptsOneHundredRowsAndRejectsInvalidBounds(t *testing.T) {
	input := validManifestRestoreServiceInput(100)
	_, _, records, err := normalizeManifestRestore(input)
	if err != nil || len(records) != 100 {
		t.Fatalf("100 rows: records=%d err=%v", len(records), err)
	}
	input = validManifestRestoreServiceInput(101)
	if _, _, _, err := normalizeManifestRestore(input); err != ErrInvalidInput {
		t.Fatalf("101 rows error = %v, want ErrInvalidInput", err)
	}
	input = validManifestRestoreServiceInput(1)
	input.Items = nil
	if _, _, _, err := normalizeManifestRestore(input); err != ErrInvalidInput {
		t.Fatalf("empty rows error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeManifestRestoreRejectsInvalidRowsAndKeepsDigestVersioned(t *testing.T) {
	cases := map[string]func(*ManifestRestoreInput){
		"noncanonical request id": func(in *ManifestRestoreInput) { in.RequestID = strings.ToUpper(in.RequestID) },
		"zero request id":         func(in *ManifestRestoreInput) { in.RequestID = uuid.Nil.String() },
		"duplicate slug":          func(in *ManifestRestoreInput) { in.Items = append(in.Items, in.Items[0]) },
		"uppercase slug":          func(in *ManifestRestoreInput) { in.Items[0].Slug = "Doc000" },
		"reserved slug":           func(in *ManifestRestoreInput) { in.Items[0].Slug = "admin" },
		"invalid origin":          func(in *ManifestRestoreInput) { in.Items[0].DomainOrigin = "https://go.example/path" },
		"invalid target":          func(in *ManifestRestoreInput) { in.Items[0].TargetURL = "javascript:alert(1)" },
		"invalid title controls":  func(in *ManifestRestoreInput) { in.Items[0].Title = "bad\nline" },
		"invalid title UTF-8":     func(in *ManifestRestoreInput) { in.Items[0].Title = string([]byte{0xff}) },
		"duplicate tags":          func(in *ManifestRestoreInput) { in.Items[0].Tags = []string{"same", "same"} },
		"invalid status":          func(in *ManifestRestoreInput) { in.Items[0].Status = "enabled" },
		"invalid redirect mode":   func(in *ManifestRestoreInput) { in.Items[0].RedirectMode = "DIRECT" },
		"delay out of range":      func(in *ManifestRestoreInput) { in.Items[0].IntermediateDelaySeconds = "11" },
		"noncanonical max visits": func(in *ManifestRestoreInput) { in.Items[0].MaxVisits = "01" },
		"nonutc expiration":       func(in *ManifestRestoreInput) { in.Items[0].ExpiresAt = "2099-01-01T00:00:00+00:00" },
		"invalid expiration date": func(in *ManifestRestoreInput) { in.Items[0].ExpiresAt = "2099-02-30T00:00:00Z" },
		"payload over budget": func(in *ManifestRestoreInput) {
			in.rawPayloadSize = manifestRestoreRequestLimit + 1
			in.Items[0].Title = strings.Repeat("x", manifestRestoreRequestLimit)
		},
	}
	for name, alter := range cases {
		t.Run(name, func(t *testing.T) {
			input := validManifestRestoreServiceInput(1)
			alter(&input)
			if _, _, _, err := normalizeManifestRestore(input); err == nil {
				t.Fatal("normalize invalid manifest succeeded")
			}
		})
	}

	first := validManifestRestoreServiceInput(1)
	second := validManifestRestoreServiceInput(1)
	second.rawPayloadDigest = sha256.Sum256([]byte("different original body"))
	_, firstDigest, _, err := normalizeManifestRestore(first)
	if err != nil {
		t.Fatalf("normalize first body: %v", err)
	}
	_, secondDigest, _, err := normalizeManifestRestore(second)
	if err != nil {
		t.Fatalf("normalize second body: %v", err)
	}
	if firstDigest == secondDigest {
		t.Fatal("different raw request payloads reused a restore digest")
	}
}

func TestNormalizeManifestRestoreCanonicalizesOriginAndAccessOptions(t *testing.T) {
	input := validManifestRestoreServiceInput(1)
	input.Items[0].DomainOrigin = "https://BÜCHER.example:443/"
	input.Items[0].RedirectMode = RedirectModeIntermediate
	input.Items[0].IntermediateDelaySeconds = "10"
	input.Items[0].ExpiresAt = "2099-01-02T03:04:05.123456789Z"
	input.Items[0].MaxVisits = "2147483647"
	_, _, records, err := normalizeManifestRestore(input)
	if err != nil {
		t.Fatalf("normalize canonicalizable origin: %v", err)
	}
	record := records[0]
	if record.domainOrigin != "https://xn--bcher-kva.example" {
		t.Fatalf("origin = %q, want canonical IDNA origin", record.domainOrigin)
	}
	if record.intermediateDelaySeconds != 10 || !record.expiresAt.Valid || record.expiresAt.Time.Nanosecond() != 123456789 || !record.maxVisits.Valid || record.maxVisits.Int64 != 2147483647 {
		t.Fatalf("access options were not preserved: %#v", record)
	}
}

func TestNormalizeManifestRestoreUsesActualRawJSONBudget(t *testing.T) {
	input := validManifestRestoreServiceInput(1)
	input.Items[0].TargetURL = "https://target.example/path?" + strings.Repeat("x&", 190000)
	input.rawPayloadSize = manifestRestoreServicePayloadSize(input)
	if input.rawPayloadSize >= manifestRestoreRequestLimit {
		t.Fatalf("fixture raw body unexpectedly exceeds budget: %d", input.rawPayloadSize)
	}
	if _, _, _, err := normalizeManifestRestore(input); err != nil {
		t.Fatalf("valid raw JSON below 1 MiB was rejected because of canonical escaping: %v", err)
	}
}

func TestRestoreManifestRejectsInvalidActorBeforeDatabaseAccess(t *testing.T) {
	service := &Service{}
	input := validManifestRestoreServiceInput(1)
	for _, actorID := range []string{"", uuid.Nil.String(), "A1111111-1111-4111-8111-111111115602", "not-a-uuid"} {
		t.Run(actorID, func(t *testing.T) {
			_, err := service.RestoreManifest(context.Background(), auth.CurrentUser{ID: actorID}, input)
			if err != ErrPermissionDenied {
				t.Fatalf("invalid actor error = %v, want ErrPermissionDenied before database access", err)
			}
		})
	}
}

func TestRestoreManifestRejectsInvalidPayloadBeforeDatabaseAccess(t *testing.T) {
	service := &Service{}
	input := validManifestRestoreServiceInput(1)
	input.Items[0].Status = "unknown"
	_, err := service.RestoreManifest(context.Background(), auth.CurrentUser{ID: "a1111111-1111-4111-8111-111111115602"}, input)
	if err != ErrInvalidInput {
		t.Fatalf("invalid payload error = %v, want ErrInvalidInput before database access", err)
	}
}

func TestManifestRestoreQuotaSplitsOneHundredRowsWithinExistingQuotaLimit(t *testing.T) {
	var batches []int
	err := consumeManifestRestoreQuota(100, func(count int) error {
		batches = append(batches, count)
		return nil
	})
	if err != nil {
		t.Fatalf("consume manifest quota: %v", err)
	}
	want := []int{20, 20, 20, 20, 20}
	if !slices.Equal(batches, want) {
		t.Fatalf("quota batches = %v, want %v", batches, want)
	}
}

func TestManifestRestoreQuotaRejectsInvalidBoundsWithoutConsumption(t *testing.T) {
	for _, count := range []int{-1, 0, 101} {
		calls := 0
		err := consumeManifestRestoreQuota(count, func(int) error { calls++; return nil })
		if err != ErrInvalidInput || calls != 0 {
			t.Fatalf("count %d: error=%v calls=%d, want invalid input without consumption", count, err, calls)
		}
	}
	if err := consumeManifestRestoreQuota(1, nil); err != ErrInvalidInput {
		t.Fatalf("nil consumer error=%v, want invalid input", err)
	}
}

func TestManifestRestoreQuotaPropagatesConsumerFailure(t *testing.T) {
	want := errors.New("quota storage unavailable")
	calls := 0
	err := consumeManifestRestoreQuota(21, func(int) error {
		calls++
		return want
	})
	if !errors.Is(err, want) || calls != 1 {
		t.Fatalf("quota error=%v calls=%d, want wrapped consumer error after one call", err, calls)
	}
}

func TestAuthorizeManifestRestoreRechecksCurrentFieldCapabilities(t *testing.T) {
	input := validManifestRestoreServiceInput(1)
	_, _, records, err := normalizeManifestRestore(input)
	if err != nil {
		t.Fatalf("normalize fixture: %v", err)
	}
	cases := []struct {
		name    string
		group   string
		grants  []string
		records []manifestRestoreRecord
	}{
		{name: "guest cannot create", group: permission.GroupGuest, grants: []string{permission.ShortLinkCreate, permission.ShortLinkCustomSlug, permission.ShortLinkSetMetadata}},
		{name: "create permission required", group: permission.GroupUser, grants: []string{permission.ShortLinkCustomSlug, permission.ShortLinkSetMetadata}},
		{name: "custom slug permission required", group: permission.GroupUser, grants: []string{permission.ShortLinkCreate, permission.ShortLinkSetMetadata}},
		{name: "disabled requires update own", group: permission.GroupUser, grants: []string{permission.ShortLinkCreate, permission.ShortLinkCustomSlug, permission.ShortLinkSetMetadata}, records: withManifestRestoreStatus(records, "disabled")},
		{name: "confirmation requires permission", group: permission.GroupUser, grants: []string{permission.ShortLinkCreate, permission.ShortLinkCustomSlug, permission.ShortLinkSetMetadata}, records: withManifestRestoreMode(records, RedirectModeConfirmation)},
		{name: "metadata requires permission", group: permission.GroupUser, grants: []string{permission.ShortLinkCreate, permission.ShortLinkCustomSlug}},
		{name: "empty structured metadata still requires permission", group: permission.GroupUser, grants: []string{permission.ShortLinkCreate, permission.ShortLinkCustomSlug}, records: withManifestRestoreEmptyMetadata(records)},
		{name: "expiration requires permission", group: permission.GroupUser, grants: []string{permission.ShortLinkCreate, permission.ShortLinkCustomSlug, permission.ShortLinkSetMetadata}, records: withManifestRestoreExpiration(records)},
		{name: "non-default countdown requires permission", group: permission.GroupUser, grants: []string{permission.ShortLinkCreate, permission.ShortLinkCustomSlug, permission.ShortLinkSetMetadata}, records: withManifestRestoreIntermediateDelay(records, 10)},
		{name: "visit limit requires permission", group: permission.GroupUser, grants: []string{permission.ShortLinkCreate, permission.ShortLinkCustomSlug, permission.ShortLinkSetMetadata}, records: withManifestRestoreVisitLimit(records)},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			grantJSON, err := json.Marshal(test.grants)
			if err != nil {
				t.Fatal(err)
			}
			grants, err := permission.DecodeSnapshot(grantJSON)
			if err != nil {
				t.Fatal(err)
			}
			items := test.records
			if items == nil {
				items = records
			}
			if err := authorizeManifestRestore(test.group, grants, items); err != ErrPermissionDenied {
				t.Fatalf("authorization error = %v, want ErrPermissionDenied", err)
			}
		})
	}
}

func TestNormalizeManifestStoredDomainOriginSupportsLegacyBareHost(t *testing.T) {
	for _, test := range []struct{ stored, want string }{
		{stored: "go.example.com", want: "https://go.example.com"},
		{stored: "https://GO.example.com:443/", want: "https://go.example.com"},
		{stored: "http://127.0.0.1:8080", want: "http://127.0.0.1:8080"},
	} {
		got, err := normalizeManifestStoredOrigin(test.stored)
		if err != nil || got != test.want {
			t.Errorf("normalize stored origin %q = %q, %v; want %q", test.stored, got, err, test.want)
		}
	}
	if _, err := normalizeManifestStoredOrigin("https://go.example.com/path"); err == nil {
		t.Fatal("stored domain with a path was accepted")
	}
}

func withManifestRestoreStatus(records []manifestRestoreRecord, status string) []manifestRestoreRecord {
	copyOfRecords := append([]manifestRestoreRecord(nil), records...)
	copyOfRecords[0].status = status
	return copyOfRecords
}

func withManifestRestoreMode(records []manifestRestoreRecord, mode string) []manifestRestoreRecord {
	copyOfRecords := append([]manifestRestoreRecord(nil), records...)
	copyOfRecords[0].redirectMode = mode
	return copyOfRecords
}

func withManifestRestoreIntermediateDelay(records []manifestRestoreRecord, seconds int16) []manifestRestoreRecord {
	copyOfRecords := append([]manifestRestoreRecord(nil), records...)
	copyOfRecords[0].intermediateDelaySeconds = seconds
	return copyOfRecords
}

func withManifestRestoreExpiration(records []manifestRestoreRecord) []manifestRestoreRecord {
	copyOfRecords := append([]manifestRestoreRecord(nil), records...)
	copyOfRecords[0].expiresAt.Valid = true
	return copyOfRecords
}

func withManifestRestoreVisitLimit(records []manifestRestoreRecord) []manifestRestoreRecord {
	copyOfRecords := append([]manifestRestoreRecord(nil), records...)
	copyOfRecords[0].maxVisits.Valid = true
	return copyOfRecords
}

func withManifestRestoreEmptyMetadata(records []manifestRestoreRecord) []manifestRestoreRecord {
	copyOfRecords := append([]manifestRestoreRecord(nil), records...)
	copyOfRecords[0].title = ""
	copyOfRecords[0].tags = nil
	return copyOfRecords
}
