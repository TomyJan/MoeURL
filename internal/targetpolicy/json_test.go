package targetpolicy

import (
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

type failedReader struct{}

func (failedReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

// TestPolicyJSONAndStoredVersions catches malformed document coercion and stored
// values/revisions that cannot be safely returned and used in the next CAS.
func TestPolicyJSONAndStoredVersions(t *testing.T) {
	for _, raw := range []string{"", "null", "[]", "{", `{"hosts":`, `{"hosts":[]`, `{"hosts":[],}`, `{"hosts":[]`, `{"hosts":[],"hosts":[]}`, `{"hosts":[],"extra":1}`, `{"hosts":null}`, `{"hosts":[]} {}`, "{\"hosts\":[]}" + string([]byte{255})} {
		_, err := decodeObject([]byte(raw), "hosts")
		require.ErrorIs(t, err, ErrInvalidInput, raw)
	}
	for _, raw := range []string{`{"hosts":4,"expectedUpdatedAt":"x"}`, `{"hosts":[],"expectedUpdatedAt":4}`, `{"hosts":[],"expectedUpdatedAt":"x"} trailing`, strings.Repeat(" ", 32769)} {
		_, err := decodeUpdate(strings.NewReader(raw))
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	_, err := decodeUpdate(failedReader{})
	require.ErrorIs(t, err, ErrInvalidInput)
	input, err := decodeUpdate(strings.NewReader(`{"hosts":[],"expectedUpdatedAt":"2026-11-11T00:00:00.123456Z"}`))
	require.NoError(t, err)
	require.Equal(t, []string{}, input.Hosts)
	require.Equal(t, "2026-11-11T00:00:00.123456Z", input.ExpectedUpdatedAt)
	for _, v := range []string{"x", "0001-01-01T00:00:00Z", "2026-02-31T00:00:00Z", "2026-11-11T00:00:00.123456789Z"} {
		_, err := parseVersion(v)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	base := sqlc.SystemSetting{Key: Key, Value: []byte(`{"hosts":[]}`), UpdatedAt: pgtype.Timestamptz{Valid: true, Time: time.Date(2026, 11, 11, 1, 2, 3, 123456000, time.UTC)}}
	got, err := storedSettings(base)
	require.NoError(t, err)
	require.Equal(t, "2026-11-11T01:02:03.123456Z", got.UpdatedAt)
	for _, raw := range []string{`null`, `{}`, `{"hosts":4}`, `{"hosts":[null]}`, `{"hosts":["UPPER.example"]}`, `{"hosts":["z.example","a.example"]}`} {
		row := base
		row.Value = []byte(raw)
		_, err = storedSettings(row)
		require.ErrorIs(t, err, ErrCorrupt)
	}
	for _, v := range []pgtype.Timestamptz{{}, {Valid: true}, {Valid: true, InfinityModifier: pgtype.Infinity}, {Valid: true, Time: time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC)}, {Valid: true, Time: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}} {
		row := base
		row.UpdatedAt = v
		_, err = storedSettings(row)
		require.ErrorIs(t, err, ErrCorrupt)
	}
	base.Key = "site.name"
	_, err = storedSettings(base)
	require.ErrorIs(t, err, ErrCorrupt)
	for _, raw := range []string{"", "null", "{}", "[4]"} {
		require.ErrorIs(t, authorizeAdmin([]byte(raw), nil), ErrCorrupt)
	}
	require.ErrorIs(t, authorizeAdmin([]byte(`[]`), nil), ErrPermissionDenied)
	require.ErrorIs(t, authorizeAdmin(nil, pgx.ErrNoRows), ErrPermissionDenied)
	boom := errors.New("database unavailable")
	require.ErrorIs(t, authorizeAdmin(nil, boom), boom)
}
