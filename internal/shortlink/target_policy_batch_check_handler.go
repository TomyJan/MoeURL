package shortlink

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
)

// TargetPolicyBatchCheckHandler exposes a bounded administrator-only decision set.
type TargetPolicyBatchCheckHandler struct {
	service TargetPolicyBatchCheckPort
	logger  *slog.Logger
}

// NewTargetPolicyBatchCheckHandler binds the independent no-store batch action.
func NewTargetPolicyBatchCheckHandler(service TargetPolicyBatchCheckPort, logger *slog.Logger) *TargetPolicyBatchCheckHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &TargetPolicyBatchCheckHandler{service: service, logger: logger}
}

// decodeTargetPolicyBatchCheck preserves original strings and rejects ambiguous
// keys, invalid Unicode, extra values and payloads over 256 KiB before decoding.
func decodeTargetPolicyBatchCheck(body io.Reader) (TargetPolicyBatchCheckInput, error) {
	invalid := ErrTargetPolicyBatchCheckInvalidInput
	raw, err := io.ReadAll(io.LimitReader(body, 262145))
	if err != nil || len(raw) > 262144 || !utf8.Valid(raw) || !validBulkTitleUnicodeEscapes(raw) {
		return TargetPolicyBatchCheckInput{}, invalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	start, err := d.Token()
	if err != nil || start != json.Delim('{') || !d.More() {
		return TargetPolicyBatchCheckInput{}, invalid
	}
	key, err := d.Token()
	if err != nil || key != "targetUrls" {
		return TargetPolicyBatchCheckInput{}, invalid
	}
	var targets []string
	if err := d.Decode(&targets); err != nil || !validPolicyBatchCheckInput(targets) || d.More() {
		return TargetPolicyBatchCheckInput{}, invalid
	}
	end, err := d.Token()
	if err != nil || end != json.Delim('}') {
		return TargetPolicyBatchCheckInput{}, invalid
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return TargetPolicyBatchCheckInput{}, invalid
	}
	return TargetPolicyBatchCheckInput{TargetURLs: targets}, nil
}

// Check accepts JSON only, without logging targets or underlying error text.
func (h *TargetPolicyBatchCheckHandler) Check(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, TargetPolicyBatchCheckResult{}, ErrTargetPolicyBatchCheckInvalidInput)
		return
	}
	input, err := decodeTargetPolicyBatchCheck(r.Body)
	if err != nil {
		h.respond(w, r, TargetPolicyBatchCheckResult{}, err)
		return
	}
	result, err := h.service.BatchCheckTargetPolicy(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// respond emits fixed errors and never includes a partial decision set on failure.
func (h *TargetPolicyBatchCheckHandler) respond(w http.ResponseWriter, r *http.Request, result TargetPolicyBatchCheckResult, err error) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	status, code, message := 200, 0, "OK"
	var data any = result
	if err != nil {
		data = nil
		switch {
		case errors.Is(err, targetpolicy.ErrPermissionDenied):
			code, message = 120001, "Permission denied"
		case errors.Is(err, ErrTargetPolicyBatchCheckInvalidInput):
			code, message = CodeTargetPolicyBatchCheckInvalidInput, "Invalid batch target policy check"
		default:
			status, code, message = 500, 900000, "Internal server error"
			h.logger.ErrorContext(r.Context(), "target_policy_batch_check_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
		}
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    any    `json:"data"`
		Meta    any    `json:"meta"`
	}{code, message, data, map[string]any{}})
}
