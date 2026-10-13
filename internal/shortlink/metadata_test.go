package shortlink_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/event"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestServiceMetadataLifecycle verifies management metadata survives storage and partial updates.
func TestServiceMetadataLifecycle(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())
	var input shortlink.CreateInput
	require.NoError(t, json.Unmarshal([]byte(`{"targetUrl":"https://example.com","metadata":{"title":"　私のリンク　","tags":[" Go ","编程"]}}`), &input))
	created, err := service.Create(ctx, user, input)
	require.NoError(t, err)
	encoded, err := json.Marshal(created.ShortLink)
	require.NoError(t, err)
	var fields map[string]any
	require.NoError(t, json.Unmarshal(encoded, &fields))
	require.Equal(t, "私のリンク", fields["title"])
	require.Equal(t, []any{"Go", "编程"}, fields["tags"])
	require.Equal(t, "　私のリンク　", input.Metadata.Title, "normalization must not mutate the caller")
	admin := auth.CurrentUser{GroupKey: permission.GroupAdmin}
	for _, read := range []func() shortlink.ShortLink{
		func() shortlink.ShortLink {
			result, err := service.List(ctx, user, shortlink.ListInput{})
			require.NoError(t, err)
			require.Len(t, result.Items, 1)
			return result.Items[0]
		},
		func() shortlink.ShortLink {
			result, err := service.Statistics(ctx, user, shortlink.StatisticsInput{ID: created.ShortLink.ID})
			require.NoError(t, err)
			return result.ShortLink
		},
		func() shortlink.ShortLink {
			result, err := service.AdminStatistics(ctx, admin, shortlink.StatisticsInput{ID: created.ShortLink.ID})
			require.NoError(t, err)
			return result.ShortLink
		},
	} {
		link := read()
		require.Equal(t, "私のリンク", link.Title)
		require.Equal(t, []string{"Go", "编程"}, link.Tags)
	}
	adminList, err := service.AdminList(ctx, admin, shortlink.ListInput{})
	require.NoError(t, err)
	require.Equal(t, "私のリンク", adminList.Items[0].Title)
	require.Equal(t, []string{"Go", "编程"}, adminList.Items[0].Tags)

	for _, path := range []struct {
		actor  auth.CurrentUser
		update func(context.Context, auth.CurrentUser, shortlink.UpdateInput) (shortlink.CreateResult, error)
	}{{user, service.Update}, {admin, service.AdminUpdate}} {
		actor, update := path.actor, path.update
		for _, raw := range []string{`{"metadata":null}`, `{}`} {
			var change shortlink.UpdateInput
			require.NoError(t, json.Unmarshal([]byte(raw), &change))
			change.ID = created.ShortLink.ID
			result, err := update(ctx, actor, change)
			require.NoError(t, err)
			require.Equal(t, "私のリンク", result.ShortLink.Title)
			require.Equal(t, []string{"Go", "编程"}, result.ShortLink.Tags)
		}
		result, err := update(ctx, actor, shortlink.UpdateInput{ID: created.ShortLink.ID, Metadata: &shortlink.MetadataInput{Tags: []string{}}})
		require.NoError(t, err)
		require.Empty(t, result.ShortLink.Title)
		require.Equal(t, []string{}, result.ShortLink.Tags)
		_, err = update(ctx, actor, shortlink.UpdateInput{ID: created.ShortLink.ID, Metadata: input.Metadata})
		require.NoError(t, err)
	}
	plain, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com"})
	require.NoError(t, err)
	require.Empty(t, plain.ShortLink.Title)
	require.Equal(t, []string{}, plain.ShortLink.Tags)
}

// TestServiceMetadataValidationAndPermissionRevocation tests Unicode bounds and fresh database authorization.
func TestServiceMetadataValidationAndPermissionRevocation(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	metadata := &shortlink.MetadataInput{Title: strings.Repeat("猫", 120), Tags: []string{strings.Repeat("猫", 32), "Go", "go"}}
	created, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", Metadata: metadata})
	require.NoError(t, err)
	_, err = service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", Metadata: &shortlink.MetadataInput{Tags: []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}}})
	require.NoError(t, err, "ten distinct tags must be accepted")
	for _, invalid := range []*shortlink.MetadataInput{
		{}, {Tags: nil}, {Title: strings.Repeat("猫", 121), Tags: []string{}},
		{Title: "a\x00b", Tags: []string{}}, {Title: "a\n b", Tags: []string{}},
		{Tags: []string{"\u0085　"}}, {Tags: []string{"a", " a　"}},
		{Tags: []string{strings.Repeat("猫", 33)}}, {Tags: []string{"a\x7fb"}},
		{Tags: []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"}},
	} {
		_, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", Metadata: invalid})
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
		_, err = service.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, Metadata: invalid})
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
		_, err = shortlink.NewService(pool, permission.NewService()).AdminUpdate(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}, shortlink.UpdateInput{ID: created.ShortLink.ID, Metadata: invalid})
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	_, err = pool.Exec(ctx, `update user_group set permissions = permissions - 'short_link:set_metadata' where key = 'user'`)
	require.NoError(t, err)
	_, err = service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", Metadata: metadata})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	_, err = service.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, Metadata: &shortlink.MetadataInput{Tags: []string{}}})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	preserved, err := service.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID})
	require.NoError(t, err)
	require.Equal(t, metadata.Title, preserved.ShortLink.Title)
	require.Equal(t, metadata.Tags, preserved.ShortLink.Tags)
	_, err = service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com"})
	require.NoError(t, err)
	limited := shortlink.NewService(pool, permission.NewServiceWithPermissions(
		removePermission(permission.UserPermissions, permission.ShortLinkSetMetadata),
		removePermission(permission.AdminPermissions, permission.ShortLinkSetMetadata)))
	_, err = limited.AdminUpdate(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}, shortlink.UpdateInput{ID: created.ShortLink.ID, Metadata: metadata})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	adminPreserved, err := limited.AdminUpdate(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}, shortlink.UpdateInput{ID: created.ShortLink.ID})
	require.NoError(t, err)
	require.Equal(t, metadata.Title, adminPreserved.ShortLink.Title)
	require.Equal(t, metadata.Tags, adminPreserved.ShortLink.Tags)
	// Metadata capability never replaces the existing create or update capabilities.
	metadataOnly := shortlink.NewService(pool, permission.NewServiceWithPermissions([]string{permission.ShortLinkSetMetadata, permission.DomainUseDefault}, []string{permission.AdminAccess, permission.ShortLinkSetMetadata}))
	_, err = metadataOnly.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", Metadata: metadata})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	_, err = metadataOnly.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, Metadata: metadata})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	_, err = metadataOnly.AdminUpdate(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}, shortlink.UpdateInput{ID: created.ShortLink.ID, Metadata: metadata})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
}

// TestServiceMetadataFiltersIntersectAndIsolateOwners tests the exact list and count contracts on PostgreSQL.
func TestServiceMetadataFiltersIntersectAndIsolateOwners(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	alice := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	bob := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", permission.GroupUser, permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())
	create := func(owner auth.CurrentUser, title string, tags []string) shortlink.ShortLink {
		result, err := service.Create(ctx, owner, shortlink.CreateInput{TargetURL: "https://example.com/target", Metadata: &shortlink.MetadataInput{Title: title, Tags: tags}})
		require.NoError(t, err)
		return result.ShortLink
	}
	one := create(alice, `猫 100%_done\`, []string{"Go", "CaseTag"})
	two := create(alice, "other", []string{"go", "golang"})
	three := create(alice, "disabled", []string{"Go"})
	_, err := service.Update(ctx, alice, shortlink.UpdateInput{ID: three.ID, Status: ptr("disabled")})
	require.NoError(t, err)
	deleted := create(alice, one.Title, one.Tags)
	require.NoError(t, service.Delete(ctx, alice, shortlink.DeleteInput{ID: deleted.ID}))
	foreign := create(bob, one.Title, one.Tags)
	_, err = service.Update(ctx, alice, shortlink.UpdateInput{ID: foreign.ID, Metadata: &shortlink.MetadataInput{Tags: []string{}}})
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	_, err = service.Statistics(ctx, alice, shortlink.StatisticsInput{ID: foreign.ID})
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	for _, test := range []struct {
		name     string
		input    shortlink.ListInput
		own, all int
	}{
		{"all", shortlink.ListInput{}, 3, 4},
		{"exact uppercase", shortlink.ListInput{Tag: "　Go　"}, 2, 3},
		{"exact lowercase", shortlink.ListInput{Tag: "go"}, 1, 1},
		{"no substring tag", shortlink.ListInput{Tag: "g"}, 0, 0},
		{"literal percent", shortlink.ListInput{Query: "%"}, 1, 2},
		{"literal underscore", shortlink.ListInput{Query: "_"}, 1, 2},
		{"literal backslash", shortlink.ListInput{Query: `\`}, 1, 2},
		{"unicode title", shortlink.ListInput{Query: "　猫　"}, 1, 2},
		{"tag keyword", shortlink.ListInput{Query: "casetag"}, 1, 2},
		{"slug keyword", shortlink.ListInput{Query: strings.ToUpper(two.Slug)}, 1, 1},
		{"target keyword", shortlink.ListInput{Query: "/TARGET"}, 3, 4},
		{"intersection", shortlink.ListInput{Status: "active", Tag: "Go", Query: "猫"}, 1, 2},
		{"disabled intersection", shortlink.ListInput{Status: "disabled", Tag: "Go"}, 1, 1},
		{"owner admin search", shortlink.ListInput{Query: "alice"}, 0, 3},
		{"nickname admin search", shortlink.ListInput{Query: "BOB"}, 0, 1},
		{"empty whitespace", shortlink.ListInput{Query: "　 ", Tag: "　 "}, 3, 4},
	} {
		t.Run(test.name, func(t *testing.T) {
			own, err := service.List(ctx, alice, test.input)
			require.NoError(t, err)
			require.Len(t, own.Items, test.own)
			require.Equal(t, int64(test.own), own.Total)
			all, err := service.AdminList(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}, test.input)
			require.NoError(t, err)
			require.Len(t, all.Items, test.all)
			require.Equal(t, int64(test.all), all.Total)
		})
	}
	for _, input := range []shortlink.ListInput{{Query: strings.Repeat("猫", 201)}, {Tag: strings.Repeat("猫", 33)}, {Query: "a\x00b"}, {Tag: "a\x00b"}, {Query: "a\n b"}, {Tag: "a\x7fb"}} {
		_, err := service.List(ctx, alice, input)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
		_, err = service.AdminList(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}, input)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	for _, input := range []shortlink.ListInput{{Query: strings.Repeat("猫", 200)}, {Tag: strings.Repeat("猫", 32)}, {Query: "猫", PageSize: 1}} {
		own, err := service.List(ctx, alice, input)
		require.NoError(t, err)
		if input.PageSize == 1 {
			require.Equal(t, int64(1), own.Total)
			require.Len(t, own.Items, 1)
		}
	}
}

// metadataEventRecorder captures actual public access events for a data-boundary assertion.
type metadataEventRecorder struct{ events []event.Event }

// Record retains only the event emitted by the public flow.
func (r *metadataEventRecorder) Record(_ context.Context, value event.Event) error {
	r.events = append(r.events, value)
	return nil
}

// TestPublicAccessNeverContainsMetadata verifies actual public DTOs and events remain minimal.
func TestPublicAccessNeverContainsMetadata(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())
	created, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com/private", RedirectMode: "confirmation", Metadata: &shortlink.MetadataInput{Title: "private-title", Tags: []string{"private-tag"}}})
	require.NoError(t, err)
	recorder := &metadataEventRecorder{}
	redirect := shortlink.NewRedirectService(pool, recorder)
	opened, err := redirect.Open(ctx, created.ShortLink.Slug, "go.example.com")
	require.NoError(t, err)
	preview, err := redirect.Preview(ctx, created.ShortLink.Slug, "", "go.example.com")
	require.NoError(t, err)
	continued, err := redirect.Continue(ctx, created.ShortLink.Slug, "", "go.example.com")
	require.NoError(t, err)
	for _, value := range []any{opened, preview, continued, recorder.events} {
		encoded, err := json.Marshal(value)
		require.NoError(t, err)
		for _, forbidden := range []string{"private-title", "private-tag", `"title"`, `"tags"`, `"Title"`, `"Tags"`} {
			require.NotContains(t, string(encoded), forbidden)
		}
	}
	require.NotEmpty(t, recorder.events)
}

// TestMetadataHandlerContract preserves request omission, explicit clearing, filtering and business errors.
func TestMetadataHandlerContract(t *testing.T) {
	service := &fakeShortLinkService{}
	handler := shortlink.NewHandler(service)
	for _, raw := range []string{`{"metadata":null}`, `{}`, `{"metadata":{"title":"","tags":[]}}`} {
		for _, serve := range []func(http.ResponseWriter, *http.Request){handler.Create, handler.Update, handler.AdminUpdate} {
			response := httptest.NewRecorder()
			serve(response, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(raw)))
			require.Equal(t, http.StatusOK, response.Code)
		}
		if strings.Contains(raw, "tags") {
			require.NotNil(t, service.createInput.Metadata.Tags)
			require.NotNil(t, service.updateInput.Metadata.Tags)
		} else {
			require.Nil(t, service.createInput.Metadata)
			require.Nil(t, service.updateInput.Metadata)
		}
	}
	request := httptest.NewRequest(http.MethodGet, "/?q=cat&tag=Go&status=active", nil)
	handler.List(httptest.NewRecorder(), request)
	handler.AdminList(httptest.NewRecorder(), request)
	for _, input := range []shortlink.ListInput{service.listInput, service.adminListInput} {
		require.Equal(t, "cat", input.Query)
		require.Equal(t, "Go", input.Tag)
		require.Equal(t, "active", input.Status)
	}
	service.err = shortlink.ErrInvalidInput
	response := httptest.NewRecorder()
	handler.Create(response, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`)))
	require.Equal(t, http.StatusOK, response.Code)
	require.Contains(t, response.Body.String(), `"code":100001`)
}
