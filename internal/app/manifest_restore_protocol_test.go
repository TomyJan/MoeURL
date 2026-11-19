package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type manifestRestoreProtocolInput struct {
	RequestID string                        `json:"requestId"`
	Items     []manifestRestoreProtocolItem `json:"items"`
}

type manifestRestoreProtocolItem struct {
	DomainOrigin             string   `json:"domainOrigin"`
	Slug                     string   `json:"slug"`
	TargetURL                string   `json:"targetUrl"`
	Title                    string   `json:"title"`
	Tags                     []string `json:"tags"`
	Status                   string   `json:"status"`
	RedirectMode             string   `json:"redirectMode"`
	IntermediateDelaySeconds string   `json:"intermediateDelaySeconds"`
	ExpiresAt                string   `json:"expiresAt"`
	MaxVisits                string   `json:"maxVisits"`
}

// TestManifestRestoreProtocol catches missing app injection and duplicate writes after a lost response.
func TestManifestRestoreProtocol(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const requestID = "a1111111-1111-4111-8111-111111115609"
	const slug = "restoreprotocol"
	const target = "https://example.com/manifest-restore-protocol?q=private-canary"
	var domainOrigin, actorID string
	require.NoError(t, application.pool.QueryRow(t.Context(), `
		select d.host, u.id::text
		from domain d cross join app_user u
		where d.is_default and u.username = 'admin'
	`).Scan(&domainOrigin, &actorID))
	payload, err := json.Marshal(manifestRestoreProtocolInput{
		RequestID: requestID,
		Items: []manifestRestoreProtocolItem{
			{
				DomainOrigin: domainOrigin, Slug: slug, TargetURL: target, Title: "Protocol restore",
				Tags: []string{"protocol"}, Status: "active", RedirectMode: "direct",
				IntermediateDelaySeconds: "5", ExpiresAt: "", MaxVisits: "",
			},
		},
	})
	require.NoError(t, err)

	for attempt := 0; attempt < 2; attempt++ {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/manifest/restore", strings.NewReader(string(payload)))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-MoeURL-Expected-User-ID", actorID)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(response, request)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
		var body struct {
			Code int `json:"code"`
			Data struct {
				RequestID    string `json:"requestId"`
				CreatedCount int    `json:"createdCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		require.Zero(t, body.Code, "attempt %d: %s", attempt, response.Body.String())
		require.Equal(t, requestID, body.Data.RequestID)
		require.Equal(t, 1, body.Data.CreatedCount)

		var links, audits, receipts, events, visits int
		require.NoError(t, application.pool.QueryRow(t.Context(), `
			select count(*) from short_link
			where owner_id=$1::uuid and slug=$2 and target_url=$3 and status='active'
			  and redirect_mode='direct' and intermediate_delay_seconds=5 and expires_at is null
			  and password_hash is null and max_visits is null and visits_used=0
			  and title='Protocol restore' and tags=ARRAY['protocol']::text[]
		`, actorID, slug, target).Scan(&links))
		require.Equal(t, 1, links, "restore retry must leave one new link with zero usage")
		require.NoError(t, application.pool.QueryRow(t.Context(), `
			select count(*) from audit_log where resource_type='short_link' and action='create'
			  and actor_id=$1::uuid and resource_id=(select id from short_link where slug=$2)
		`, actorID, slug).Scan(&audits))
		require.Equal(t, 1, audits, "replay must not add audit entries")
		require.NoError(t, application.pool.QueryRow(t.Context(), `
			select count(*) from short_link_create_batch where actor_id=$1::uuid and request_id=$2::uuid and created_count=1
		`, actorID, requestID).Scan(&receipts))
		require.Equal(t, 1, receipts)
		require.NoError(t, application.pool.QueryRow(t.Context(), `select count(*) from short_link_event where short_link_id=(select id from short_link where slug=$1)`, slug).Scan(&events))
		require.Zero(t, events, "restore does not recreate history")
		require.NoError(t, application.pool.QueryRow(t.Context(), `select visits_used from short_link where slug=$1`, slug).Scan(&visits))
		require.Zero(t, visits)
		require.NotContains(t, response.Body.String(), "private-canary")
	}
}
