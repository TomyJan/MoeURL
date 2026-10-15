package auth

import (
	"bytes"
	"context"
	"errors"
	"github.com/TomyJan/MoeURL/internal/middleware"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// passwordPortStub isolates transport mapping from database-backed credential behavior.
type passwordPortStub struct {
	err     error
	input   ChangePasswordInput
	session string
	calls   int
}

// PasswordStatus returns a controlled capability result.
func (s *passwordPortStub) PasswordStatus(_ context.Context, session string) (PasswordStatus, error) {
	s.session = session
	s.calls++
	return PasswordStatus{CanChangePassword: true}, s.err
}

// ChangePassword captures raw decoded credentials and returns a controlled service result.
func (s *passwordPortStub) ChangePassword(_ context.Context, session string, input ChangePasswordInput) error {
	s.session = session
	s.input = input
	s.calls++
	return s.err
}

// TestPasswordHandlerContracts verifies stable response codes, privacy, and success-only cookie clearing.
func TestPasswordHandlerContracts(t *testing.T) {
	for _, tt := range []struct {
		name         string
		err          error
		status, code int
	}{
		{name: "success", status: 200, code: 0}, {name: "input", err: ErrInvalidPasswordInput, status: 200, code: 100001},
		{name: "wrong current", err: ErrInvalidCredentials, status: 200, code: 110101}, {name: "rate", err: ErrLoginRateLimited, status: 200, code: 110103},
		{name: "oidc", err: ErrPasswordUnavailable, status: 200, code: 110105}, {name: "session", err: ErrInvalidSession, status: 401, code: 110101},
		{name: "infrastructure", err: errors.New("database body secret-session old-password"), status: 500, code: 900000},
	} {
		t.Run(tt.name, func(t *testing.T) {
			stub := &passwordPortStub{err: tt.err}
			var logs bytes.Buffer
			handler := NewPasswordHandler(stub, true, slog.New(slog.NewJSONHandler(&logs, nil)))
			request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password/change", strings.NewReader(`{"currentPassword":" old <&密码> ","newPassword":" new <&密码>  "}`))
			request.Header.Set("Content-Type", "application/json; charset=utf-8")
			request.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "secret-session"})
			recorder := httptest.NewRecorder()
			handler.Change(recorder, request)
			if recorder.Code != tt.status || !strings.Contains(recorder.Body.String(), `"code":`+stringCode(tt.code)) {
				t.Fatalf("response=%d %s", recorder.Code, recorder.Body.String())
			}
			if recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing no-store")
			}
			if stub.session != "secret-session" || stub.input.CurrentPassword != " old <&密码> " || stub.input.NewPassword != " new <&密码>  " {
				t.Fatalf("input mutated: %+v", stub)
			}
			cookies := recorder.Result().Cookies()
			if tt.err == nil {
				if len(cookies) != 1 || cookies[0].MaxAge != -1 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].Path != "/" {
					t.Fatalf("cookie=%+v", cookies)
				}
			} else if len(cookies) != 0 {
				t.Fatal("failed operation cleared cookie")
			}
			for _, sensitive := range []string{"secret-session", "old-password", "database body"} {
				if strings.Contains(logs.String()+recorder.Body.String(), sensitive) {
					t.Fatalf("leaked %s", sensitive)
				}
			}
		})
	}
}

// stringCode formats stable integer response codes for transport assertions.
func stringCode(code int) string {
	if code == 0 {
		return "0"
	}
	return map[int]string{100001: "100001", 110101: "110101", 110103: "110103", 110105: "110105", 900000: "900000"}[code]
}

// TestPasswordHandlerRejectsMalformedEnvelopes verifies JSON framing and authenticated-session requirements.
func TestPasswordHandlerRejectsMalformedEnvelopes(t *testing.T) {
	for _, tt := range []struct{ name, body, contentType string }{
		{"content type", `{}`, "text/plain"}, {"missing content type", `{}`, ""}, {"invalid type", `{}`, "application/json; invalid"},
		{"malformed", `{`, "application/json"}, {"unknown", `{"currentPassword":"old","newPassword":"new-password","extra":true}`, "application/json"},
		{"two values", `{"currentPassword":"old","newPassword":"new-password"} {}`, "application/json"},
		{"trailing invalid", `{"currentPassword":"old","newPassword":"new-password"} x`, "application/json"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			stub := &passwordPortStub{}
			handler := NewPasswordHandler(stub, false, nil)
			r := httptest.NewRequest("POST", "/", strings.NewReader(tt.body))
			r.Header.Set("Content-Type", tt.contentType)
			r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "current"})
			w := httptest.NewRecorder()
			handler.Change(w, r)
			if w.Code != 200 || !strings.Contains(w.Body.String(), `"code":100001`) || stub.calls != 0 {
				t.Fatalf("response=%d %s calls=%d", w.Code, w.Body.String(), stub.calls)
			}
		})
	}
	for _, method := range []string{"status", "change"} {
		t.Run("missing cookie "+method, func(t *testing.T) {
			stub := &passwordPortStub{}
			handler := NewPasswordHandler(stub, false, nil)
			r := httptest.NewRequest("POST", "/", strings.NewReader(`{"currentPassword":"old","newPassword":"new-password"}`))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			if method == "status" {
				handler.Status(w, r)
			} else {
				handler.Change(w, r)
			}
			if w.Code != 401 || stub.calls != 0 {
				t.Fatalf("response=%d calls=%d", w.Code, stub.calls)
			}
		})
	}
}

// TestPasswordStatusHandler verifies capability serialization and every status error path.
func TestPasswordStatusHandler(t *testing.T) {
	for _, err := range []error{nil, ErrInvalidSession, errors.New("raw secret-session database")} {
		stub := &passwordPortStub{err: err}
		var logs bytes.Buffer
		h := NewPasswordHandler(stub, false, slog.New(slog.NewTextHandler(&logs, nil)))
		r := httptest.NewRequest("GET", "/", nil)
		r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "secret-session"})
		w := httptest.NewRecorder()
		h.Status(w, r)
		want := 200
		if errors.Is(err, ErrInvalidSession) {
			want = 401
		} else if err != nil {
			want = 500
		}
		if w.Code != want || w.Header().Get("Cache-Control") != "no-store" || strings.Contains(logs.String(), "raw secret-session") {
			t.Fatalf("response=%d %s logs=%s", w.Code, w.Body.String(), logs.String())
		}
		if err == nil && !strings.Contains(w.Body.String(), `"canChangePassword":true`) {
			t.Fatal(w.Body.String())
		}
	}
}

// TestPasswordHandlerRejectsInvalidUnicode verifies JSON decoding cannot silently replace malformed credentials.
func TestPasswordHandlerRejectsInvalidUnicode(t *testing.T) {
	for _, body := range []string{`{"currentPassword":"old","newPassword":"new` + string([]byte{0xff}) + `password"}`, `{"currentPassword":"\ud800","newPassword":"new-password"}`, `{"currentPassword":"old","newPassword":"new-\udc00-password"}`, `{"currentPassword":"old","newPassword":"new-\ud800\u0041-password"}`} {
		stub := &passwordPortStub{}
		h := NewPasswordHandler(stub, false, nil)
		r := httptest.NewRequest("POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "current"})
		w := httptest.NewRecorder()
		h.Change(w, r)
		if stub.calls != 0 || !strings.Contains(w.Body.String(), `"code":100001`) {
			t.Fatalf("malformed Unicode accepted: %s", w.Body.String())
		}
	}
}

// passwordErrorReader produces a transport read failure without a real network connection.
type passwordErrorReader struct{}

// Read reports the controlled malformed-body failure.
func (passwordErrorReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

// TestPasswordHandlerBoundsBodyAndPreservesUnicode verifies strict validation preserves all legal raw password values.
func TestPasswordHandlerBoundsBodyAndPreservesUnicode(t *testing.T) {
	for _, body := range []io.Reader{passwordErrorReader{}, strings.NewReader(strings.Repeat(" ", middleware.MaxJSONBodyBytes+1))} {
		stub := &passwordPortStub{}
		h := NewPasswordHandler(stub, false, nil)
		r := httptest.NewRequest("POST", "/", body)
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "current"})
		w := httptest.NewRecorder()
		h.Change(w, r)
		if stub.calls != 0 || !strings.Contains(w.Body.String(), `"code":100001`) {
			t.Fatal(w.Body.String())
		}
	}
	for _, tt := range []struct{ encoded, decoded string }{
		{`"prefix-\ud83d\ude00"`, "prefix-😀"}, {`"prefix-\\ud800"`, `prefix-\ud800`}, {`"prefix-\uFFFD"`, "prefix-�"}, {`" 你好 <&> 密码 "`, " 你好 <&> 密码 "}, {`"prefix-\n\t\/"`, "prefix-\n\t/"},
	} {
		stub := &passwordPortStub{}
		h := NewPasswordHandler(stub, false, nil)
		r := httptest.NewRequest("POST", "/", strings.NewReader(`{"currentPassword":"old","newPassword":`+tt.encoded+`}`))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "current"})
		w := httptest.NewRecorder()
		h.Change(w, r)
		if stub.calls != 1 || stub.input.NewPassword != tt.decoded {
			t.Fatalf("legal Unicode changed: %+v response=%s", stub, w.Body.String())
		}
	}
}

// TestPasswordJSONUnicodeRejectsMalformedEscapes verifies malformed JSON Unicode sequences cannot be normalized into credentials.
func TestPasswordJSONUnicodeRejectsMalformedEscapes(t *testing.T) {
	for _, body := range []string{`\`, `\u`, `\uXXXX`, `\ud800`, `\ud800xx0000`, `\ud800\uXXXX`, `\ud800\u0041`, `\udc00`} {
		if validPasswordJSONUnicode([]byte(body)) {
			t.Fatalf("accepted %q", body)
		}
	}
}
