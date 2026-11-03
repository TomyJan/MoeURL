package shortlink_test

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestListCreatedAtIDOrderAcrossPages catches tied rows moving between pages and a secondary key replacing the primary key.
func TestListCreatedAtIDOrderAcrossPages(t *testing.T) {
	pool, service, admin, owner, recipient, _ := transferFixture(t)
	ctx := t.Context()
	id := func(n int) string { return fmt.Sprintf("04700000-0000-0000-0000-%012x", n) }
	const private = `private-order47%_\canary`
	for n := 46; n >= 1; n-- {
		actorID, day := owner.ID, 2
		if n >= 22 && n <= 42 {
			day = 1
		}
		if n >= 43 {
			day = 3
		}
		if n == 44 || n == 45 {
			actorID = recipient.ID
		}
		// Reverse physical insertion must not define the order of equal timestamps.
		_, err := pool.Exec(ctx, `insert into short_link
			(id,owner_id,domain_id,slug,target_url,status,title,tags,note,created_at,updated_at,deleted_at)
			values($1,$2,'00000000-0000-0000-0000-000000000301',$3,'https://example.com/order47','active','Order47',array['order47'],$4,$5,now(),case when $6 then now() else null end)`,
			id(n), actorID, fmt.Sprintf("order47x%d", n), private, time.Date(2026, 11, day, 0, 0, 0, 0, time.UTC), n == 46)
		require.NoError(t, err)
	}
	// Day 3 is newest; then day 2 IDs 21..1; day 1 IDs 42..22 are last despite their larger IDs.
	ownNumbers := []int{43, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
		42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22}
	for _, global := range []bool{false, true} {
		for _, notes := range []bool{false, true} {
			name := fmt.Sprintf("global=%t/notes=%t", global, notes)
			t.Run(name, func(t *testing.T) {
				numbers := ownNumbers
				if global {
					numbers = append([]int{45, 44}, ownNumbers...)
				}
				want := make([]string, len(numbers))
				for i, n := range numbers {
					want[i] = id(n)
				}
				read := func(page int32) []string {
					input := shortlink.ListInput{Page: page, PageSize: 20, Status: "active", Query: "Order47", Tag: "order47"}
					search := shortlink.NoteSearchInput{ListInput: input, NoteQuery: `%_\`}
					got := []string{}
					var raw []byte
					var err error
					var total int64
					if global {
						var result shortlink.AdminListResult
						if notes {
							result, err = service.SearchAdminNotes(ctx, admin, search)
						} else {
							result, err = service.AdminList(ctx, admin, input)
						}
						require.NoError(t, err)
						total = result.Total
						for _, item := range result.Items {
							got = append(got, item.ID)
						}
						raw, err = json.Marshal(result)
					} else {
						var result shortlink.ListResult
						if notes {
							result, err = service.SearchOwnNotes(ctx, owner, search)
						} else {
							result, err = service.List(ctx, owner, input)
						}
						require.NoError(t, err)
						total = result.Total
						for _, item := range result.Items {
							got = append(got, item.ID)
						}
						raw, err = json.Marshal(result)
					}
					require.NoError(t, err)
					require.NotContains(t, string(raw), "private-order47")
					require.Equal(t, int64(len(want)), total)
					start := min(int(page-1)*20, len(want))
					end := min(start+20, len(want))
					require.Equal(t, want[start:end], got, "page %d", page)
					return got
				}
				union := []string{}
				for _, page := range []int32{1, 2, 3, 4} {
					union = append(union, read(page)...)
				}
				require.Equal(t, want, union)
				for _, page := range []int32{3, 1, 2} {
					read(page)
				}
				filter := shortlink.ListExportInput{Status: "active", Query: "Order47", Tag: "order47"}
				search := shortlink.NoteSearchInput{ListInput: shortlink.ListInput{Status: "active", Query: "Order47", Tag: "order47"}, NoteQuery: `%_\`}
				var exported shortlink.ListExport
				var err error
				switch {
				case global && notes:
					exported, err = service.ExportAdminNoteSearch(ctx, admin, search)
				case global:
					exported, err = service.AdminExportList(ctx, admin, filter)
				case notes:
					exported, err = service.ExportOwnNoteSearch(ctx, owner, search)
				default:
					exported, err = service.ExportList(ctx, owner, filter)
				}
				require.NoError(t, err)
				require.NotContains(t, exported.Content, "private-order47")
				rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(exported.Content, "\ufeff"))).ReadAll()
				require.NoError(t, err)
				require.Len(t, rows, len(want)+1)
				require.Len(t, rows[0], 17)
				got := []string{}
				for _, row := range rows[1:] {
					require.Len(t, row, 17)
					got = append(got, row[0])
				}
				require.Equal(t, want, got)
			})
		}
	}
}
