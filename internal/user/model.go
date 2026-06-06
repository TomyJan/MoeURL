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

type CreatedUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Nickname string `json:"nickname"`
	Group    string `json:"group"`
	Status   string `json:"status"`
}
