package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
)

type currentUserContextKey struct{}

type CurrentUser struct {
	ID          string   `json:"id"`
	Username    string   `json:"username"`
	Nickname    string   `json:"nickname"`
	GroupKey    string   `json:"group"`
	Permissions []string `json:"permissions"`
}

type CurrentUserResolver interface {
	ResolveCurrentUser(ctx context.Context, sessionID string) (CurrentUser, error)
}

// GuestUser returns the built-in unauthenticated user identity.
func GuestUser() CurrentUser {
	return CurrentUser{
		Username:    "guest",
		Nickname:    "Guest",
		GroupKey:    "guest",
		Permissions: []string{},
	}
}

// CurrentUserMiddleware resolves the request user and stores it in the context.
func CurrentUserMiddleware(resolver CurrentUserResolver) func(http.Handler) http.Handler {
	return CurrentUserMiddlewareWithLogger(resolver, nil)
}

// CurrentUserMiddlewareWithLogger resolves request identity and reports unknown resolver failures through the application logger.
func CurrentUserMiddlewareWithLogger(resolver CurrentUserResolver, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			current := GuestUser()
			if cookie, err := r.Cookie(SessionCookieName); err == nil && cookie.Value != "" && resolver != nil {
				resolved, err := resolver.ResolveCurrentUser(r.Context(), cookie.Value)
				if err == nil {
					current = resolved
				} else if !isExpectedIdentityError(err) {
					logAuthInfrastructureError(logger, r, "resolve_current_user", err)
					writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
					return
				}
			}

			ctx := context.WithValue(r.Context(), currentUserContextKey{}, current)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// isExpectedIdentityError identifies authentication failures that safely map to the guest identity.
func isExpectedIdentityError(err error) bool {
	return errors.Is(err, ErrInvalidSession) || errors.Is(err, ErrInvalidCredentials) || errors.Is(err, ErrUserDisabled)
}

// UserFromContext returns the request user or the guest identity when absent.
func UserFromContext(ctx context.Context) CurrentUser {
	user, ok := ctx.Value(currentUserContextKey{}).(CurrentUser)
	if !ok {
		return GuestUser()
	}
	return user
}
