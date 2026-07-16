package permission

type Service struct {
	permissionsByGroup map[string]map[string]struct{}
}

// NewService implements package-specific behavior.
func NewService() *Service {
	return &Service{
		permissionsByGroup: map[string]map[string]struct{}{
			GroupGuest: toSet(nil),
			GroupUser:  toSet(UserPermissions),
			GroupAdmin: toSet(AdminPermissions),
		},
	}
}

// Has implements package-specific behavior.
func (s *Service) Has(groupKey string, permission string) bool {
	permissions, ok := s.permissionsByGroup[groupKey]
	if !ok {
		return false
	}
	_, ok = permissions[permission]
	return ok
}

// toSet implements package-specific behavior.
func toSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}
