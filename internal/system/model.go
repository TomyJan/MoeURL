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
	SetupToken      string `json:"setupToken"`
}

// PublicConfig contains the non-sensitive site settings available before authentication.
type PublicConfig struct {
	SiteName        string `json:"siteName"`
	DefaultLanguage string `json:"defaultLanguage"`
	DefaultTheme    string `json:"defaultTheme"`
	FooterText      string `json:"footerText"`
	ShowPoweredBy   bool   `json:"showPoweredBy"`
}

// Settings contains the complete administrative settings view.
type Settings struct {
	PublicConfig
	LocalLoginEnabled bool   `json:"localLoginEnabled"`
	UpdatedAt         string `json:"updatedAt"`
}

// UpdateSettingsInput is one complete optimistic settings update.
type UpdateSettingsInput struct {
	SiteName          string `json:"siteName"`
	DefaultLanguage   string `json:"defaultLanguage"`
	DefaultTheme      string `json:"defaultTheme"`
	FooterText        string `json:"footerText"`
	ShowPoweredBy     bool   `json:"showPoweredBy"`
	LocalLoginEnabled bool   `json:"localLoginEnabled"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}
