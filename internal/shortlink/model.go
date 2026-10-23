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
	VisitLimitModeLimited    = "limited"
	VisitLimitModeUnlimited  = "unlimited"
)

// VisitLimitInput changes the current quota period without exposing a reset operation.
type VisitLimitInput struct {
	Mode      string `json:"mode"`
	MaxVisits *int64 `json:"maxVisits,omitempty"`
}

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
	CustomSlug               *string          `json:"customSlug,omitempty"`
	Metadata                 *MetadataInput   `json:"metadata,omitempty"`
	TargetURL                string           `json:"targetUrl"`
	DomainID                 *string          `json:"domainId,omitempty"`
	RedirectMode             string           `json:"redirectMode"`
	IntermediateDelaySeconds *int16           `json:"intermediateDelaySeconds"`
	Expiration               *ExpirationInput `json:"expiration"`
	Password                 *PasswordInput   `json:"password"`
	MaxVisits                *int64           `json:"maxVisits,omitempty"`
}

type CreateResult struct {
	ShortLink ShortLink `json:"shortLink"`
}

type ListInput struct {
	Page     int32
	PageSize int32
	Status   string
	Query    string
	Tag      string
}

// OverviewResult contains personal short-link and visit aggregates.
type OverviewResult struct {
	TotalLinkCount  int64 `json:"totalLinkCount"`
	ActiveLinkCount int64 `json:"activeLinkCount"`
	VisitCount      int64 `json:"visitCount"`
	TodayVisitCount int64 `json:"todayVisitCount"`
}

type UpdateInput struct {
	Metadata                 *MetadataInput   `json:"metadata,omitempty"`
	ID                       string           `json:"id"`
	TargetURL                *string          `json:"targetUrl"`
	Status                   *string          `json:"status"`
	RedirectMode             *string          `json:"redirectMode"`
	IntermediateDelaySeconds *int16           `json:"intermediateDelaySeconds"`
	Expiration               *ExpirationInput `json:"expiration"`
	Password                 *PasswordInput   `json:"password"`
	VisitLimit               *VisitLimitInput `json:"visitLimit,omitempty"`
}

type DeleteInput struct {
	ID string
}

// StatisticsInput identifies the short link to analyze.
type StatisticsInput struct {
	ID        string
	Days      string
	StartDate string
	EndDate   string
}

// StatisticsResult contains a visible short link and its visit analytics.
type StatisticsResult struct {
	ShortLink ShortLink      `json:"shortLink"`
	Stats     AnalyticsStats `json:"stats"`
	Range     AnalyticsRange `json:"range"`
}

// AnalyticsRange identifies the inclusive UTC calendar dates used by analytics.
type AnalyticsRange struct {
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	TimeZone  string `json:"timeZone"`
}

// AnalyticsStats contains aggregate metrics for a short link.
type AnalyticsStats struct {
	RangeVisitCount int64                 `json:"rangeVisitCount"`
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

// VisitLimit describes the current quota period for a managed short link.
type VisitLimit struct {
	MaxVisits       *int64 `json:"maxVisits"`
	VisitsUsed      int64  `json:"visitsUsed"`
	VisitsRemaining *int64 `json:"visitsRemaining"`
	Exhausted       bool   `json:"exhausted"`
}

// setVisitLimit maps persisted quota state into the shared API model.
func (limit *VisitLimit) setVisitLimit(maxVisits pgtype.Int8, visitsUsed int64) {
	limit.VisitsUsed = visitsUsed
	if !maxVisits.Valid {
		limit.MaxVisits = nil
		limit.VisitsRemaining = nil
		limit.Exhausted = false
		return
	}

	maxValue := maxVisits.Int64
	remaining := maxValue - visitsUsed
	if remaining < 0 {
		remaining = 0
	}
	limit.MaxVisits = &maxValue
	limit.VisitsRemaining = &remaining
	limit.Exhausted = visitsUsed >= maxValue
}

type ShortLink struct {
	Title     string   `json:"title"`
	Tags      []string `json:"tags"`
	ID        string   `json:"id"`
	URL       string   `json:"url"`
	Slug      string   `json:"slug"`
	TargetURL string   `json:"targetUrl"`
	Status    string   `json:"status"`
	AccessConfig
	VisitLimit
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
	UpdatedAt time.Time `json:"updatedAt"`
	Title     string    `json:"title"`
	Tags      []string  `json:"tags"`
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	Slug      string    `json:"slug"`
	TargetURL string    `json:"targetUrl"`
	Status    string    `json:"status"`
	AccessConfig
	VisitLimit
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
