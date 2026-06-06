package shortlink

type CreateInput struct {
	TargetURL string
}

type CreateResult struct {
	ShortLink ShortLink `json:"shortLink"`
}

type ListInput struct {
	Page     int32
	PageSize int32
}

type UpdateInput struct {
	ID        string
	TargetURL *string
	Status    *string
}

type DeleteInput struct {
	ID string
}

type ListResult struct {
	Items    []ShortLink `json:"items"`
	Page     int32       `json:"page"`
	PageSize int32       `json:"pageSize"`
	Total    int64       `json:"total"`
}

type ShortLink struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Slug      string `json:"slug"`
	TargetURL string `json:"targetUrl"`
	Status    string `json:"status"`
}

type OwnerSummary struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Nickname string `json:"nickname"`
}

type AdminShortLink struct {
	ID        string       `json:"id"`
	URL       string       `json:"url"`
	Slug      string       `json:"slug"`
	TargetURL string       `json:"targetUrl"`
	Status    string       `json:"status"`
	Owner     OwnerSummary `json:"owner"`
}

type AdminListResult struct {
	Items    []AdminShortLink `json:"items"`
	Page     int32            `json:"page"`
	PageSize int32            `json:"pageSize"`
	Total    int64            `json:"total"`
}
