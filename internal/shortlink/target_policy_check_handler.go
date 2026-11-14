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

// TargetPolicyCheckHandler exposes only a bounded, no-store decision.
type TargetPolicyCheckHandler struct {
	service TargetPolicyCheckPort
	logger  *slog.Logger
}

// NewTargetPolicyCheckHandler binds the independent administrator action.
func NewTargetPolicyCheckHandler(service TargetPolicyCheckPort, logger *slog.Logger) *TargetPolicyCheckHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &TargetPolicyCheckHandler{service: service, logger: logger}
}

// decodeTargetPolicyCheck rejects ambiguous framing and exact-key duplicates,
// including differently escaped spellings of the same JSON member.
func decodeTargetPolicyCheck(body io.Reader) (TargetPolicyCheckInput, error) {
	invalid := ErrTargetPolicyCheckInvalidInput
	raw, err := io.ReadAll(io.LimitReader(body, 16385))
	if err != nil || len(raw) > 16384 || !utf8.Valid(raw) || !validBulkTitleUnicodeEscapes(raw) {
		return TargetPolicyCheckInput{}, invalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	start, err := d.Token()
	if err != nil || start != json.Delim('{') || !d.More() {
		return TargetPolicyCheckInput{}, invalid
	}
	key, err := d.Token()
	if err != nil || key != "targetUrl" {
		return TargetPolicyCheckInput{}, invalid
	}
	var target *string
	if err := d.Decode(&target); err != nil || target == nil || !validPolicyCheckInput(*target) || d.More() {
		return TargetPolicyCheckInput{}, invalid
	}
	end, err := d.Token()
	if err != nil || end != json.Delim('}') {
		return TargetPolicyCheckInput{}, invalid
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return TargetPolicyCheckInput{}, invalid
	}
	return TargetPolicyCheckInput{TargetURL: *target}, nil
}

// Check accepts JSON only and never logs the target or the underlying error.
func (h *TargetPolicyCheckHandler) Check(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, TargetPolicyCheckResult{}, ErrTargetPolicyCheckInvalidInput)
		return
	}
	input, err := decodeTargetPolicyCheck(r.Body)
	if err != nil {
		h.respond(w, r, TargetPolicyCheckResult{}, err)
		return
	}
	result, err := h.service.CheckTargetPolicy(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// respond uses fixed messages, suppressing all private URL and policy details.
func (h *TargetPolicyCheckHandler) respond(w http.ResponseWriter, r *http.Request, result TargetPolicyCheckResult, err error) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	status, code, message := 200, 0, "OK"
	var data any = result
	if err != nil {
		data = nil
		switch {
		case errors.Is(err, targetpolicy.ErrPermissionDenied):
			code, message = 120001, "Permission denied"
		case errors.Is(err, ErrTargetPolicyCheckInvalidInput):
			code, message = CodeTargetPolicyCheckInvalidInput, "Invalid target policy check"
		default:
			status, code, message = 500, 900000, "Internal server error"
			h.logger.ErrorContext(r.Context(), "target_policy_check_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
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
