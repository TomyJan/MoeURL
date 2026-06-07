package user

type CreateInput struct {
	Username string
	Password string
	Nickname string
	GroupKey string
	Status   string
}

type CreateResult struct {
	User CreatedUser `json:"user"`
}

type ListInput struct {
	Page     int32
	PageSize int32
}

type ListResult struct {
	Items    []UserSummary `json:"items"`
	Page     int32         `json:"page"`
	PageSize int32         `json:"pageSize"`
	Total    int64         `json:"total"`
}

type UpdateInput struct {
	ID       string
	Nickname string
	Status   string
}

type UpdateResult struct {
	User UserSummary `json:"user"`
}

type ResetPasswordInput struct {
	ID       string
	Password string
}

type CreatedUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Nickname string `json:"nickname"`
	Group    string `json:"group"`
	Status   string `json:"status"`
}

type UserSummary struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	Group     string `json:"group"`
	Status    string `json:"status"`
	Builtin   bool   `json:"builtin"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}
