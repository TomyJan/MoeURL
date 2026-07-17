package shortlink

import "time"

type CreateInput struct {
	TargetURL string
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

type UpdateInput struct {
	ID        string
	TargetURL *string
	Status    *string
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

type ShortLink struct {
	ID        string          `json:"id"`
	URL       string          `json:"url"`
	Slug      string          `json:"slug"`
	TargetURL string          `json:"targetUrl"`
	Status    string          `json:"status"`
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
	ID        string          `json:"id"`
	URL       string          `json:"url"`
	Slug      string          `json:"slug"`
	TargetURL string          `json:"targetUrl"`
	Status    string          `json:"status"`
	Stats     *ShortLinkStats `json:"stats,omitempty"`
	Owner     OwnerSummary    `json:"owner"`
}

type AdminListResult struct {
	Items    []AdminShortLink `json:"items"`
	Page     int32            `json:"page"`
	PageSize int32            `json:"pageSize"`
	Total    int64            `json:"total"`
}
