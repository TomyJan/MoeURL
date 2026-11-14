package targetpolicy

import (
	"context"
	"errors"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
)

// savedTargetPolicies is private to one caller-owned, gate-holding transaction.
type savedTargetPolicies struct {
	host        Settings
	allow       AllowlistSettings
	suffix      SuffixSettings
	suffixAllow SuffixAllowlistSettings
	ip          IPSettings
	cidr        CIDRSettings
	cidrAllow   CIDRAllowlistSettings
}

// readSavedTargetPolicies validates every resource before evaluating any target,
// including disabled allow rules, so a denial cannot conceal corrupt storage.
func readSavedTargetPolicies(ctx context.Context, q *sqlc.Queries) (savedTargetPolicies, error) {
	var saved savedTargetPolicies
	row, err := q.GetSystemSetting(ctx, Key)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	saved.host, err = storedSettings(row)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	row, err = q.GetSystemSetting(ctx, AllowlistKey)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	saved.allow, err = storedAllowlistSettings(row)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	row, err = q.GetSystemSetting(ctx, SuffixKey)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	saved.suffix, err = storedSuffixSettings(row)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	row, err = q.GetSystemSetting(ctx, SuffixAllowlistKey)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	saved.suffixAllow, err = storedSuffixAllowlistSettings(row)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	row, err = q.GetSystemSetting(ctx, IPKey)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	saved.ip, err = storedIPSettings(row)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	row, err = q.GetSystemSetting(ctx, CIDRKey)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	saved.cidr, err = storedCIDRSettings(row)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	row, err = q.GetSystemSetting(ctx, CIDRAllowlistKey)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	saved.cidrAllow, err = storedCIDRAllowlistSettings(row)
	if err != nil {
		return savedTargetPolicies{}, err
	}
	return saved, nil
}

// check preserves the existing denial order and the three enabled allow union.
func (s savedTargetPolicies) check(targets []string) error {
	if err := checkCIDRs(s.cidr.Prefixes, targets); err != nil {
		return err
	}
	if err := checkIPs(s.ip.Addresses, targets); err != nil {
		return err
	}
	if err := checkHosts(s.host.Hosts, targets); err != nil {
		return err
	}
	if err := checkSuffixes(s.suffix.Suffixes, targets); err != nil {
		return err
	}
	return checkCombinedAllowlistTargets(s.allow, s.suffixAllow, s.cidrAllow, targets)
}

// CheckTargetsIndividually loads saved rules once in the caller's gate-holding
// transaction. Only target-specific invalid/denied errors become item results;
// storage and other unexpected failures abort the whole batch without results.
func CheckTargetsIndividually(ctx context.Context, q *sqlc.Queries, targets []string) ([]error, error) {
	saved, err := readSavedTargetPolicies(ctx, q)
	if err != nil {
		return nil, err
	}
	results := make([]error, len(targets))
	for i, target := range targets {
		err := saved.check([]string{target})
		if err != nil && !errors.Is(err, ErrInvalidTarget) && !errors.Is(err, ErrTargetDenied) {
			return nil, err
		}
		results[i] = err
	}
	return results, nil
}
