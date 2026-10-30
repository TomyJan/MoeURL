package system

import (
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

const footerLinksKey = "site.footer_links"

var ErrInvalidFooterLinks = errors.New("invalid footer links")

var (
	ErrFooterLinksConflict    = errors.New("footer links conflict")
	ErrCorruptFooterLinks     = errors.New("corrupt persisted footer links")
	footerLinksVersionPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`)
)

// FooterLink is one ordered, literal-text navigation target.
type FooterLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// FooterLinks contains only the public navigation list.
type FooterLinks struct {
	Links []FooterLink `json:"links"`
}

// FooterLinksSettings adds the independent full-precision management revision.
type FooterLinksSettings struct {
	FooterLinks
	UpdatedAt string `json:"updatedAt"`
}

// UpdateFooterLinksInput replaces the ordered list against one complete version.
type UpdateFooterLinksInput struct {
	Links             []FooterLink
	ExpectedUpdatedAt string
}

func footerLinksVersion(raw string) (time.Time, error) {
	if !footerLinksVersionPattern.MatchString(raw) {
		return time.Time{}, ErrInvalidFooterLinks
	}
	version, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil || version.IsZero() {
		return time.Time{}, ErrInvalidFooterLinks
	}
	return version, nil
}

// storedFooterLinks refuses malformed or noncanonical content and unusable
// revisions rather than silently repairing persisted administrator values.
func storedFooterLinks(row sqlc.SystemSetting) (FooterLinksSettings, error) {
	input, err := footerLinksDocument(row.Value, false)
	if err != nil {
		return FooterLinksSettings{}, ErrCorruptFooterLinks
	}
	normalized, err := normalizeFooterLinks(input.Links)
	if err != nil || !slices.Equal(normalized.Links, input.Links) || row.Key != footerLinksKey ||
		!row.UpdatedAt.Valid || row.UpdatedAt.InfinityModifier != pgtype.Finite || row.UpdatedAt.Time.IsZero() {
		return FooterLinksSettings{}, ErrCorruptFooterLinks
	}
	version := row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano)
	if _, err := footerLinksVersion(version); err != nil {
		return FooterLinksSettings{}, ErrCorruptFooterLinks
	}
	return FooterLinksSettings{FooterLinks: normalized, UpdatedAt: version}, nil
}

func normalizeFooterLinks(links []FooterLink) (FooterLinks, error) {
	if links == nil || len(links) > 5 {
		return FooterLinks{}, ErrInvalidFooterLinks
	}
	result := FooterLinks{Links: make([]FooterLink, len(links))}
	for i, link := range links {
		if !footerTextValid(link.Label) {
			return FooterLinks{}, ErrInvalidFooterLinks
		}
		label := strings.TrimSpace(link.Label)
		if count := utf8.RuneCountInString(label); count < 1 || count > 40 {
			return FooterLinks{}, ErrInvalidFooterLinks
		}
		target, err := normalizeFooterLinkURL(link.URL)
		if err != nil {
			return FooterLinks{}, err
		}
		result.Links[i] = FooterLink{Label: label, URL: target}
	}
	return result, nil
}

// footerTextValid checks raw text before whitespace normalization; Cc must not
// be erased by trimming, while BOM remains an ordinary, counted codepoint.
func footerTextValid(raw string) bool {
	if !utf8.ValidString(raw) {
		return false
	}
	for _, r := range raw {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
