package middleware

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

// commitAwareResponseWriter exposes final response state shared by recovery and access logging.
type commitAwareResponseWriter interface {
	http.ResponseWriter
	Status() int
	BytesWritten() int
	Committed() bool
	Hijacked() bool
	onComplete(func())
	complete()
}

// commitAwareWriter tracks final response commitment while delegating optional capabilities.
type commitAwareWriter struct {
	wrapped             chimiddleware.WrapResponseWriter
	committed           bool
	hijacked            bool
	completionCallbacks []func()
}

// newCommitAwareResponseWriter reuses existing request state or wraps a raw protocol writer.
func newCommitAwareResponseWriter(writer http.ResponseWriter, protocolMajor int) commitAwareResponseWriter {
	if existing, ok := writer.(commitAwareResponseWriter); ok {
		return existing
	}
	wrapped := chimiddleware.NewWrapResponseWriter(writer, protocolMajor)
	base := &commitAwareWriter{wrapped: wrapped}
	_, flusher := wrapped.(http.Flusher)
	_, hijacker := wrapped.(http.Hijacker)
	_, pusher := wrapped.(http.Pusher)
	_, readerFrom := wrapped.(io.ReaderFrom)

	switch {
	case flusher && hijacker && readerFrom:
		return &commitAwareHTTP1Writer{commitAwareWriter: base}
	case flusher && hijacker:
		return &commitAwareFlushHijackWriter{commitAwareWriter: base}
	case hijacker:
		return &commitAwareHijackWriter{commitAwareWriter: base}
	case flusher && pusher:
		return &commitAwareHTTP2Writer{commitAwareWriter: base}
	case flusher:
		return &commitAwareFlushWriter{commitAwareWriter: base}
	default:
		return base
	}
}

// Header returns the header map owned by the underlying response writer.
func (writer *commitAwareWriter) Header() http.Header {
	return writer.wrapped.Header()
}

// WriteHeader records a final status only after the underlying writer accepts it.
func (writer *commitAwareWriter) WriteHeader(status int) {
	if writer.committed {
		writer.wrapped.WriteHeader(status)
		return
	}
	if status < 100 || status > 999 {
		panic(fmt.Sprintf("invalid WriteHeader code %d", status))
	}
	writer.wrapped.WriteHeader(status)
	if isFinalResponseStatus(status) {
		writer.committed = true
	}
}

// Write commits an implicit successful response before delegating the body write.
func (writer *commitAwareWriter) Write(body []byte) (int, error) {
	writer.committed = true
	return writer.wrapped.Write(body)
}

// Status returns the final status recorded by the delegated writer.
func (writer *commitAwareWriter) Status() int {
	return writer.wrapped.Status()
}

// BytesWritten returns the number of response body bytes accepted by the delegated writer.
func (writer *commitAwareWriter) BytesWritten() int {
	return writer.wrapped.BytesWritten()
}

// Committed reports whether a final response or successful hijack has been accepted.
func (writer *commitAwareWriter) Committed() bool {
	return writer.committed
}

// Hijacked reports whether ownership of the underlying connection was transferred.
func (writer *commitAwareWriter) Hijacked() bool {
	return writer.hijacked
}

// Unwrap exposes the delegated writer to net/http response controllers.
func (writer *commitAwareWriter) Unwrap() http.ResponseWriter {
	return writer.wrapped
}

// onComplete schedules synchronous work after recovery has finalized the response.
func (writer *commitAwareWriter) onComplete(callback func()) {
	writer.completionCallbacks = append(writer.completionCallbacks, callback)
}

// complete runs registered completion callbacks exactly once in registration order.
func (writer *commitAwareWriter) complete() {
	callbacks := writer.completionCallbacks
	writer.completionCallbacks = nil
	for _, callback := range callbacks {
		callback()
	}
}

// flush commits an implicit successful response before flushing protocol output.
func (writer *commitAwareWriter) flush() {
	if !writer.committed {
		writer.WriteHeader(http.StatusOK)
	}
	writer.wrapped.(http.Flusher).Flush()
}

// hijack records connection ownership only when the delegated hijack succeeds.
func (writer *commitAwareWriter) hijack() (net.Conn, *bufio.ReadWriter, error) {
	connection, buffer, err := writer.wrapped.(http.Hijacker).Hijack()
	if err == nil {
		writer.committed = true
		writer.hijacked = true
	}
	return connection, buffer, err
}

// readFrom commits an implicit successful response before streaming from the reader.
func (writer *commitAwareWriter) readFrom(reader io.Reader) (int64, error) {
	if !writer.committed {
		writer.WriteHeader(http.StatusOK)
	}
	return writer.wrapped.(io.ReaderFrom).ReadFrom(reader)
}

// isFinalResponseStatus distinguishes final responses from informational 1xx headers.
func isFinalResponseStatus(status int) bool {
	return status >= 200 || status == http.StatusSwitchingProtocols
}

// commitAwareFlushWriter preserves http.Flusher without exposing unrelated capabilities.
type commitAwareFlushWriter struct {
	*commitAwareWriter
}

// Flush delegates protocol flushing while recording its implicit commit.
func (writer *commitAwareFlushWriter) Flush() {
	writer.flush()
}

// commitAwareHijackWriter preserves http.Hijacker without exposing unrelated capabilities.
type commitAwareHijackWriter struct {
	*commitAwareWriter
}

// Hijack delegates connection transfer and records successful ownership changes.
func (writer *commitAwareHijackWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return writer.hijack()
}

// commitAwareFlushHijackWriter preserves combined flushing and hijacking capabilities.
type commitAwareFlushHijackWriter struct {
	*commitAwareWriter
}

// Flush delegates protocol flushing while recording its implicit commit.
func (writer *commitAwareFlushHijackWriter) Flush() {
	writer.flush()
}

// Hijack delegates connection transfer and records successful ownership changes.
func (writer *commitAwareFlushHijackWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return writer.hijack()
}

// commitAwareHTTP1Writer preserves the full HTTP/1 streaming capability set.
type commitAwareHTTP1Writer struct {
	*commitAwareWriter
}

// Flush delegates HTTP/1 flushing while recording its implicit commit.
func (writer *commitAwareHTTP1Writer) Flush() {
	writer.flush()
}

// Hijack delegates HTTP/1 connection transfer and records successful ownership changes.
func (writer *commitAwareHTTP1Writer) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return writer.hijack()
}

// ReadFrom streams an HTTP/1 response body while preserving byte accounting.
func (writer *commitAwareHTTP1Writer) ReadFrom(reader io.Reader) (int64, error) {
	return writer.readFrom(reader)
}

// commitAwareHTTP2Writer preserves HTTP/2 flushing and server-push capabilities.
type commitAwareHTTP2Writer struct {
	*commitAwareWriter
}

// Flush delegates HTTP/2 flushing while recording its implicit commit.
func (writer *commitAwareHTTP2Writer) Flush() {
	writer.flush()
}

// Push delegates an HTTP/2 server-push request without committing the current response.
func (writer *commitAwareHTTP2Writer) Push(target string, options *http.PushOptions) error {
	return writer.wrapped.(http.Pusher).Push(target, options)
}
