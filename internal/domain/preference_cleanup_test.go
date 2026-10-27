package domain_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/domain"
)

// TestDomainDeletePreferenceCleanupFailure preserves the domain and preference when cleanup cannot commit.
func TestDomainDeletePreferenceCleanupFailure(t *testing.T) {
	service, pool, admin, actor := domainFixture(t)
	ctx := t.Context()
	if _, err := pool.Exec(ctx, `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) select $1,'preference-owner','Owner',id,'active',false,now(),now() from user_group where key='user'`, actor.ID); err != nil {
		t.Fatal(err)
	}
	created, err := service.Create(ctx, admin, domain.CreateInput{Host: "https://pref.example.com", DisplayName: "Preference", AllowedGroups: []string{"user"}, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into user_domain_preference(user_id,domain_id) values($1,$2)`, actor.ID, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `create function reject_domain_preference_clear() returns trigger language plpgsql as $$ begin raise exception 'controlled cleanup failure'; end $$; create trigger reject_domain_preference_clear before update on user_domain_preference for each row execute function reject_domain_preference_clear()`); err != nil {
		t.Fatal(err)
	}
	if err := service.Delete(ctx, admin, domain.ChangeInput{ID: created.ID, ExpectedUpdatedAt: created.UpdatedAt}); err == nil {
		t.Fatal("domain deletion ignored preference cleanup failure")
	}
	var selected string
	if err := pool.QueryRow(ctx, `select p.domain_id::text from user_domain_preference p join domain d on d.id=p.domain_id where p.user_id=$1`, actor.ID).Scan(&selected); err != nil || selected != created.ID {
		t.Fatalf("failed cleanup changed persisted references: %s %v", selected, err)
	}
}
