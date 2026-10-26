package insights

import (
	"bytes"
	"errors"
	"strings"
	"unicode"
)

const maxCSVExportBytes = 8 * 1024 * 1024

var errCSVExportLimit = errors.New("CSV export byte limit exceeded")

type csvExportBuffer struct{ buffer bytes.Buffer }

// Write bounds the exact UTF-8 output, including CSV escaping and the BOM.
func (b *csvExportBuffer) Write(data []byte) (int, error) {
	if len(data) > maxCSVExportBytes-b.buffer.Len() {
		return 0, errCSVExportLimit
	}
	return b.buffer.Write(data)
}

// csvExportText neutralizes spreadsheet formulas independently of CSV quoting.
func csvExportText(value string) string {
	trimmed := strings.TrimLeftFunc(value, unicode.IsSpace)
	if strings.HasPrefix(value, "\t") || strings.HasPrefix(value, "\r") || strings.HasPrefix(value, "\n") || (len(trimmed) > 0 && strings.ContainsRune("=+-@", rune(trimmed[0]))) {
		return "'" + value
	}
	return value
}
