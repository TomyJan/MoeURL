package permission

const (
	GroupGuest = "guest"
	GroupUser  = "user"
	GroupAdmin = "admin"

	ShortLinkCreate    = "short_link:create"
	ShortLinkReadOwn   = "short_link:read_own"
	ShortLinkUpdateOwn = "short_link:update_own"
	ShortLinkDeleteOwn = "short_link:delete_own"
	ShortLinkReadAll   = "short_link:read_all"
	ShortLinkUpdateAll = "short_link:update_all"
	ShortLinkDeleteAll = "short_link:delete_all"
	DomainUseDefault   = "domain:use_default"
	AdminAccess        = "admin:access"
)

var UserPermissions = []string{
	ShortLinkCreate,
	ShortLinkReadOwn,
	ShortLinkUpdateOwn,
	ShortLinkDeleteOwn,
	DomainUseDefault,
}

var AdminPermissions = []string{
	ShortLinkCreate,
	ShortLinkReadOwn,
	ShortLinkUpdateOwn,
	ShortLinkDeleteOwn,
	ShortLinkReadAll,
	ShortLinkUpdateAll,
	ShortLinkDeleteAll,
	DomainUseDefault,
	AdminAccess,
}
