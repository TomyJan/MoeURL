package system

import (
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

const footerProtocolVersion = "2026-10-30T03:00:00.123456Z"

// TestFooterLinksStrictJSON catches Go's permissive duplicate/case/surrogate
// handling and verifies the inclusive 64 KiB boundary with a legal document.
func TestFooterLinksStrictJSON(t *testing.T) {
	const empty = `{"links":[],"expectedUpdatedAt":"2026-10-30T03:00:00.123456Z"}`
	for _, tc := range []struct {
		name, raw string
		valid     bool
		label     string
	}{
		{"empty", empty, true, ""},
		{"field_order", `{"expectedUpdatedAt":"2026-10-30T03:00:00.123456Z","links":[]}`, true, ""},
		{"valid_surrogate_pair", `{"links":[{"label":"\ud83d\ude00","url":"https://example.com/"}],"expectedUpdatedAt":"2026-10-30T03:00:00.123456Z"}`, true, "😀"},
		{"escaped_backslash_is_literal", `{"links":[{"label":"\\ud800","url":"https://example.com/"}],"expectedUpdatedAt":"2026-10-30T03:00:00.123456Z"}`, true, `\ud800`},
		{"body_65536", empty + strings.Repeat(" ", 65536-len(empty)), true, ""},
		{"body_65537", empty + strings.Repeat(" ", 65537-len(empty)), false, ""},
		{"empty_body", "", false, ""},
		{"root_null", "null", false, ""},
		{"root_array", "[]", false, ""},
		{"root_string", `"links"`, false, ""},
		{"root_number", "7", false, ""},
		{"missing_links", `{"expectedUpdatedAt":"x"}`, false, ""},
		{"missing_version", `{"links":[]}`, false, ""},
		{"null_links", `{"links":null,"expectedUpdatedAt":"x"}`, false, ""},
		{"links_object", `{"links":{},"expectedUpdatedAt":"x"}`, false, ""},
		{"null_version", `{"links":[],"expectedUpdatedAt":null}`, false, ""},
		{"version_number", `{"links":[],"expectedUpdatedAt":1}`, false, ""},
		{"wrong_case", `{"Links":[],"expectedUpdatedAt":"x"}`, false, ""},
		{"wrong_case_version", `{"links":[],"ExpectedUpdatedAt":"x"}`, false, ""},
		{"unknown", `{"links":[],"expectedUpdatedAt":"x","updatedAt":"x"}`, false, ""},
		{"duplicate_root", `{"links":[],"links":[],"expectedUpdatedAt":"x"}`, false, ""},
		{"duplicate_escaped_root", `{"links":[],"\u006cinks":[],"expectedUpdatedAt":"x"}`, false, ""},
		{"duplicate_version", `{"links":[],"expectedUpdatedAt":"x","expectedUpdatedAt":"y"}`, false, ""},
		{"item_null", `{"links":[null],"expectedUpdatedAt":"x"}`, false, ""},
		{"item_array", `{"links":[[]],"expectedUpdatedAt":"x"}`, false, ""},
		{"item_missing_url", `{"links":[{"label":"Docs"}],"expectedUpdatedAt":"x"}`, false, ""},
		{"item_missing_label", `{"links":[{"url":"https://example.com/"}],"expectedUpdatedAt":"x"}`, false, ""},
		{"item_null_label", `{"links":[{"label":null,"url":"https://example.com/"}],"expectedUpdatedAt":"x"}`, false, ""},
		{"item_number_url", `{"links":[{"label":"Docs","url":7}],"expectedUpdatedAt":"x"}`, false, ""},
		{"item_wrong_case", `{"links":[{"Label":"Docs","url":"https://example.com/"}],"expectedUpdatedAt":"x"}`, false, ""},
		{"item_unknown", `{"links":[{"label":"Docs","url":"https://example.com/","id":"x"}],"expectedUpdatedAt":"x"}`, false, ""},
		{"duplicate_item", `{"links":[{"label":"Docs","label":"Other","url":"https://example.com/"}],"expectedUpdatedAt":"x"}`, false, ""},
		{"lone_high_surrogate", `{"links":[{"label":"\ud800","url":"https://example.com/"}],"expectedUpdatedAt":"x"}`, false, ""},
		{"lone_low_surrogate", `{"links":[{"label":"\udc00","url":"https://example.com/"}],"expectedUpdatedAt":"x"}`, false, ""},
		{"high_then_nonlow", `{"links":[{"label":"\ud800\u0041","url":"https://example.com/"}],"expectedUpdatedAt":"x"}`, false, ""},
		{"invalid_utf8", string([]byte{123, 34, 108, 105, 110, 107, 115, 34, 58, 34, 255, 34, 125}), false, ""},
		{"trailing_json", empty + "{}", false, ""},
		{"trailing_garbage", empty + "!", false, ""},
		{"truncated", empty[:len(empty)-1], false, ""},
		{"bad_escape", `{"links":[],"expectedUpdatedAt":"\q"}`, false, ""},
		{"bad_unicode_escape", `{"links":[],"expectedUpdatedAt":"\u00xz"}`, false, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := decodeFooterLinksUpdate(strings.NewReader(tc.raw))
			if !tc.valid {
				require.ErrorIs(t, err, ErrInvalidFooterLinks)
				require.Equal(t, UpdateFooterLinksInput{}, got)
				return
			}
			require.NoError(t, err)
			require.Equal(t, footerProtocolVersion, got.ExpectedUpdatedAt)
			if tc.label == "" {
				require.NotNil(t, got.Links)
				require.Empty(t, got.Links)
			} else {
				require.Equal(t, []FooterLink{{tc.label, "https://example.com/"}}, got.Links)
			}
		})
	}
	t.Run("read_failure", func(t *testing.T) {
		_, err := decodeFooterLinksUpdate(footerBrokenReader{})
		require.ErrorIs(t, err, ErrInvalidFooterLinks)
	})
}

type footerBrokenReader struct{}

func (footerBrokenReader) Read([]byte) (int, error) { return 0, errors.New("reader unavailable") }

var _ io.Reader = footerBrokenReader{}

func TestFooterLinksVersionAndStored(t *testing.T) {
	for _, raw := range []string{footerProtocolVersion, "2026-10-30T11:00:00.123456+08:00", "2026-10-30T03:00:00.123456789Z"} {
		t.Run("valid_"+raw, func(t *testing.T) {
			got, err := footerLinksVersion(raw)
			require.NoError(t, err)
			want, err := time.Parse(time.RFC3339Nano, raw)
			require.NoError(t, err)
			require.True(t, want.Equal(got))
		})
	}
	for _, raw := range []string{"", "0001-01-01T00:00:00Z", "2026-10-30", "2026-10-30T03:00:00", "2026-10-30T03:00:00z", "2026-10-30T03:00:00,123Z", "-0001-01-01T00:00:00Z", "10000-01-01T00:00:00Z", "2026-10-30T03:00:60Z"} {
		t.Run("invalid_"+raw, func(t *testing.T) { _, err := footerLinksVersion(raw); require.ErrorIs(t, err, ErrInvalidFooterLinks) })
	}
	stamp := time.Date(2026, 10, 30, 3, 0, 0, 123456000, time.UTC)
	row := sqlc.SystemSetting{Key: footerLinksKey, Value: []byte(`{"links":[{"label":"Docs","url":"https://example.com/"}]}`), UpdatedAt: pgtype.Timestamptz{Time: stamp, Valid: true}}
	t.Run("valid_stored", func(t *testing.T) {
		got, err := storedFooterLinks(row)
		require.NoError(t, err)
		require.Equal(t, FooterLinksSettings{FooterLinks: FooterLinks{Links: []FooterLink{{"Docs", "https://example.com/"}}}, UpdatedAt: footerProtocolVersion}, got)
	})
	t.Run("empty_stored_is_array", func(t *testing.T) {
		v := row
		v.Value = []byte(`{"links":[]}`)
		got, err := storedFooterLinks(v)
		require.NoError(t, err)
		require.NotNil(t, got.Links)
		require.Empty(t, got.Links)
	})
	for name, body := range map[string]string{
		"missing": "{}", "null": `{"links":null}`, "unknown": `{"links":[],"extra":1}`, "case": `{"Links":[]}`, "duplicate": `{"links":[],"links":[]}`, "trailing": `{"links":[]} {}`,
		"bad_url": `{"links":[{"label":"Docs","url":"javascript:alert(1)"}]}`, "noncanonical_label": `{"links":[{"label":" Docs ","url":"https://example.com/"}]}`, "noncanonical_url": `{"links":[{"label":"Docs","url":"HTTPS://EXAMPLE.COM/"}]}`, "surrogate": `{"links":[{"label":"\ud800","url":"https://example.com/"}]}`,
	} {
		t.Run("corrupt_"+name, func(t *testing.T) {
			v := row
			v.Value = []byte(body)
			_, err := storedFooterLinks(v)
			require.ErrorIs(t, err, ErrCorruptFooterLinks)
		})
	}
	for _, tc := range []struct {
		name   string
		change func(*sqlc.SystemSetting)
	}{
		{"wrong_key", func(v *sqlc.SystemSetting) { v.Key = "site.appearance" }},
		{"null_time", func(v *sqlc.SystemSetting) { v.UpdatedAt.Valid = false }},
		{"infinite_time", func(v *sqlc.SystemSetting) { v.UpdatedAt.InfinityModifier = pgtype.Infinity }},
		{"zero_time", func(v *sqlc.SystemSetting) { v.UpdatedAt.Time = time.Time{} }},
		{"negative_year", func(v *sqlc.SystemSetting) { v.UpdatedAt.Time = time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC) }},
		{"five_digit_year", func(v *sqlc.SystemSetting) { v.UpdatedAt.Time = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := row
			tc.change(&v)
			_, err := storedFooterLinks(v)
			require.ErrorIs(t, err, ErrCorruptFooterLinks)
		})
	}
}
