package shortlink

import (
	"context"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestAnalyticsWithQueriesPropagatesAggregateFailures verifies every aggregate query failure is returned.
func TestAnalyticsWithQueriesPropagatesAggregateFailures(t *testing.T) {
	linkID := uuid.New()
	tests := []struct {
		name    string
		queries analyticsQueryStub
	}{
		{name: "summary", queries: analyticsQueryStub{summaryErr: errors.New("summary")}},
		{name: "trend", queries: analyticsQueryStub{trendErr: errors.New("trend")}},
		{name: "referrers", queries: analyticsQueryStub{referrerErr: errors.New("referrers")}},
		{name: "devices", queries: analyticsQueryStub{deviceErr: errors.New("devices")}},
		{name: "countries", queries: analyticsQueryStub{countryErr: errors.New("countries")}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := analyticsWithQueries(context.Background(), test.queries, linkID, ShortLink{})
			if err == nil || err.Error() != test.name {
				t.Fatalf("analytics error = %v", err)
			}
		})
	}
}

type analyticsQueryStub struct {
	summaryErr  error
	trendErr    error
	referrerErr error
	deviceErr   error
	countryErr  error
}

func (s analyticsQueryStub) GetShortLinkAnalyticsSummary(context.Context, pgtype.UUID) (sqlc.GetShortLinkAnalyticsSummaryRow, error) {
	return sqlc.GetShortLinkAnalyticsSummaryRow{}, s.summaryErr
}

func (s analyticsQueryStub) ListShortLinkDailyVisits(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkDailyVisitsRow, error) {
	return nil, s.trendErr
}

func (s analyticsQueryStub) ListShortLinkReferrerStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkReferrerStatsRow, error) {
	return nil, s.referrerErr
}

func (s analyticsQueryStub) ListShortLinkDeviceStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkDeviceStatsRow, error) {
	return nil, s.deviceErr
}

func (s analyticsQueryStub) ListShortLinkCountryStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkCountryStatsRow, error) {
	return nil, s.countryErr
}

func TestInternalServiceHelpers(t *testing.T) {
	if uuidFromPgtype(pgtype.UUID{}) != "" {
		t.Fatal("expected invalid pgtype UUID to become empty string")
	}

	value := uuid.New()
	if uuidFromPgtype(uuidToPgtype(value)) != value.String() {
		t.Fatal("expected valid pgtype UUID to round trip")
	}

	if buildShortLinkURL("http://go.example.com/", "abc123") != "http://go.example.com/abc123" {
		t.Fatal("expected http host to be preserved")
	}
	if buildShortLinkURL("https://go.example.com/", "abc123") != "https://go.example.com/abc123" {
		t.Fatal("expected https host to be preserved")
	}

	if isUniqueViolation(nil) {
		t.Fatal("expected nil error to not be unique violation")
	}
	if !isUniqueViolation(&pgconn.PgError{Code: "23505"}) {
		t.Fatal("expected PostgreSQL unique violation to be detected")
	}
	if isUniqueViolation(errors.New("plain error")) {
		t.Fatal("expected plain error to not be unique violation")
	}
}

func TestReservedSlugsIncludeSingularPageRoutes(t *testing.T) {
	for _, slug := range []string{"api", "assets", "setup", "login", "link", "links", "admin", "LINK"} {
		if !isReservedSlug(slug) {
			t.Fatalf("expected %q to be reserved", slug)
		}
	}

	if isReservedSlug("abc123") {
		t.Fatal("expected ordinary slug to be available")
	}
}
