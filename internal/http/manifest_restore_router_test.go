package http_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
)

const manifestRestoreRouterBody = `{"requestId":"a1111111-1111-4111-8111-111111115609","items":[{"domainOrigin":"https://example.org","slug":"docs7","targetUrl":"https://target.example/path","title":"","tags":[],"status":"enabled","redirectMode":"direct","intermediateDelaySeconds":"","expiresAt":"","maxVisits":""}]}`

type manifestRestoreRouterResolver struct{ actor auth.CurrentUser }

func (r manifestRestoreRouterResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	return r.actor, nil
}

type manifestRestoreRouterPort struct {
	calls int
	actor auth.CurrentUser
}

func (p *manifestRestoreRouterPort) RestoreManifest(_ context.Context, actor auth.CurrentUser, input shortlink.ManifestRestoreInput) (shortlink.BatchCreateResult, error) {
	p.calls++
	p.actor = actor
	return shortlink.BatchCreateResult{RequestID: input.RequestID, CreatedCount: len(input.Items)}, nil
}

func TestManifestRestoreRouterReachesCurrentActorPort(t *testing.T) {
	actor := auth.CurrentUser{ID: "user-123", Username: "alice", GroupKey: "user"}
	port := &manifestRestoreRouterPort{}
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser:              manifestRestoreRouterResolver{actor: actor},
		ShortLinkManifestRestore: port,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/manifest/restore", strings.NewReader(manifestRestoreRouterBody))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid-session"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("want HTTP 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"code":0`) || !strings.Contains(response.Body.String(), `"createdCount":1`) {
		t.Fatalf("expected successful restore receipt, got %s", response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("want no-store, got %q", response.Header().Get("Cache-Control"))
	}
	if port.calls != 1 || port.actor.ID != actor.ID {
		t.Fatalf("expected one call with actor %q, calls=%d actor=%#v", actor.ID, port.calls, port.actor)
	}
}

func TestManifestRestoreRouterPassesUnauthenticatedRequestsAsGuest(t *testing.T) {
	guest := auth.GuestUser()
	port := &manifestRestoreRouterPort{}
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser:              manifestRestoreRouterResolver{actor: auth.CurrentUser{ID: "should-not-be-used"}},
		ShortLinkManifestRestore: port,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/manifest/restore", strings.NewReader(manifestRestoreRouterBody))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || port.calls != 1 {
		t.Fatalf("expected guest request to reach service for authoritative denial, status=%d calls=%d body=%s", response.Code, port.calls, response.Body.String())
	}
	if port.actor.ID != guest.ID || port.actor.GroupKey != guest.GroupKey {
		t.Fatalf("expected guest actor %#v, got %#v", guest, port.actor)
	}
}
