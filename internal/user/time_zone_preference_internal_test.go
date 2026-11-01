package user

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type timeZoneFaultStore struct {
	readErr, userErr, groupErr, saveErr error
	row                                 sqlc.GetUserTimeZonePreferenceRow
}

func (s *timeZoneFaultStore) GetUserTimeZonePreference(context.Context, pgtype.UUID) (sqlc.GetUserTimeZonePreferenceRow, error) {
	return s.row, s.readErr
}
func (s *timeZoneFaultStore) LockTimeZonePreferenceUser(context.Context, pgtype.UUID) (sqlc.LockTimeZonePreferenceUserRow, error) {
	return sqlc.LockTimeZonePreferenceUserRow{}, s.userErr
}
func (s *timeZoneFaultStore) LockTimeZonePreferenceGroup(context.Context, pgtype.UUID) (pgtype.UUID, error) {
	return pgtype.UUID{}, s.groupErr
}
func (s *timeZoneFaultStore) SaveUserTimeZonePreference(context.Context, sqlc.SaveUserTimeZonePreferenceParams) (sqlc.SaveUserTimeZonePreferenceRow, error) {
	return sqlc.SaveUserTimeZonePreferenceRow{TimeZone: s.row.TimeZone, UpdatedAt: s.row.UpdatedAt}, s.saveErr
}

// TestTimeZonePreferenceFailures classifies dependency failures without exposing partially produced results.
func TestTimeZonePreferenceFailures(t *testing.T) {
	failure := errors.New("private-database-detail")
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000701", GroupKey: "user"}
	for _, tc := range []struct {
		name                                         string
		read, user, group, save, begin, commit, want error
	}{
		{name: "read missing", read: pgx.ErrNoRows, want: ErrPermissionDenied},
		{name: "read failed", read: failure, want: failure},
		{name: "transaction failed", begin: failure, want: failure},
		{name: "account missing", user: pgx.ErrNoRows, want: ErrPermissionDenied},
		{name: "account failed", user: failure, want: failure},
		{name: "group missing", group: pgx.ErrNoRows, want: ErrPermissionDenied},
		{name: "group failed", group: failure, want: failure},
		{name: "save conflict", save: pgx.ErrNoRows, want: ErrPreferencesConflict},
		{name: "save failed", save: failure, want: failure},
		{name: "commit failed", commit: failure, want: failure},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &timeZoneFaultStore{readErr: tc.read, userErr: tc.user, groupErr: tc.group, saveErr: tc.save, row: sqlc.GetUserTimeZonePreferenceRow{TimeZone: pgtype.Text{String: "UTC", Valid: true}, UpdatedAt: pgtype.Timestamptz{Time: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), Valid: true}}}
			s := &TimeZonePreferenceService{store: store, inTx: func(ctx context.Context, fn func(timeZonePreferenceStore) error) error {
				if tc.begin != nil {
					return tc.begin
				}
				if err := fn(store); err != nil {
					return err
				}
				return tc.commit
			}}
			var result TimeZonePreferenceResult
			var err error
			if tc.read != nil {
				result, err = s.Get(t.Context(), actor)
			} else {
				result, err = s.Update(t.Context(), actor, UpdateTimeZonePreferenceInput{})
			}
			if !errors.Is(err, tc.want) || result.Preference.TimeZone != nil || result.Preference.UpdatedAt != nil {
				t.Fatalf("failure returned data: %#v err=%v want=%v", result, err, tc.want)
			}
		})
	}
	for _, id := range []string{"", "bad", "00000000-0000-0000-0000-000000000000", "00000000000000000000000000000701", "00000000-0000-0000-0000-000000000ABC"} {
		s := &TimeZonePreferenceService{}
		actor := auth.CurrentUser{ID: id}
		if _, err := s.Get(t.Context(), actor); !errors.Is(err, ErrPermissionDenied) {
			t.Fatalf("invalid actor read %s: %v", id, err)
		}
		if _, err := s.Update(t.Context(), actor, UpdateTimeZonePreferenceInput{}); !errors.Is(err, ErrPermissionDenied) {
			t.Fatalf("invalid actor wrote %s: %v", id, err)
		}
	}
	guest := actor
	guest.GroupKey = "guest"
	if _, err := (&TimeZonePreferenceService{}).Get(t.Context(), guest); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("builtin guest identity read: %v", err)
	}
	for _, version := range []string{"bad", "0001-01-01T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-01T00:00:00.1234567891Z"} {
		if _, err := (&TimeZonePreferenceService{}).Update(t.Context(), actor, UpdateTimeZonePreferenceInput{ExpectedUpdatedAt: &version}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid version %s: %v", version, err)
		}
	}
	zone := "Europe/Berlin"
	if _, err := (&TimeZonePreferenceService{}).Update(t.Context(), actor, UpdateTimeZonePreferenceInput{TimeZone: &zone}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unsupported zone: %v", err)
	}
}

type timeZoneFaultPort struct{ err error }

func (p timeZoneFaultPort) Get(context.Context, auth.CurrentUser) (TimeZonePreferenceResult, error) {
	return TimeZonePreferenceResult{}, p.err
}
func (p timeZoneFaultPort) Update(context.Context, auth.CurrentUser, UpdateTimeZonePreferenceInput) (TimeZonePreferenceResult, error) {
	return TimeZonePreferenceResult{}, p.err
}

// TestTimeZonePreferenceHandlerFailures keeps response and diagnostic contents redacted on persistence errors.
func TestTimeZonePreferenceHandlerFailures(t *testing.T) {
	for _, tc := range []struct {
		err          error
		status, code int
	}{{nil, 200, 0}, {ErrInvalidInput, 200, 100001}, {ErrPermissionDenied, 200, 120001}, {ErrPreferencesConflict, 200, 300104}, {errors.New("private-zone-database-secret"), 500, 900000}} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			var logs bytes.Buffer
			h := NewTimeZonePreferenceHandler(timeZoneFaultPort{tc.err}, slog.New(slog.NewJSONHandler(&logs, nil)))
			r := httptest.NewRequestWithContext(t.Context(), method, "/", strings.NewReader(`{"timeZone":null,"expectedUpdatedAt":null}`))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			if method == http.MethodGet {
				h.Get(w, r)
			} else {
				h.Update(w, r)
			}
			var result struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != tc.status || result.Code != tc.code || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("response status=%d code=%d err=%v body=%s", w.Code, result.Code, err, w.Body.String())
			}
			if strings.Contains(w.Body.String()+logs.String(), "private-zone-database-secret") {
				t.Fatal("infrastructure detail leaked")
			}
		}
	}
	h := NewTimeZonePreferenceHandler(timeZoneFaultPort{}, nil)
	w := httptest.NewRecorder()
	h.Get(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil))
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
}

// TestTimeZonePreferenceHandlerRejectsInvalidDocuments exercises rejection at the HTTP boundary.
func TestTimeZonePreferenceHandlerRejectsInvalidDocuments(t *testing.T) {
	valid := "{\"timeZone\":null,\"expectedUpdatedAt\":null}"
	for _, tc := range []struct{ name, media, body string }{
		{"missing media", "", valid},
		{"non JSON", "text/plain", valid},
		{"invalid media", "application/json; broken", valid},
		{"empty", "application/json", ""},
		{"null", "application/json", "null"},
		{"array", "application/json", "[]"},
		{"missing fields", "application/json", "{}"},
		{"unknown field", "application/json", "{\"timeZone\":null,\"expectedUpdatedAt\":null,\"extra\":true}"},
		{"case variant", "application/json", "{\"TimeZone\":null,\"expectedUpdatedAt\":null}"},
		{"second document", "application/json", valid + "{}"},
		{"trailing garbage", "application/json", valid + "garbage"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := NewTimeZonePreferenceHandler(timeZoneFaultPort{}, nil)
			r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/user/time-zone-preference/update", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.media)
			w := httptest.NewRecorder()
			h.Update(w, r)
			var result struct{ Code int }
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != http.StatusOK || result.Code != 100001 || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("invalid document reached success: status=%d code=%d err=%v body=%s", w.Code, result.Code, err, w.Body.String())
			}
		})
	}
}

// TestTimeZonePreferenceJSONStrictness catches malformed field names, delimiters, types and precision documents.
func TestTimeZonePreferenceJSONStrictness(t *testing.T) {
	for _, body := range []string{`{"timeZone":null,"timeZone":null,"expectedUpdatedAt":null}`, `{"`, `{"timeZone":`, `{"timeZone":null,"expectedUpdatedAt":null`, `{"timeZone":null,"expectedUpdatedAt":null,}`, `{"timeZone":[],"expectedUpdatedAt":null}`, `{"timeZone":null,"expectedUpdatedAt":{}}`} {
		if _, err := decodeTimeZonePreferenceInput(strings.NewReader(body)); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("accepted malformed document %s: %v", body, err)
		}
	}
}
