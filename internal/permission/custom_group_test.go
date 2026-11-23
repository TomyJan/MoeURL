package permission

import (
	"errors"
	"reflect"
	"testing"
)

func TestNormalizeCustomGroup(t *testing.T) {
	tests := []struct {
		name    string
		values  []string
		want    []string
		wantErr error
	}{
		{name: "empty permissions are allowed", values: []string{}, want: []string{}},
		{
			name:   "permissions use catalog order",
			values: []string{ShortLinkReadOwn, ShortLinkCreate},
			want:   []string{ShortLinkCreate, ShortLinkReadOwn},
		},
		{name: "unknown permission is rejected", values: []string{"permission:unknown"}, wantErr: ErrUnknownPermission},
		{name: "duplicate permission is rejected", values: []string{ShortLinkCreate, ShortLinkCreate}, wantErr: ErrDuplicatePermission},
		{name: "protected permission is rejected", values: []string{AdminAccess}, wantErr: ErrProtectedPermission},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeCustomGroup(test.values)
			if test.wantErr != nil {
				if !errors.Is(err, test.wantErr) {
					t.Fatalf("NormalizeCustomGroup() error = %v, want %v", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeCustomGroup() error = %v", err)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("NormalizeCustomGroup() = %#v, want %#v", got, test.want)
			}
		})
	}
}
