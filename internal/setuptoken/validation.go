package setuptoken

import "unicode/utf8"

const minimumCharacters = 32

// HasMinimumCharacters reports whether a setup token contains the production minimum number of Unicode code points.
func HasMinimumCharacters(token string) bool {
	return utf8.RuneCountInString(token) >= minimumCharacters
}
