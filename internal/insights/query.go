package insights

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/url"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type normalizedRange struct {
	response          Range
	start, end, today time.Time
}

// normalizeRange validates calendar bounds and derives half-open UTC timestamps.
func normalizeRange(input RangeInput, now time.Time) (normalizedRange, error) {
	today := now.UTC().Truncate(24 * time.Hour)
	end := today
	var start time.Time
	if input.StartDate != "" || input.EndDate != "" {
		if input.Days != "" || input.StartDate == "" || input.EndDate == "" {
			return normalizedRange{}, ErrInvalidInput
		}
		var err error
		start, err = time.Parse(time.DateOnly, input.StartDate)
		if err != nil || start.Year() < 1 {
			return normalizedRange{}, ErrInvalidInput
		}
		end, err = time.Parse(time.DateOnly, input.EndDate)
		if err != nil || end.Year() < 1 || end.Before(start) || end.After(today) || end.Sub(start) > 89*24*time.Hour {
			return normalizedRange{}, ErrInvalidInput
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
			return normalizedRange{}, ErrInvalidInput
		}
		start = today.AddDate(0, 0, 1-days)
	}
	return normalizedRange{Range{start.Format(time.DateOnly), end.Format(time.DateOnly), "UTC"}, start, end.AddDate(0, 0, 1), today}, nil
}

// validateRangeSyntax rejects malformed inputs before obtaining database time.
func validateRangeSyntax(input RangeInput) error {
	_, err := normalizeRange(input, time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC))
	return err
}

type visitCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

// decodeCursor accepts canonical, bounded JSON with exactly one timestamp and UUID.
func decodeCursor(raw string) (visitCursor, error) {
	if raw == "" {
		return visitCursor{ID: uuid.Nil.String()}, nil
	}
	if len(raw) > 512 {
		return visitCursor{}, ErrInvalidInput
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(raw)
	if err != nil || base64.RawURLEncoding.EncodeToString(data) != raw {
		return visitCursor{}, ErrInvalidInput
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return visitCursor{}, ErrInvalidInput
	}
	values := map[string]json.RawMessage{}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return visitCursor{}, ErrInvalidInput
		}
		name := key.(string)
		if _, exists := values[name]; exists || (name != "createdAt" && name != "id") {
			return visitCursor{}, ErrInvalidInput
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return visitCursor{}, ErrInvalidInput
		}
		values[name] = value
	}
	if _, err := decoder.Token(); err != nil {
		return visitCursor{}, ErrInvalidInput
	}
	if _, err := decoder.Token(); err != io.EOF {
		return visitCursor{}, ErrInvalidInput
	}
	var cursor visitCursor
	if len(values) != 2 || json.Unmarshal(values["createdAt"], &cursor.CreatedAt) != nil || json.Unmarshal(values["id"], &cursor.ID) != nil || cursor.CreatedAt.IsZero() || cursor.CreatedAt.UTC().Year() < 1 || !validUUID(cursor.ID) {
		return visitCursor{}, ErrInvalidInput
	}
	return cursor, nil
}

// encodeCursor serializes trusted database values for the next keyset page.
func encodeCursor(at time.Time, id string) string {
	data, _ := json.Marshal(visitCursor{at.UTC(), id})
	return base64.RawURLEncoding.EncodeToString(data)
}

// validUUID accepts only canonical nonzero UUIDs at public identifier boundaries.
func validUUID(raw string) bool {
	id, err := uuid.Parse(raw)
	return err == nil && id != uuid.Nil && id.String() == raw
}

// validateVisits bounds identifiers, filters and page size before any database read.
func validateVisits(input VisitInput) (VisitInput, visitCursor, error) {
	if !validUUID(input.ID) || validateRangeSyntax(input.RangeInput) != nil || input.PageSize < 0 || input.PageSize > 100 {
		return input, visitCursor{}, ErrInvalidInput
	}
	if input.PageSize == 0 {
		input.PageSize = 25
	}
	switch input.DeviceType {
	case "", "desktop", "mobile", "tablet", "bot", "other", "unknown":
	default:
		return input, visitCursor{}, ErrInvalidInput
	}
	country := input.CountryCode
	if country != "" && country != "unknown" && (len(country) != 2 || country[0] < 'A' || country[0] > 'Z' || country[1] < 'A' || country[1] > 'Z') {
		return input, visitCursor{}, ErrInvalidInput
	}
	cursor, err := decodeCursor(input.Cursor)
	return input, cursor, err
}

// parseQuery rejects duplicated, empty and unknown keys without normalizing untrusted values.
func parseQuery(raw string, visits bool) (VisitInput, error) {
	query, err := url.ParseQuery(raw)
	if err != nil {
		return VisitInput{}, ErrInvalidInput
	}
	for key, values := range query {
		allowed := key == "days" || key == "startDate" || key == "endDate"
		if visits {
			allowed = allowed || key == "id" || key == "pageSize" || key == "cursor" || key == "deviceType" || key == "countryCode"
		}
		if !allowed || len(values) != 1 || values[0] == "" {
			return VisitInput{}, ErrInvalidInput
		}
	}
	input := VisitInput{RangeInput: RangeInput{query.Get("days"), query.Get("startDate"), query.Get("endDate")}, ID: query.Get("id"), Cursor: query.Get("cursor"), DeviceType: query.Get("deviceType"), CountryCode: query.Get("countryCode")}
	if rawSize := query.Get("pageSize"); rawSize != "" {
		size, err := strconv.ParseInt(rawSize, 10, 32)
		if err != nil || size < 1 || size > 100 || strconv.FormatInt(size, 10) != rawSize {
			return VisitInput{}, ErrInvalidInput
		}
		input.PageSize = int32(size)
	}
	return input, nil
}

// timestamp binds an already validated instant without relying on session time zones.
func timestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}

// nullableDimension preserves old missing fields as JSON null.
func nullableDimension(value pgtype.Text) *string {
	if !value.Valid || value.String == "" {
		return nil
	}
	return &value.String
}
