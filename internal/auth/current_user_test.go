package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
)

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

func TestUserFromContextFallsBackToGuest(t *testing.T) {
	current := auth.UserFromContext(context.Background())

	if current.Username != "guest" {
		t.Fatalf("expected guest, got %s", current.Username)
	}
	if current.GroupKey != "guest" {
		t.Fatalf("expected guest group, got %s", current.GroupKey)
	}
}

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

type fakeCurrentUserResolver struct {
	user auth.CurrentUser
}

func (f *fakeCurrentUserResolver) ResolveCurrentUser(ctx context.Context, sessionID string) (auth.CurrentUser, error) {
	if f.user.Username == "" {
		return auth.GuestUser(), nil
	}
	return f.user, nil
}
