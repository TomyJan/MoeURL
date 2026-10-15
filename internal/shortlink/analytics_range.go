package shortlink

import (
	"net/url"
	"time"
)

type normalizedAnalyticsRange struct {
	response          AnalyticsRange
	start, end, today time.Time
}

// normalizeAnalyticsRange resolves calendar dates against one captured server time.
func normalizeAnalyticsRange(input StatisticsInput, now time.Time) (normalizedAnalyticsRange, error) {
	today := now.UTC().Truncate(24 * time.Hour)
	var start time.Time
	end := today
	if input.StartDate != "" || input.EndDate != "" {
		if input.Days != "" || input.StartDate == "" || input.EndDate == "" {
			return normalizedAnalyticsRange{}, ErrInvalidInput
		}
		var err error
		start, err = time.Parse(time.DateOnly, input.StartDate)
		if err != nil {
			return normalizedAnalyticsRange{}, ErrInvalidInput
		}
		end, err = time.Parse(time.DateOnly, input.EndDate)
		if err != nil {
			return normalizedAnalyticsRange{}, ErrInvalidInput
		}
		if end.Before(start) || end.After(today) || end.Sub(start) > 89*24*time.Hour {
			return normalizedAnalyticsRange{}, ErrInvalidInput
		}
	} else {
		days := 7
		switch input.Days {
		case "", "7":
		case "30":
			days = 30
		case "90":
			days = 90
		default:
			return normalizedAnalyticsRange{}, ErrInvalidInput
		}
		start = today.AddDate(0, 0, 1-days)
	}
	return normalizedAnalyticsRange{
		response: AnalyticsRange{StartDate: start.Format(time.DateOnly), EndDate: end.Format(time.DateOnly), TimeZone: "UTC"},
		start:    start, end: end.AddDate(0, 0, 1), today: today,
	}, nil
}

// statisticsInput rejects repeated or explicitly empty range parameters before service dispatch.
func statisticsInput(rawQuery string) (StatisticsInput, error) {
	query, err := url.ParseQuery(rawQuery)
	if err != nil {
		return StatisticsInput{}, ErrInvalidInput
	}
	for _, key := range []string{"days", "startDate", "endDate"} {
		if values, exists := query[key]; exists && (len(values) != 1 || values[0] == "") {
			return StatisticsInput{}, ErrInvalidInput
		}
	}
	return StatisticsInput{ID: query.Get("id"), Days: query.Get("days"), StartDate: query.Get("startDate"), EndDate: query.Get("endDate")}, nil
}
