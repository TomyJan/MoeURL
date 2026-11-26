package permission_test

import (
	"context"
	"errors"
	"reflect"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type scriptedPermissionDB struct {
	query func(context.Context, string, ...any) (pgx.Rows, error)
	row   func(context.Context, string, ...any) pgx.Row
}

func (scriptedPermissionDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (db scriptedPermissionDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if db.query == nil {
		return nil, errors.New("unexpected query")
	}
	return db.query(ctx, sql, args...)
}

func (db scriptedPermissionDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if db.row == nil {
		return scriptedPermissionRow{err: errors.New("unexpected query row")}
	}
	return db.row(ctx, sql, args...)
}

type scriptedPermissionRow struct {
	values []any
	err    error
}

func (row scriptedPermissionRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(row.values) != len(dest) {
		return errors.New("scripted row value count mismatch")
	}
	for i, value := range row.values {
		if err := assignScriptedValue(dest[i], value); err != nil {
			return err
		}
	}
	return nil
}

type scriptedPermissionRows struct {
	values  [][]any
	index   int
	err     error
	scanErr error
}

func (rows *scriptedPermissionRows) Close()                                       {}
func (rows *scriptedPermissionRows) Err() error                                   { return rows.err }
func (rows *scriptedPermissionRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (rows *scriptedPermissionRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (rows *scriptedPermissionRows) Values() ([]any, error)                       { return nil, nil }
func (rows *scriptedPermissionRows) RawValues() [][]byte                          { return nil }
func (rows *scriptedPermissionRows) Conn() *pgx.Conn                              { return nil }
func (rows *scriptedPermissionRows) TypeMap() *pgtype.Map                         { return nil }

func (rows *scriptedPermissionRows) Next() bool {
	if rows.index >= len(rows.values) {
		return false
	}
	rows.index++
	return true
}

func (rows *scriptedPermissionRows) Scan(dest ...any) error {
	if rows.scanErr != nil {
		return rows.scanErr
	}
	values := rows.values[rows.index-1]
	if len(values) != len(dest) {
		return errors.New("scripted rows value count mismatch")
	}
	for i, value := range values {
		if err := assignScriptedValue(dest[i], value); err != nil {
			return err
		}
	}
	return nil
}

func assignScriptedValue(destination any, source any) error {
	value := reflect.ValueOf(destination)
	if value.Kind() != reflect.Pointer || value.IsNil() {
		return errors.New("scripted scan destination must be a non-nil pointer")
	}
	target := value.Elem()
	if source == nil {
		target.SetZero()
		return nil
	}
	input := reflect.ValueOf(source)
	if target.Kind() == reflect.Pointer {
		if input.Type().AssignableTo(target.Type()) {
			target.Set(input)
			return nil
		}
		if !input.Type().AssignableTo(target.Type().Elem()) {
			return errors.New("scripted scan source type mismatch")
		}
		wrapped := reflect.New(target.Type().Elem())
		wrapped.Elem().Set(input)
		target.Set(wrapped)
		return nil
	}
	if !input.Type().AssignableTo(target.Type()) {
		return errors.New("scripted scan source type mismatch")
	}
	target.Set(input)
	return nil
}
