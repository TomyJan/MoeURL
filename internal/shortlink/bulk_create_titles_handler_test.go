package shortlink_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

const titlesHTTPJSON = `{"requestId":"11111111-1111-4111-8111-111111115402","items":[{"targetUrl":"https://example.com/private-title","title":"示例, \"标题\""}]}`

// TestBulkCreateTitlesInvalidHTTPValues catches well-shaped but invalid requests bypassing normalization.
func TestBulkCreateTitlesInvalidHTTPValues(t *testing.T) {
	for name, tc := range map[string]struct {
		body string
		code int
	}{
		"request ID":     {strings.Replace(titlesHTTPJSON, "11111111-1111-4111-8111-111111115402", "invalid", 1), 100001},
		"URL scheme":     {strings.Replace(titlesHTTPJSON, "https://", "ftp://", 1), 200103},
		"duplicate URLs": {`{"requestId":"11111111-1111-4111-8111-111111115402","items":[{"targetUrl":"https://example.com","title":"first"},{"targetUrl":"https://example.com","title":"second"}]}`, 100001},
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			shortlink.NewBulkCreateTitlesHandler(titlesHTTPPort{}, nil).BatchCreateWithTitles(response, request)
			require.Equal(t, 200, response.Code)
			var payload struct {
				Code int `json:"code"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &payload))
			require.Equal(t, tc.code, payload.Code)
			require.NotContains(t, response.Body.String(), `createdCount`)
			require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
		})
	}
}

type titlesHTTPPort struct{ err error }

// BatchCreateWithTitles substitutes only storage while checking the decoded wire contract.
func (p titlesHTTPPort) BatchCreateWithTitles(_ context.Context, _ auth.CurrentUser, input shortlink.BatchCreateWithTitlesInput) (shortlink.BatchCreateResult, error) {
	if input.RequestID != "11111111-1111-4111-8111-111111115402" || len(input.Items) != 1 || input.Items[0].TargetURL != "https://example.com/private-title" || input.Items[0].Title != `示例, "标题"` {
		return shortlink.BatchCreateResult{}, errors.New("wrong decoded title payload")
	}
	return shortlink.BatchCreateResult{RequestID: input.RequestID, CreatedCount: 1}, p.err
}

// TestBulkCreateTitlesHTTPFraming catches strict nested parsing regressions and unbounded bodies.
func TestBulkCreateTitlesHTTPFraming(t *testing.T) {
	row := `{"targetUrl":"https://example.com/private-title","title":"ok"}`
	invalid := []string{
		"", `null`, `[]`, `{}`, `{"requestId":`, titlesHTTPJSON + ` {}`, titlesHTTPJSON + ` trailing`,
		`{"requestId":null,"items":[` + row + `]}`, `{"requestId":12,"items":[` + row + `]}`,
		`{"requestId":"x","requestId":"y","items":[` + row + `]}`,
		`{"requestId":"x","items":null}`, `{"requestId":"x","items":{}}`, `{"requestId":"x","items":[]}`,
		`{"requestId":"x","items":[null]}`, `{"requestId":"x","items":[{}]}`,
		`{"requestId":"x","items":[{"targetUrl":12,"title":"ok"}]}`,
		`{"requestId":"x","items":[{"targetUrl":"https://example.com","title":null}]}`,
		`{"requestId":"x","items":[{"targetUrl":"https://example.com","title":"x","title":"y"}]}`,
		`{"requestId":"x","items":[{"targetUrl":"https://example.com","title":"x","unknown":"y"}]}`,
		`{"requestId":"x","items":[{"targetUrl":"https://example.com","title":"x"}`,
		`{"requestId":"x","items":[{"targetUrl":"https://example.com","title":`,
		`{"requestId":"x","items":[` + row + `,]}`, `{"requestId":"x","items":[` + row + `]`,
		`{"requestId":"x","items":[` + row + `],"extra":true}`,
		`{"requestId":"x","items":[` + row + `],"items":[]}`,
		`{"requestId":"x","items":[` + row + `],`,
		`{"requestId":"11111111-1111-4111-8111-111111115402","items":[` + strings.TrimSuffix(strings.Repeat(row+",", 21), ",") + `]}`,
		strings.Replace(titlesHTTPJSON, "private-title", string([]byte{255}), 1),
		titlesHTTPJSON + strings.Repeat(" ", 65537-len(titlesHTTPJSON)),
	}
	for _, title := range []string{`\ud800`, `\ud801`, `\udfff`, `\ud800\u0041`, `\ud800\\udc00`, `\ud800\uZZZZ`, `\uZZZZ`, `\uD80`, `\ud800x`} {
		invalid = append(invalid, strings.Replace(titlesHTTPJSON, `示例, \"标题\"`, title, 1))
	}
	invalid = append(invalid, `{"requestId":"11111111-1111-4111-8111-111111115402","items":[{"targetUrl":"https://example.com","title":"\u`)
	for i, body := range invalid {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			shortlink.NewBulkCreateTitlesHandler(titlesHTTPPort{}, nil).BatchCreateWithTitles(response, request)
			require.Equal(t, 200, response.Code)
			require.Contains(t, response.Body.String(), `"code":100001`)
			require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
		})
	}
	for _, media := range []string{"", "text/plain", "application/json; broken"} {
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(titlesHTTPJSON))
		request.Header.Set("Content-Type", media)
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateTitlesHandler(titlesHTTPPort{}, nil).BatchCreateWithTitles(response, request)
		require.Contains(t, response.Body.String(), `"code":100001`)
	}
	request := httptest.NewRequestWithContext(t.Context(), "POST", "/", nil)
	request.Header.Set("Content-Type", "application/json")
	request.Body = bulkBrokenBody{}
	response := httptest.NewRecorder()
	shortlink.NewBulkCreateTitlesHandler(titlesHTTPPort{}, nil).BatchCreateWithTitles(response, request)
	require.Contains(t, response.Body.String(), `"code":100001`)
	for _, body := range []string{titlesHTTPJSON, titlesHTTPJSON + strings.Repeat(" ", 65536-len(titlesHTTPJSON))} {
		request = httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json; charset=utf-8")
		response = httptest.NewRecorder()
		shortlink.NewBulkCreateTitlesHandler(titlesHTTPPort{}, nil).BatchCreateWithTitles(response, request)
		require.Contains(t, response.Body.String(), `"code":0`)
		require.Contains(t, response.Body.String(), `"createdCount":1`)
	}
}

type titlesUnicodeHTTPPort struct{ titles *[]string }

// BatchCreateWithTitles records the decoded semantic title without accepting lossy substitutions.
func (p titlesUnicodeHTTPPort) BatchCreateWithTitles(_ context.Context, _ auth.CurrentUser, input shortlink.BatchCreateWithTitlesInput) (shortlink.BatchCreateResult, error) {
	*p.titles = append(*p.titles, input.Items[0].Title)
	return shortlink.BatchCreateResult{RequestID: input.RequestID, CreatedCount: len(input.Items)}, nil
}

// TestBulkCreateTitlesHTTPUnicode preserves real replacement characters, legal pairs and literal escape text.
func TestBulkCreateTitlesHTTPUnicode(t *testing.T) {
	for _, tc := range []struct{ wire, title string }{
		{`\ufffd`, "�"}, {"�", "�"}, {`\ud83d\ude00`, "😀"}, {`\u0041`, "A"}, {`\\ud800`, `\ud800`},
	} {
		var titles []string
		body := strings.Replace(titlesHTTPJSON, `示例, \"标题\"`, tc.wire, 1)
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateTitlesHandler(titlesUnicodeHTTPPort{&titles}, nil).BatchCreateWithTitles(response, request)
		require.Equal(t, 200, response.Code)
		require.Contains(t, response.Body.String(), `"code":0`)
		require.Equal(t, []string{tc.title}, titles)
	}
}

// TestBulkCreateTitlesHTTPOutcomes catches stale-account writes and disclosure of title or database errors.
func TestBulkCreateTitlesHTTPOutcomes(t *testing.T) {
	for _, headers := range [][]string{{"stale"}, {""}, {"owner", "owner"}} {
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(titlesHTTPJSON))
		request.Header.Set("Content-Type", "application/json")
		for _, value := range headers {
			request.Header.Add("X-MoeURL-Expected-User-ID", value)
		}
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateTitlesHandler(titlesHTTPPort{}, nil).BatchCreateWithTitles(response, request)
		require.Contains(t, response.Body.String(), `"code":120001`)
		require.NotContains(t, response.Body.String(), `createdCount`)
	}
	for _, tc := range []struct {
		err          error
		code, status int
	}{
		{nil, 0, 200}, {shortlink.ErrInvalidInput, 100001, 200}, {shortlink.ErrPermissionDenied, 120001, 200},
		{shortlink.ErrBulkCreateConflict, 200120, 200}, {errors.New("private-title 示例 SQLSTATE 23505"), 900000, 500},
	} {
		var logs bytes.Buffer
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(titlesHTTPJSON))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateTitlesHandler(titlesHTTPPort{tc.err}, slog.New(slog.NewJSONHandler(&logs, nil))).BatchCreateWithTitles(response, request)
		require.Equal(t, tc.status, response.Code)
		var body struct {
			Code int `json:"code"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		require.Equal(t, tc.code, body.Code)
		for _, secret := range []string{"private-title", "示例", "SQLSTATE", "23505"} {
			require.NotContains(t, response.Body.String(), secret)
			require.NotContains(t, logs.String(), secret)
		}
	}
}
