package system

type SetupInput struct {
	AdminUsername   string `json:"adminUsername"`
	AdminPassword   string `json:"adminPassword"`
	AdminNickname   string `json:"adminNickname"`
	SiteName        string `json:"siteName"`
	SystemDomain    string `json:"systemDomain"`
	ShortLinkDomain string `json:"shortLinkDomain"`
	DefaultLanguage string `json:"defaultLanguage"`
	DefaultTheme    string `json:"defaultTheme"`
}
