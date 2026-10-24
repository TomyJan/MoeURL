package permission

const (
	GroupGuest = "guest"
	GroupUser  = "user"
	GroupAdmin = "admin"

	ShortLinkCreate           = "short_link:create"
	ShortLinkCustomSlug       = "short_link:custom_slug"
	ShortLinkReadOwn          = "short_link:read_own"
	ShortLinkReadVisits       = "short_link:read_visits"
	StatisticsReadAll         = "statistics:read_all"
	AuditRead                 = "audit:read"
	ShortLinkExportStatistics = "short_link:export_statistics"
	ShortLinkExport           = "short_link:export"
	ShortLinkUpdateOwn        = "short_link:update_own"
	ShortLinkDeleteOwn        = "short_link:delete_own"
	ShortLinkUseIntermediate  = "short_link:use_intermediate"
	ShortLinkSetExpiration    = "short_link:set_expiration"
	ShortLinkSetPassword      = "short_link:set_password"
	ShortLinkUseConfirmation  = "short_link:use_confirmation"
	ShortLinkSetMaxVisits     = "short_link:set_max_visits"
	ShortLinkSetMetadata      = "short_link:set_metadata"
	ShortLinkReadAll          = "short_link:read_all"
	ShortLinkUpdateAll        = "short_link:update_all"
	ShortLinkDeleteAll        = "short_link:delete_all"
	DomainUseDefault          = "domain:use_default"
	DomainUseAssigned         = "domain:use_assigned"
	DomainManage              = "domain:manage"
	SystemManage              = "system:manage"
	AdminAccess               = "admin:access"
)

var UserPermissions = []string{
	ShortLinkCreate,
	ShortLinkCustomSlug,
	ShortLinkReadOwn,
	ShortLinkReadVisits,
	ShortLinkExportStatistics,
	ShortLinkExport,
	ShortLinkUpdateOwn,
	ShortLinkDeleteOwn,
	ShortLinkUseIntermediate,
	ShortLinkSetExpiration,
	ShortLinkSetPassword,
	ShortLinkUseConfirmation,
	ShortLinkSetMaxVisits,
	ShortLinkSetMetadata,
	DomainUseDefault,
	DomainUseAssigned,
}

var AdminPermissions = []string{
	StatisticsReadAll,
	AuditRead,
	ShortLinkCreate,
	ShortLinkCustomSlug,
	ShortLinkReadOwn,
	ShortLinkReadVisits,
	ShortLinkExportStatistics,
	ShortLinkExport,
	ShortLinkUpdateOwn,
	ShortLinkDeleteOwn,
	ShortLinkUseIntermediate,
	ShortLinkSetExpiration,
	ShortLinkSetPassword,
	ShortLinkUseConfirmation,
	ShortLinkSetMaxVisits,
	ShortLinkSetMetadata,
	ShortLinkReadAll,
	ShortLinkUpdateAll,
	ShortLinkDeleteAll,
	DomainUseDefault,
	DomainUseAssigned,
	DomainManage,
	SystemManage,
	AdminAccess,
}
