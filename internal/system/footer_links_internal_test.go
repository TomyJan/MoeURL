package system

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestFooterLinksURLContract is shared verbatim with the frontend; expectations
// are literal data, never computed with the normalizer or by contacting targets.
func TestFooterLinksURLContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", "footer-links-urls.json"))
	require.NoError(t, err)
	var cases []struct {
		Name       string `json:"name"`
		Input      string `json:"input"`
		Valid      bool   `json:"valid"`
		Normalized string `json:"normalized"`
	}
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.Greater(t, len(cases), 75)
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			value, err := normalizeFooterLinkURL(tc.Input)
			if !tc.Valid {
				require.ErrorIs(t, err, ErrInvalidFooterLinks)
				require.Empty(t, value)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.Normalized, value)
		})
	}
}

// TestFooterLinksNormalization catches UTF16 counting, over-trimming BOM,
// silently dropping rows, implicit deduplication, and in-place input mutation.
func TestFooterLinksNormalization(t *testing.T) {
	for _, tc := range []struct {
		name  string
		links []FooterLink
		want  []FooterLink
		valid bool
	}{
		{"empty_array", []FooterLink{}, []FooterLink{}, true},
		{"nil_is_not_array", nil, nil, false},
		{"trim_codepoints_preserve_duplicates", []FooterLink{{"  Docs　", " HTTPS://EXAMPLE.COM:443/a "}, {"😀", "http://localhost/"}, {"  Docs　", " HTTPS://EXAMPLE.COM:443/a "}}, []FooterLink{{"Docs", "https://example.com/a"}, {"😀", "http://localhost/"}, {"Docs", "https://example.com/a"}}, true},
		{"one_codepoint", []FooterLink{{"a", "https://example.com/"}}, []FooterLink{{"a", "https://example.com/"}}, true},
		{"forty_emoji", []FooterLink{{strings.Repeat("😀", 40), "https://example.com/"}}, []FooterLink{{strings.Repeat("😀", 40), "https://example.com/"}}, true},
		{"forty_one_emoji", []FooterLink{{strings.Repeat("😀", 41), "https://example.com/"}}, nil, false},
		{"bom_is_content", []FooterLink{{"\uFEFF", "https://example.com/"}}, []FooterLink{{"\uFEFF", "https://example.com/"}}, true},
		{"empty_label", []FooterLink{{"　  ", "https://example.com/"}}, nil, false},
		{"Cc_before_trim", []FooterLink{{"\tDocs", "https://example.com/"}}, nil, false},
		{"Cc_C1", []FooterLink{{"a\u0085b", "https://example.com/"}}, nil, false},
		{"invalid_utf8", []FooterLink{{string([]byte{0xff}), "https://example.com/"}}, nil, false},
		{"empty_url", []FooterLink{{"Docs", ""}}, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before, err := json.Marshal(tc.links)
			require.NoError(t, err)
			value, err := normalizeFooterLinks(tc.links)
			if tc.valid {
				require.NoError(t, err)
				require.Equal(t, tc.want, value.Links)
			} else {
				require.ErrorIs(t, err, ErrInvalidFooterLinks)
			}
			after, err := json.Marshal(tc.links)
			require.NoError(t, err)
			require.Equal(t, string(before), string(after))
		})
	}
	t.Run("five_allowed_six_rejected", func(t *testing.T) {
		links := make([]FooterLink, 5)
		for i := range links {
			links[i] = FooterLink{"Docs", "http://localhost/"}
		}
		value, err := normalizeFooterLinks(links)
		require.NoError(t, err)
		require.Equal(t, links, value.Links)
		_, err = normalizeFooterLinks(append(links, links[0]))
		require.ErrorIs(t, err, ErrInvalidFooterLinks)
	})
	t.Run("URL_byte_boundary", func(t *testing.T) {
		url := "https://example.com/" + strings.Repeat("a", 2048-len("https://example.com/"))
		value, err := normalizeFooterLinks([]FooterLink{{"Docs", url}})
		require.NoError(t, err)
		require.Equal(t, url, value.Links[0].URL)
		_, err = normalizeFooterLinks([]FooterLink{{"Docs", url + "a"}})
		require.ErrorIs(t, err, ErrInvalidFooterLinks)
	})
}
