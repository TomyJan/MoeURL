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

func NewHandler(service Port) *Handler {
	return &Handler{service: service}
}

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

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.List(r.Context(), auth.UserFromContext(r.Context()), ListInput{
		Page:     queryInt32(r, "page"),
		PageSize: queryInt32(r, "pageSize"),
	})
	if err != nil {
		if errors.Is(err, ErrPermissionDenied) {
			businessError(w, CodePermissionDenied, "Permission denied")
			return
		}
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
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

func (h *Handler) AdminList(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.AdminList(r.Context(), auth.UserFromContext(r.Context()), ListInput{
		Page:     queryInt32(r, "page"),
		PageSize: queryInt32(r, "pageSize"),
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

func ok(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, response{Code: 0, Message: "OK", Data: data, Meta: map[string]any{}})
}

func businessError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, http.StatusOK, response{Code: code, Message: message, Data: nil, Meta: map[string]any{}})
}

func writeJSON(w http.ResponseWriter, status int, body response) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func queryInt32(r *http.Request, key string) int32 {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return 0
	}
	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return 0
	}
	return int32(value)
}
