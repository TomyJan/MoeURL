package shortlink

// BatchNoteReplacePreviewInput pins selected list revisions and supplies a single replacement.
type BatchNoteReplacePreviewInput struct {
	Items []BatchNotePreviewItem `json:"items"`
	Note  string                 `json:"note"`
}

// BatchNoteReplaceInput additionally pins each previewed private-note revision.
type BatchNoteReplaceInput struct {
	Items []BatchNoteClearItem `json:"items"`
	Note  string               `json:"note"`
}

type BatchNoteReplacePreviewResultItem struct {
	ID                    string `json:"id"`
	ExpectedUpdatedAt     string `json:"expectedUpdatedAt"`
	ExpectedNoteUpdatedAt string `json:"expectedNoteUpdatedAt"`
	WillChange            bool   `json:"willChange"`
}

// BatchNoteReplacePreviewResult exposes comparison metadata without returning old note text.
type BatchNoteReplacePreviewResult struct {
	Items          []BatchNoteReplacePreviewResultItem `json:"items"`
	ChangedCount   int                                 `json:"changedCount"`
	UnchangedCount int                                 `json:"unchangedCount"`
}
