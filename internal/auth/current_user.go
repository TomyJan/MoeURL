package auth

import (
	"context"
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

func GuestUser() CurrentUser {
	return CurrentUser{
		Username:    "guest",
		Nickname:    "Guest",
		GroupKey:    "guest",
		Permissions: []string{},
	}
}

func CurrentUserMiddleware(resolver CurrentUserResolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			current := GuestUser()
			if cookie, err := r.Cookie(SessionCookieName); err == nil && cookie.Value != "" && resolver != nil {
				resolved, err := resolver.ResolveCurrentUser(r.Context(), cookie.Value)
				if err == nil {
					current = resolved
				}
			}

			ctx := context.WithValue(r.Context(), currentUserContextKey{}, current)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserFromContext(ctx context.Context) CurrentUser {
	user, ok := ctx.Value(currentUserContextKey{}).(CurrentUser)
	if !ok {
		return GuestUser()
	}
	return user
}
