package targetpolicy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/stretchr/testify/require"
)

// suffixPortResult isolates only external service I/O. Protocol assertions below
// inspect real encoded responses, not a mock's invocation count.
type suffixPortResult struct{ err error }

func (p suffixPortResult) Get(context.Context, auth.CurrentUser) (SuffixSettings, error) {
	return SuffixSettings{Suffixes: []string{"saved.example"}, UpdatedAt: "2026-11-11T00:00:00Z"}, p.err
}
func (p suffixPortResult) Update(_ context.Context, _ auth.CurrentUser, input SuffixUpdateInput) (SuffixSettings, error) {
	return SuffixSettings{Suffixes: input.Suffixes, UpdatedAt: input.ExpectedUpdatedAt}, p.err
}

// TestSuffixHandlerFramingAndErrors catches form requests, query ambiguity,
// incomplete decoding and sensitive infrastructure details in logs/responses.
func TestSuffixHandlerFramingAndErrors(t *testing.T) {
	valid := `{"suffixes":["typed.example"],"expectedUpdatedAt":"2026-11-11T00:00:00Z"}`
	for _, tc := range []struct {
		name, method, url, media, body string
		err                            error
		status, code                   int
	}{
		{"get", "GET", "/policy", "", "", nil, 200, 0},
		{"get query", "GET", "/policy?x=1", "", "", nil, 200, 900216},
		{"get empty query", "GET", "/policy?", "", "", nil, 200, 900216},
		{"save", "POST", "/policy", "application/json", valid, nil, 200, 0},
		{"form", "POST", "/policy", "text/plain", valid, nil, 200, 900216},
		{"bad media", "POST", "/policy", "application/json; charset", valid, nil, 200, 900216},
		{"save query", "POST", "/policy?x=1", "application/json", valid, nil, 200, 900216},
		{"save empty query", "POST", "/policy?", "application/json", valid, nil, 200, 900216},
		{"bad body", "POST", "/policy", "application/json", "null", nil, 200, 900216},
		{"denied", "GET", "/policy", "", "", ErrPermissionDenied, 200, 120001},
		{"invalid service", "POST", "/policy", "application/json", valid, ErrInvalidInput, 200, 900216},
		{"conflict", "POST", "/policy", "application/json", valid, ErrConflict, 200, 900217},
		{"get infra", "GET", "/policy", "", "", errors.New("private.example database detail"), 500, 900000},
		{"save infra", "POST", "/policy", "application/json", valid, errors.New("private.example database detail"), 500, 900000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var log bytes.Buffer
			h := NewSuffixHandler(suffixPortResult{tc.err}, slog.New(slog.NewTextHandler(&log, nil)))
			r := httptest.NewRequest(tc.method, tc.url, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.media)
			w := httptest.NewRecorder()
			if tc.method == "GET" {
				h.Get(w, r)
			} else {
				h.Update(w, r)
			}
			require.Equal(t, tc.status, w.Code)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			var body struct {
				Code int
				Data *SuffixSettings
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			require.Equal(t, tc.code, body.Code)
			if tc.code == 0 {
				require.NotNil(t, body.Data)
				if tc.method == "POST" {
					require.Equal(t, []string{"typed.example"}, body.Data.Suffixes)
				}
			} else {
				require.Nil(t, body.Data)
			}
			require.NotContains(t, w.Body.String(), "private.example")
			require.NotContains(t, log.String(), "private.example")
		})
	}
	h := NewSuffixHandler(suffixPortResult{}, nil)
	w := httptest.NewRecorder()
	h.Get(w, httptest.NewRequest("GET", "/policy", nil))
	require.Equal(t, 200, w.Code)
}
