package shortlink

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	RedirectModeDirect       = "direct"
	RedirectModeIntermediate = "intermediate"
	RedirectModeConfirmation = "confirmation"
	ExpirationModeNever      = "never"
	ExpirationModeAt         = "at"
	PasswordModeNever        = "never"
	PasswordModeSet          = "set"
)

type ExpirationInput struct {
	Mode      string     `json:"mode"`
	ExpiresAt *time.Time `json:"expiresAt"`
}

type PasswordInput struct {
	Mode  string `json:"mode"`
	Value string `json:"value,omitempty"`
}

type UnlockInput struct {
	Password string `json:"password"`
}

type AccessGrant struct {
	Token     string
	ExpiresAt time.Time
}

type CreateInput struct {
	TargetURL                string           `json:"targetUrl"`
	RedirectMode             string           `json:"redirectMode"`
	IntermediateDelaySeconds int16            `json:"intermediateDelaySeconds"`
	Expiration               *ExpirationInput `json:"expiration"`
	Password                 *PasswordInput   `json:"password"`
}

type CreateResult struct {
	ShortLink ShortLink `json:"shortLink"`
}

type ListInput struct {
	Page     int32
	PageSize int32
	Status   string
	Query    string
}

// OverviewResult contains personal short-link and visit aggregates.
type OverviewResult struct {
	TotalLinkCount  int64 `json:"totalLinkCount"`
	ActiveLinkCount int64 `json:"activeLinkCount"`
	VisitCount      int64 `json:"visitCount"`
	TodayVisitCount int64 `json:"todayVisitCount"`
}

type UpdateInput struct {
	ID                       string           `json:"id"`
	TargetURL                *string          `json:"targetUrl"`
	Status                   *string          `json:"status"`
	RedirectMode             *string          `json:"redirectMode"`
	IntermediateDelaySeconds *int16           `json:"intermediateDelaySeconds"`
	Expiration               *ExpirationInput `json:"expiration"`
	Password                 *PasswordInput   `json:"password"`
}

type DeleteInput struct {
	ID string
}

// StatisticsInput identifies the short link to analyze.
type StatisticsInput struct {
	ID string
}

// StatisticsResult contains a visible short link and its visit analytics.
type StatisticsResult struct {
	ShortLink ShortLink      `json:"shortLink"`
	Stats     AnalyticsStats `json:"stats"`
}

// AnalyticsStats contains aggregate metrics for a short link.
type AnalyticsStats struct {
	VisitCount      int64                 `json:"visitCount"`
	TodayVisitCount int64                 `json:"todayVisitCount"`
	LastVisitedAt   *time.Time            `json:"lastVisitedAt"`
	Trend           []AnalyticsTrendPoint `json:"trend"`
	Referrers       []AnalyticsDimension  `json:"referrers"`
	Devices         []AnalyticsDimension  `json:"devices"`
	Countries       []AnalyticsDimension  `json:"countries"`
}

// AnalyticsTrendPoint contains visits for one calendar day.
type AnalyticsTrendPoint struct {
	Date       string `json:"date"`
	VisitCount int64  `json:"visitCount"`
}

// AnalyticsDimension contains visits grouped by a normalized dimension value.
type AnalyticsDimension struct {
	Value      string `json:"value"`
	VisitCount int64  `json:"visitCount"`
}

type ListResult struct {
	Items    []ShortLink `json:"items"`
	Page     int32       `json:"page"`
	PageSize int32       `json:"pageSize"`
	Total    int64       `json:"total"`
}

type AccessConfig struct {
	RedirectMode             string     `json:"redirectMode"`
	IntermediateDelaySeconds int16      `json:"intermediateDelaySeconds"`
	ExpiresAt                *time.Time `json:"expiresAt"`
	Expired                  bool       `json:"expired"`
	PasswordEnabled          bool       `json:"passwordEnabled"`
}

type accessConfigOptions struct {
	expired         bool
	passwordEnabled bool
}

// setAccessConfig maps persisted access controls into the shared API model.
func (config *AccessConfig) setAccessConfig(redirectMode string, delay int16, expiresAt pgtype.Timestamptz, options accessConfigOptions) {
	config.RedirectMode = redirectMode
	config.IntermediateDelaySeconds = delay
	config.ExpiresAt, config.Expired = expirationValues(expiresAt, options.expired)
	config.PasswordEnabled = options.passwordEnabled
}

type ShortLink struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Slug      string `json:"slug"`
	TargetURL string `json:"targetUrl"`
	Status    string `json:"status"`
	AccessConfig
	CreatedAt time.Time       `json:"createdAt"`
	Stats     *ShortLinkStats `json:"stats,omitempty"`
}

type ShortLinkStats struct {
	VisitCount      int64      `json:"visitCount"`
	TodayVisitCount int64      `json:"todayVisitCount"`
	LastVisitedAt   *time.Time `json:"lastVisitedAt"`
}

type OwnerSummary struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Nickname string `json:"nickname"`
}

type AdminShortLink struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Slug      string `json:"slug"`
	TargetURL string `json:"targetUrl"`
	Status    string `json:"status"`
	AccessConfig
	CreatedAt time.Time       `json:"createdAt"`
	Stats     *ShortLinkStats `json:"stats,omitempty"`
	Owner     OwnerSummary    `json:"owner"`
}

type AdminListResult struct {
	Items    []AdminShortLink `json:"items"`
	Page     int32            `json:"page"`
	PageSize int32            `json:"pageSize"`
	Total    int64            `json:"total"`
}
