package shortlink

// BatchNoteAppendPreviewInput pins selected list revisions and supplies one normalized suffix.
type BatchNoteAppendPreviewInput struct {
	Items []BatchNotePreviewItem `json:"items"`
	Note  string                 `json:"note"`
}

// BatchNoteAppendInput fixes one request identity and both revisions for an atomic append.
type BatchNoteAppendInput struct {
	RequestID string               `json:"requestId"`
	Items     []BatchNoteClearItem `json:"items"`
	Note      string               `json:"note"`
}

type BatchNoteAppendPreviewResultItem struct {
	ID                    string `json:"id"`
	ExpectedUpdatedAt     string `json:"expectedUpdatedAt"`
	ExpectedNoteUpdatedAt string `json:"expectedNoteUpdatedAt"`
}

// BatchNoteAppendPreviewResult exposes only versions and aggregate length eligibility.
type BatchNoteAppendPreviewResult struct {
	Items           []BatchNoteAppendPreviewResultItem `json:"items"`
	AppendableCount int                                `json:"appendableCount"`
	OverflowCount   int                                `json:"overflowCount"`
}

// BatchNoteAppendResult contains no private note text or resource list.
type BatchNoteAppendResult struct {
	RequestID     string `json:"requestId"`
	AppendedCount int    `json:"appendedCount"`
}
