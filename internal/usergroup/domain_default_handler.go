package usergroup

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// DomainDefaultHandler serves the independent strict documents while reusing stable group errors.
type DomainDefaultHandler struct {
	service   DomainDefaultPort
	responses *Handler
}

// NewDomainDefaultHandler keeps response and diagnostic policies aligned with the original group API.
func NewDomainDefaultHandler(service DomainDefaultPort, logger *slog.Logger) *DomainDefaultHandler {
	return &DomainDefaultHandler{service: service, responses: NewHandler(nil, logger)}
}

// Get requires exactly one known group selector and exposes no caller-selected account identity.
func (h *DomainDefaultHandler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query) != 1 || len(query["groupKey"]) != 1 || stableGroupKey(query.Get("groupKey")) == "" {
		h.respond(w, r, nil, ErrInvalidInput)
		return
	}
	result, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()), query.Get("groupKey"))
	h.respond(w, r, result, err)
}

// Set accepts an explicit nullable domain and a required nonnull revision in one JSON document.
func (h *DomainDefaultHandler) Set(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		h.respond(w, r, nil, ErrInvalidInput)
		return
	}
	var document struct {
		GroupKey          *string         `json:"groupKey"`
		DomainID          json.RawMessage `json:"domainId"`
		ExpectedUpdatedAt *string         `json:"expectedUpdatedAt"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxUpdatePermissionsBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil || document.GroupKey == nil || document.ExpectedUpdatedAt == nil || len(document.DomainID) == 0 {
		h.respond(w, r, nil, ErrInvalidInput)
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		h.respond(w, r, nil, ErrInvalidInput)
		return
	}
	input := SetDomainDefaultInput{GroupKey: *document.GroupKey, ExpectedUpdatedAt: *document.ExpectedUpdatedAt}
	if !bytes.Equal(bytes.TrimSpace(document.DomainID), []byte("null")) {
		var id string
		if err := json.Unmarshal(document.DomainID, &id); err != nil {
			h.respond(w, r, nil, ErrInvalidInput)
			return
		}
		input.DomainID = &id
	}
	result, err := h.service.Set(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// GetCurrent rejects selector parameters and returns only the authenticated account's safe effective choice.
func (h *DomainDefaultHandler) GetCurrent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.RawQuery != "" {
		h.respond(w, r, nil, ErrInvalidInput)
		return
	}
	result, err := h.service.GetCurrent(r.Context(), auth.UserFromContext(r.Context()))
	h.respond(w, r, result, err)
}

// respond stages the same no-secret group envelope after the service transaction has finished.
func (h *DomainDefaultHandler) respond(w http.ResponseWriter, r *http.Request, result any, err error) {
	actor := auth.UserFromContext(r.Context())
	if err != nil {
		h.responses.writeError(w, r, actor, "", err)
		return
	}
	h.responses.writeResponse(w, r, actor, "", http.StatusOK, response{Code: 0, Message: "OK", Data: result, Meta: map[string]any{}})
}
