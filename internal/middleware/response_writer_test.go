package middleware

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestCommitAwareResponseWriterExposesSupportedInterfaces(t *testing.T) {
	tests := []struct {
		name           string
		writer         http.ResponseWriter
		protocolMajor  int
		wantFlusher    bool
		wantHijacker   bool
		wantPusher     bool
		wantReaderFrom bool
	}{
		{name: "base", writer: newWriterBase(), protocolMajor: 1},
		{name: "flush_only", writer: &writerFlusher{writerBase: newWriterBase()}, protocolMajor: 1, wantFlusher: true},
		{name: "hijack_only", writer: &writerHijacker{writerBase: newWriterBase(), err: errors.New("hijack failed")}, protocolMajor: 1, wantHijacker: true},
		{name: "flush_hijack", writer: &writerFlushHijacker{writerHijacker: &writerHijacker{writerBase: newWriterBase(), err: errors.New("hijack failed")}}, protocolMajor: 1, wantFlusher: true, wantHijacker: true},
		{name: "http1_full", writer: newWriterHTTP1(), protocolMajor: 1, wantFlusher: true, wantHijacker: true, wantReaderFrom: true},
		{name: "http2_full", writer: &writerHTTP2{writerBase: newWriterBase()}, protocolMajor: 2, wantFlusher: true, wantPusher: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			writer := newCommitAwareResponseWriter(test.writer, test.protocolMajor)
			_, hasFlusher := writer.(http.Flusher)
			_, hasHijacker := writer.(http.Hijacker)
			_, hasPusher := writer.(http.Pusher)
			_, hasReaderFrom := writer.(io.ReaderFrom)
			if hasFlusher != test.wantFlusher || hasHijacker != test.wantHijacker || hasPusher != test.wantPusher || hasReaderFrom != test.wantReaderFrom {
				t.Fatalf("interfaces = flush %t hijack %t push %t readFrom %t", hasFlusher, hasHijacker, hasPusher, hasReaderFrom)
			}
		})
	}
}

func TestCommitAwareResponseWriterTracksOptionalInterfaceCommits(t *testing.T) {
	t.Run("flush_hijack", func(t *testing.T) {
		underlying := &writerFlushHijacker{writerHijacker: &writerHijacker{writerBase: newWriterBase(), err: errors.New("hijack failed")}}
		writer := newCommitAwareResponseWriter(underlying, 1)

		writer.(http.Flusher).Flush()
		if writer.Status() != http.StatusOK || !writer.Committed() {
			t.Fatalf("flush state = status %d committed %t", writer.Status(), writer.Committed())
		}
		if _, _, err := writer.(http.Hijacker).Hijack(); err == nil {
			t.Fatal("expected configured hijack failure")
		}
	})

	t.Run("hijack_only", func(t *testing.T) {
		underlying := &writerHijacker{writerBase: newWriterBase(), err: errors.New("hijack failed")}
		writer := newCommitAwareResponseWriter(underlying, 1)

		if _, _, err := writer.(http.Hijacker).Hijack(); err == nil {
			t.Fatal("expected configured hijack failure")
		}
		if writer.Committed() || writer.Hijacked() {
			t.Fatalf("failed hijack state = committed %t hijacked %t", writer.Committed(), writer.Hijacked())
		}
	})

	t.Run("http1", func(t *testing.T) {
		flushWriter := newCommitAwareResponseWriter(newWriterHTTP1(), 1)
		flushWriter.(http.Flusher).Flush()

		readWriter := newCommitAwareResponseWriter(newWriterHTTP1(), 1)
		read, err := readWriter.(io.ReaderFrom).ReadFrom(strings.NewReader("stream"))
		if err != nil || read != 6 || readWriter.Status() != http.StatusOK || readWriter.BytesWritten() != 6 || !readWriter.Committed() {
			t.Fatalf("ReadFrom = bytes %d status %d written %d committed %t error %v", read, readWriter.Status(), readWriter.BytesWritten(), readWriter.Committed(), err)
		}
	})

	t.Run("http2", func(t *testing.T) {
		writer := newCommitAwareResponseWriter(&writerHTTP2{writerBase: newWriterBase()}, 2)

		writer.(http.Flusher).Flush()
		if err := writer.(http.Pusher).Push("/asset.js", nil); err != nil {
			t.Fatalf("push resource: %v", err)
		}
	})
}

func TestCommitAwareResponseWriterTracksInformationalAndSwitchingStatuses(t *testing.T) {
	t.Run("early_hints_then_ok", func(t *testing.T) {
		writer := newCommitAwareResponseWriter(newWriterBase(), 1)

		writer.WriteHeader(http.StatusEarlyHints)
		if writer.Committed() || writer.Status() != 0 {
			t.Fatalf("103 state = status %d committed %t", writer.Status(), writer.Committed())
		}

		writer.WriteHeader(http.StatusOK)
		if !writer.Committed() || writer.Status() != http.StatusOK {
			t.Fatalf("200 state = status %d committed %t", writer.Status(), writer.Committed())
		}
	})

	t.Run("switching_protocols", func(t *testing.T) {
		writer := newCommitAwareResponseWriter(newWriterBase(), 1)

		writer.WriteHeader(http.StatusSwitchingProtocols)

		if !writer.Committed() || writer.Status() != http.StatusSwitchingProtocols {
			t.Fatalf("101 state = status %d committed %t", writer.Status(), writer.Committed())
		}
	})
}

func TestCommitAwareResponseWriterUnwrapsForResponseController(t *testing.T) {
	underlying := &controllerWriter{writerBase: newWriterBase()}
	writer := newCommitAwareResponseWriter(underlying, 1)
	controller := http.NewResponseController(writer)
	deadline := time.Unix(1_788_000_000, 0)

	if err := controller.SetWriteDeadline(deadline); err != nil {
		t.Fatalf("set write deadline: %v", err)
	}
	if err := controller.EnableFullDuplex(); err != nil {
		t.Fatalf("enable full duplex: %v", err)
	}
	if !underlying.writeDeadline.Equal(deadline) || !underlying.fullDuplex {
		t.Fatalf("controller delegation = deadline %v full duplex %t", underlying.writeDeadline, underlying.fullDuplex)
	}
}

type writerBase struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func newWriterBase() *writerBase {
	return &writerBase{header: make(http.Header)}
}

func (writer *writerBase) Header() http.Header {
	return writer.header
}

func (writer *writerBase) WriteHeader(status int) {
	writer.status = status
}

func (writer *writerBase) Write(body []byte) (int, error) {
	return writer.body.Write(body)
}

type writerFlusher struct {
	*writerBase
}

func (*writerFlusher) Flush() {}

type writerHijacker struct {
	*writerBase
	err error
}

func (writer *writerHijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, writer.err
}

type writerFlushHijacker struct {
	*writerHijacker
}

func (*writerFlushHijacker) Flush() {}

type writerHTTP1 struct {
	*writerFlushHijacker
}

func newWriterHTTP1() *writerHTTP1 {
	return &writerHTTP1{writerFlushHijacker: &writerFlushHijacker{writerHijacker: &writerHijacker{writerBase: newWriterBase(), err: errors.New("hijack failed")}}}
}

func (writer *writerHTTP1) ReadFrom(reader io.Reader) (int64, error) {
	return writer.body.ReadFrom(reader)
}

type writerHTTP2 struct {
	*writerBase
}

func (*writerHTTP2) Flush() {}

func (*writerHTTP2) Push(string, *http.PushOptions) error {
	return nil
}

type controllerWriter struct {
	*writerBase
	writeDeadline time.Time
	fullDuplex    bool
}

func (writer *controllerWriter) SetWriteDeadline(deadline time.Time) error {
	writer.writeDeadline = deadline
	return nil
}

func (writer *controllerWriter) EnableFullDuplex() error {
	writer.fullDuplex = true
	return nil
}
