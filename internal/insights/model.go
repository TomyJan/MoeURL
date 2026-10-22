// Package insights provides authorized, bounded reads of anonymous usage data.
package insights

import (
	"context"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
)

var (
	ErrInvalidInput     = errors.New("invalid insight input")
	ErrPermissionDenied = errors.New("insight permission denied")
	ErrLinkMissing      = errors.New("short link not found")
)

// RangeInput selects a preset or an inclusive UTC calendar interval.
type RangeInput struct{ Days, StartDate, EndDate string }

// VisitInput selects a visible link and a bounded page of anonymous visits.
type VisitInput struct {
	RangeInput
	ID, Cursor, DeviceType, CountryCode string
	PageSize                            int32
}

// Range identifies the inclusive UTC dates actually queried.
type Range struct {
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	TimeZone  string `json:"timeZone"`
}

type DashboardSummary struct {
	UserCount             int64 `json:"userCount"`
	ActiveUserCount       int64 `json:"activeUserCount"`
	LinkCount             int64 `json:"linkCount"`
	ActiveLinkCount       int64 `json:"activeLinkCount"`
	TodayCreatedLinkCount int64 `json:"todayCreatedLinkCount"`
	TodayVisitCount       int64 `json:"todayVisitCount"`
	RangeVisitCount       int64 `json:"rangeVisitCount"`
}

type TrendPoint struct {
	Date       string `json:"date"`
	VisitCount int64  `json:"visitCount"`
}

type TopLink struct {
	ID         string `json:"id"`
	Slug       string `json:"slug"`
	URL        string `json:"url"`
	Title      string `json:"title"`
	Deleted    bool   `json:"deleted"`
	VisitCount int64  `json:"visitCount"`
}

type DashboardResult struct {
	Summary     DashboardSummary `json:"summary"`
	Range       Range            `json:"range"`
	Trend       []TrendPoint     `json:"trend"`
	TopLinks    []TopLink        `json:"topLinks"`
	GeneratedAt time.Time        `json:"generatedAt"`
}

type VisitRecord struct {
	ID            string    `json:"id"`
	OccurredAt    time.Time `json:"occurredAt"`
	ReferrerHost  *string   `json:"referrerHost"`
	DeviceType    *string   `json:"deviceType"`
	BrowserFamily *string   `json:"browserFamily"`
	OSFamily      *string   `json:"osFamily"`
	CountryCode   *string   `json:"countryCode"`
}

type VisitResult struct {
	Items      []VisitRecord `json:"items"`
	Range      Range         `json:"range"`
	PageSize   int32         `json:"pageSize"`
	HasMore    bool          `json:"hasMore"`
	NextCursor string        `json:"nextCursor"`
}

// Port keeps usage reads independent from the separately implemented audit port.
type Port interface {
	Dashboard(context.Context, auth.CurrentUser, RangeInput) (DashboardResult, error)
	Visits(context.Context, auth.CurrentUser, VisitInput) (VisitResult, error)
	AdminVisits(context.Context, auth.CurrentUser, VisitInput) (VisitResult, error)
}
