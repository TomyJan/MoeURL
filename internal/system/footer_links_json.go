package system

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"unicode/utf8"
)

// decodeFooterLinksUpdate reads one complete document, including whitespace,
// with an inclusive 64 KiB limit. It does not change legacy JSON protocols.
func decodeFooterLinksUpdate(body io.Reader) (UpdateFooterLinksInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 65537))
	if err != nil || len(raw) > 65536 {
		return UpdateFooterLinksInput{}, ErrInvalidFooterLinks
	}
	return footerLinksDocument(raw, true)
}

func footerLinksDocument(raw []byte, update bool) (UpdateFooterLinksInput, error) {
	if !footerJSONScalars(raw) {
		return UpdateFooterLinksInput{}, ErrInvalidFooterLinks
	}
	fields := []string{"links"}
	if update {
		fields = append(fields, "expectedUpdatedAt")
	}
	object, err := footerJSONObject(raw, fields)
	if err != nil {
		return UpdateFooterLinksInput{}, err
	}
	list := bytes.TrimSpace(object["links"])
	var items []json.RawMessage
	if len(list) == 0 || list[0] != '[' || json.Unmarshal(list, &items) != nil || len(items) > 5 {
		return UpdateFooterLinksInput{}, ErrInvalidFooterLinks
	}
	input := UpdateFooterLinksInput{Links: make([]FooterLink, len(items))}
	for i, item := range items {
		object, err := footerJSONObject(item, []string{"label", "url"})
		if err != nil {
			return UpdateFooterLinksInput{}, err
		}
		label, err := footerJSONString(object["label"])
		if err != nil {
			return UpdateFooterLinksInput{}, err
		}
		target, err := footerJSONString(object["url"])
		if err != nil {
			return UpdateFooterLinksInput{}, err
		}
		input.Links[i] = FooterLink{Label: label, URL: target}
	}
	if update {
		input.ExpectedUpdatedAt, err = footerJSONString(object["expectedUpdatedAt"])
		if err != nil {
			return UpdateFooterLinksInput{}, err
		}
	}
	return input, nil
}

// footerJSONObject checks decoded key spelling and uniqueness at each known
// object layer; struct decoding alone is case-insensitive and last-key-wins.
func footerJSONObject(raw []byte, fields []string) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return nil, ErrInvalidFooterLinks
	}
	values := make(map[string]json.RawMessage, len(fields))
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, ErrInvalidFooterLinks
		}
		key, ok := token.(string)
		allowed := false
		for _, field := range fields {
			allowed = allowed || key == field
		}
		if _, duplicate := values[key]; !ok || !allowed || duplicate {
			return nil, ErrInvalidFooterLinks
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, ErrInvalidFooterLinks
		}
		values[key] = value
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || len(values) != len(fields) {
		return nil, ErrInvalidFooterLinks
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return nil, ErrInvalidFooterLinks
	}
	return values, nil
}

func footerJSONString(raw []byte) (string, error) {
	raw = bytes.TrimSpace(raw)
	var value string
	if len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &value) != nil {
		return "", ErrInvalidFooterLinks
	}
	return value, nil
}

// footerJSONScalars rejects malformed UTF8 and unpaired escaped UTF16 before
// encoding/json can replace them with U+FFFD. Escaped backslashes are skipped.
func footerJSONScalars(raw []byte) bool {
	if !utf8.Valid(raw) || !json.Valid(raw) {
		return false
	}
	inString := false
	for i := 0; i < len(raw); i++ {
		if raw[i] == '"' {
			inString = !inString
			continue
		}
		if !inString || raw[i] != '\\' {
			continue
		}
		i++ // json.Valid guarantees a complete escape.
		if raw[i] != 'u' {
			continue
		}
		code, _ := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		i += 4
		if code >= 0xDC00 && code <= 0xDFFF {
			return false
		}
		if code < 0xD800 || code > 0xDBFF {
			continue
		}
		if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
			return false
		}
		low, _ := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
		if low < 0xDC00 || low > 0xDFFF {
			return false
		}
		i += 6
	}
	return true
}
