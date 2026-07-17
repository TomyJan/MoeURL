package shortlink

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const (
	CodePermissionDenied = 120001
	CodeSlugConflict     = 200101
	CodeReservedSlug     = 200102
	CodeInvalidTargetURL = 200103
	CodeShortLinkMissing = 200104
)

type Port interface {
	Create(ctx context.Context, user auth.CurrentUser, input CreateInput) (CreateResult, error)
	List(ctx context.Context, user auth.CurrentUser, input ListInput) (ListResult, error)
	Update(ctx context.Context, user auth.CurrentUser, input UpdateInput) (CreateResult, error)
	Delete(ctx context.Context, user auth.CurrentUser, input DeleteInput) error
	AdminList(ctx context.Context, user auth.CurrentUser, input ListInput) (AdminListResult, error)
	AdminUpdate(ctx context.Context, user auth.CurrentUser, input UpdateInput) (CreateResult, error)
	AdminDelete(ctx context.Context, user auth.CurrentUser, input DeleteInput) error
}

type Handler struct {
	service Port
}

// NewHandler creates an HTTP handler backed by the short-link service.
func NewHandler(service Port) *Handler {
	return &Handler{service: service}
}

// Create validates a short-link request and returns the created link.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var input CreateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}

	result, err := h.service.Create(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		switch {
		case errors.Is(err, ErrPermissionDenied):
			businessError(w, CodePermissionDenied, "Permission denied")
		case errors.Is(err, ErrInvalidTargetURL):
			businessError(w, CodeInvalidTargetURL, "Invalid target URL")
		case errors.Is(err, ErrSlugConflict):
			businessError(w, CodeSlugConflict, "Short code conflict")
		case errors.Is(err, ErrReservedSlug):
			businessError(w, CodeReservedSlug, "Reserved short code")
		default:
			writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
		}
		return
	}

	ok(w, result)
}

// List returns short links visible to the current user.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.List(r.Context(), auth.UserFromContext(r.Context()), ListInput{
		Page:     queryInt32WithDefault(r, "page", defaultPage),
		PageSize: queryInt32WithDefault(r, "pageSize", defaultPageSize),
		Status:   r.URL.Query().Get("status"),
	})
	if err != nil {
		writeBusinessOrSystemError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, response{
		Code:    0,
		Message: "OK",
		Data:    map[string]any{"items": result.Items},
		Meta: map[string]any{
			"page":     result.Page,
			"pageSize": result.PageSize,
			"total":    result.Total,
		},
	})
}

// Update applies permitted changes to a short link owned by the current user.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	var input UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}

	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		writeBusinessOrSystemError(w, err)
		return
	}

	ok(w, result)
}

// Delete soft-deletes a short link owned by the current user.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	var input DeleteInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}

	err := h.service.Delete(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		writeBusinessOrSystemError(w, err)
		return
	}

	ok(w, map[string]bool{"deleted": true})
}

// AdminList returns short links available to an administrator.
func (h *Handler) AdminList(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.AdminList(r.Context(), auth.UserFromContext(r.Context()), ListInput{
		Page:     queryInt32WithDefault(r, "page", defaultPage),
		PageSize: queryInt32WithDefault(r, "pageSize", defaultPageSize),
		Status:   r.URL.Query().Get("status"),
		Query:    r.URL.Query().Get("q"),
	})
	if err != nil {
		writeBusinessOrSystemError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, response{
		Code:    0,
		Message: "OK",
		Data:    map[string]any{"items": result.Items},
		Meta: map[string]any{
			"page":     result.Page,
			"pageSize": result.PageSize,
			"total":    result.Total,
		},
	})
}

// AdminUpdate applies administrator changes to a short link.
func (h *Handler) AdminUpdate(w http.ResponseWriter, r *http.Request) {
	var input UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.AdminUpdate(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		writeBusinessOrSystemError(w, err)
		return
	}
	ok(w, result)
}

// AdminDelete soft-deletes a short link as an administrator.
func (h *Handler) AdminDelete(w http.ResponseWriter, r *http.Request) {
	var input DeleteInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	err := h.service.AdminDelete(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		writeBusinessOrSystemError(w, err)
		return
	}
	ok(w, map[string]bool{"deleted": true})
}

// writeBusinessOrSystemError maps service errors to business or server responses.
func writeBusinessOrSystemError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrPermissionDenied):
		businessError(w, CodePermissionDenied, "Permission denied")
	case errors.Is(err, ErrInvalidTargetURL):
		businessError(w, CodeInvalidTargetURL, "Invalid target URL")
	case errors.Is(err, ErrInvalidStatus):
		businessError(w, 100001, "Invalid request")
	case errors.Is(err, ErrShortLinkMissing):
		businessError(w, CodeShortLinkMissing, "Short link not found")
	case errors.Is(err, ErrSlugConflict):
		businessError(w, CodeSlugConflict, "Short code conflict")
	case errors.Is(err, ErrReservedSlug):
		businessError(w, CodeReservedSlug, "Reserved short code")
	default:
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}

type response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Meta    any    `json:"meta"`
}

// ok writes a successful short-link response.
func ok(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, response{Code: 0, Message: "OK", Data: data, Meta: map[string]any{}})
}

// businessError writes a short-link business failure response.
func businessError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, http.StatusOK, response{Code: code, Message: message, Data: nil, Meta: map[string]any{}})
}

// writeJSON writes a short-link response as JSON.
func writeJSON(w http.ResponseWriter, status int, body response) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// queryInt32WithDefault parses a positive int32 query value or returns its default.
func queryInt32WithDefault(r *http.Request, key string, defaultValue int32) int32 {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return defaultValue
	}
	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return defaultValue
	}
	return int32(value)
}
