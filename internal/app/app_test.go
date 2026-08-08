package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"
)

// TestAppShutdownDrainsRequestsBeforeStoppingDependencies verifies shutdown ordering.
func TestAppShutdownDrainsRequestsBeforeStoppingDependencies(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(requestStarted)
		<-releaseRequest
		w.WriteHeader(http.StatusNoContent)
	})}
	shutdownStarted := make(chan struct{})
	server.RegisterOnShutdown(func() { close(shutdownStarted) })
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for shutdown test: %v", err)
	}
	serveDone := make(chan error, 1)
	go func() {
		serveDone <- server.Serve(listener)
	}()

	requestDone := make(chan error, 1)
	requestContext, cancelRequest := context.WithCancel(context.Background())
	defer cancelRequest()
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, "http://"+listener.Addr().String(), nil)
	if err != nil {
		t.Fatalf("create shutdown test request: %v", err)
	}
	go func() {
		response, requestErr := http.DefaultClient.Do(request)
		if response != nil {
			_ = response.Body.Close()
		}
		requestDone <- requestErr
	}()
	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("request did not reach the test server")
	}

	cleanupCanceled := make(chan struct{})
	cleanupDone := make(chan struct{})
	go func() {
		<-cleanupCanceled
		close(cleanupDone)
	}()
	application := &App{
		server: server,
		grantCleanupCancel: func() {
			close(cleanupCanceled)
		},
		grantCleanupDone: cleanupDone,
	}
	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), time.Second)
	defer cancelShutdown()
	shutdownDone := make(chan error, 1)
	go func() {
		shutdownDone <- application.Shutdown(shutdownContext)
	}()

	select {
	case <-cleanupCanceled:
		t.Fatal("cleanup stopped before HTTP shutdown started")
	case <-shutdownStarted:
	}
	select {
	case <-cleanupCanceled:
		t.Fatal("cleanup stopped while the in-flight request was running")
	default:
	}
	close(releaseRequest)
	if err := <-shutdownDone; err != nil {
		t.Fatalf("shutdown application: %v", err)
	}
	if err := <-requestDone; err != nil {
		t.Fatalf("complete in-flight request: %v", err)
	}
	if err := <-serveDone; !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("serve result = %v, want http.ErrServerClosed", err)
	}
}

// TestAppShutdownFailureKeepsDependenciesRunning verifies a failed drain can be retried safely.
func TestAppShutdownFailureKeepsDependenciesRunning(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(requestStarted)
		<-releaseRequest
		w.WriteHeader(http.StatusNoContent)
	})}
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for failed shutdown test: %v", err)
	}
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()

	requestContext, cancelRequest := context.WithCancel(context.Background())
	defer cancelRequest()
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, "http://"+listener.Addr().String(), nil)
	if err != nil {
		t.Fatalf("create failed shutdown request: %v", err)
	}
	requestDone := make(chan error, 1)
	go func() {
		response, requestErr := http.DefaultClient.Do(request)
		if response != nil {
			_ = response.Body.Close()
		}
		requestDone <- requestErr
	}()
	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("request did not reach the failed shutdown test server")
	}

	cleanupCanceled := make(chan struct{})
	cleanupDone := make(chan struct{})
	close(cleanupDone)
	application := &App{
		server: server,
		grantCleanupCancel: func() {
			close(cleanupCanceled)
		},
		grantCleanupDone: cleanupDone,
	}
	shutdownContext, cancelShutdown := context.WithCancel(context.Background())
	cancelShutdown()
	if err := application.Shutdown(shutdownContext); !errors.Is(err, context.Canceled) {
		t.Fatalf("shutdown error = %v, want context.Canceled", err)
	}
	select {
	case <-cleanupCanceled:
		t.Fatal("cleanup stopped after HTTP shutdown failed")
	default:
	}

	close(releaseRequest)
	if err := <-requestDone; err != nil {
		t.Fatalf("complete failed-shutdown request: %v", err)
	}
	if err := <-serveDone; !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("serve result = %v, want http.ErrServerClosed", err)
	}
}
