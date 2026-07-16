package event

import "context"

const (
	ShortLinkOpened        = "short_link_opened"
	AccessConditionChecked = "access_condition_checked"
	RedirectInitiated      = "redirect_initiated"
	RedirectResponseSent   = "redirect_response_sent"
	RedirectBlocked        = "redirect_blocked"
)

// Event describes a short link access event emitted by the redirect flow.
type Event struct {
	Type        string
	Slug        string
	ShortLinkID string
}

// Recorder persists or forwards short link access events.
type Recorder interface {
	Record(ctx context.Context, event Event) error
}

// NoopRecorder accepts events without recording them.
type NoopRecorder struct{}

// Record ignores the event and always succeeds.
func (NoopRecorder) Record(context.Context, Event) error {
	return nil
}
