package auth_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// TestCurrentUserMiddlewareUsesGuestWithoutSession verifies current user middleware uses guest without session.
func TestCurrentUserMiddlewareUsesGuestWithoutSession(t *testing.T) {
	middleware := auth.CurrentUserMiddleware(&fakeCurrentUserResolver{})
	var current auth.CurrentUser
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current = auth.UserFromContext(r.Context())
	}))

	handler.ServeHTTP(
		httptest.NewRecorder(),
		httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil),
	)

	if current.Username != "guest" {
		t.Fatalf("expected guest, got %s", current.Username)
	}
	if current.GroupKey != "guest" {
		t.Fatalf("expected guest group, got %s", current.GroupKey)
	}
}

// TestUserFromContextFallsBackToGuest verifies user from context falls back to guest.
func TestUserFromContextFallsBackToGuest(t *testing.T) {
	current := auth.UserFromContext(context.Background())

	if current.Username != "guest" {
		t.Fatalf("expected guest, got %s", current.Username)
	}
	if current.GroupKey != "guest" {
		t.Fatalf("expected guest group, got %s", current.GroupKey)
	}
}

// TestCurrentUserMiddlewareResolvesSessionUser verifies current user middleware resolves session user.
func TestCurrentUserMiddlewareResolvesSessionUser(t *testing.T) {
	middleware := auth.CurrentUserMiddleware(&fakeCurrentUserResolver{
		user: auth.CurrentUser{
			ID:          "user-id",
			Username:    "alice",
			Nickname:    "Alice",
			GroupKey:    "user",
			Permissions: []string{"short_link:create"},
		},
	})
	var current auth.CurrentUser
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current = auth.UserFromContext(r.Context())
	}))
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-id"})

	handler.ServeHTTP(httptest.NewRecorder(), request)

	if current.Username != "alice" {
		t.Fatalf("expected alice, got %s", current.Username)
	}
	if len(current.Permissions) != 1 || current.Permissions[0] != "short_link:create" {
		t.Fatalf("unexpected permissions: %#v", current.Permissions)
	}
}

// TestCurrentUserMiddlewareRejectsUnknownResolverErrors verifies identity infrastructure failures cannot silently become guest access.
func TestCurrentUserMiddlewareRejectsUnknownResolverErrors(t *testing.T) {
	middleware := auth.CurrentUserMiddleware(&fakeCurrentUserResolver{err: errors.New("database down")})
	nextCalled := false
	handler := middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		nextCalled = true
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-id"})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", response.Code)
	}
	if nextCalled {
		t.Fatal("identity infrastructure failure reached the protected handler")
	}
	if strings.Contains(response.Body.String(), "database down") {
		t.Fatalf("response exposed resolver error: %q", response.Body.String())
	}
}

type fakeCurrentUserResolver struct {
	user auth.CurrentUser
	err  error
}

// ResolveCurrentUser implements the corresponding operation for the surrounding test double.
func (f *fakeCurrentUserResolver) ResolveCurrentUser(ctx context.Context, sessionID string) (auth.CurrentUser, error) {
	if f.err != nil {
		return auth.GuestUser(), f.err
	}
	if f.user.Username == "" {
		return auth.GuestUser(), nil
	}
	return f.user, nil
}
