package shortlink

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestNoteStatusQuery catches permissive enum parsing, duplicate encoded keys and legacy query loss.
func TestNoteStatusQuery(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{
		{"", ""}, {"q=legacy+query&page=2&tag=x", ""}, {"noteStatus=", ""},
		{"noteStatus=present", "present"}, {"q=x&note%53tatus=absent", "absent"},
		{"legacyFlag&noteStatus=present", "present"},
	} {
		got, err := noteStatusQuery(tc.raw)
		require.NoError(t, err, tc.raw)
		require.Equal(t, tc.want, got)
	}
	for _, raw := range []string{"noteStatus", "note%53tatus", "noteStatus=present&note%53tatus=present", "noteStatus=%ff", "noteStatus=%00", "noteStatus=%ef%bb%bf", "noteStatus= present", "noteStatus=absent+", "noteStatus=Present", "noteStatus=all", "noteStatus=%zz", "q=%zz&noteStatus=present", "noteStatus=present;x=y"} {
		_, err := noteStatusQuery(raw)
		require.ErrorIs(t, err, ErrInvalidInput, raw)
	}
}

// TestNoteStatusHTTPValidation catches bypasses of validation at either list or export handler.
func TestNoteStatusHTTPValidation(t *testing.T) {
	handler := NewHandler(nil)
	for _, run := range []http.HandlerFunc{handler.List, handler.AdminList} {
		r := httptest.NewRequest(http.MethodGet, "/?noteStatus=present&noteStatus=absent", nil)
		w := httptest.NewRecorder()
		run(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		var body struct {
			Code int `json:"code"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Equal(t, 100001, body.Code)
	}
	for _, raw := range []string{"noteStatus=Present", "noteStatus=absent%20", "noteStatus=present&noteStatus=absent"} {
		_, err := listExportInput(raw)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	for _, status := range []string{"", "present", "absent"} {
		input, err := listExportInput("q=existing&noteStatus=" + status)
		require.NoError(t, err)
		require.Equal(t, status, input.NoteStatus)
		require.Equal(t, "existing", input.Query)
	}
}

// TestNoteStatusDirectInput catches bypassing the HTTP parser through service calls.
func TestNoteStatusDirectInput(t *testing.T) {
	actor := auth.CurrentUser{ID: uuid.NewString(), GroupKey: permission.GroupAdmin}
	service := NewService(nil, permission.NewService())
	for _, status := range []string{"present ", "Absent", "all", "\ufeff"} {
		_, err := service.List(t.Context(), actor, ListInput{NoteStatus: status})
		require.ErrorIs(t, err, ErrInvalidInput)
		_, err = service.AdminList(t.Context(), actor, ListInput{NoteStatus: status})
		require.ErrorIs(t, err, ErrInvalidInput)
		_, err = service.ExportList(t.Context(), actor, ListExportInput{NoteStatus: status})
		require.ErrorIs(t, err, ErrInvalidInput)
		_, err = service.AdminExportList(t.Context(), actor, ListExportInput{NoteStatus: status})
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	_, _, err := service.noteStatusListQueries(context.Background(), auth.CurrentUser{ID: "invalid"}, "present", false)
	require.ErrorIs(t, err, ErrPermissionDenied)
}
