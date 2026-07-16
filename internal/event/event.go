package event

import "context"

const (
	ShortLinkOpened        = "short_link_opened"
	AccessConditionChecked = "access_condition_checked"
	RedirectInitiated      = "redirect_initiated"
	RedirectResponseSent   = "redirect_response_sent"
	RedirectBlocked        = "redirect_blocked"
)

type Event struct {
	Type        string
	Slug        string
	ShortLinkID string
}

type Recorder interface {
	Record(ctx context.Context, event Event) error
}

type NoopRecorder struct{}

func (NoopRecorder) Record(context.Context, Event) error {
	return nil
}
