package filters

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Filters is the deserialized filter payload. We use base64-encoded JSON
// instead of protobuf for the wire format — same role (compact, transferable),
// no protoc toolchain required.
type Filters struct {
	Cities    []string  `json:"cities,omitempty"`
	RemoteOK  bool      `json:"remote_ok,omitempty"`
	PayMin    int       `json:"pay_min,omitempty"`
	PayMax    int       `json:"pay_max,omitempty"`
	PayPeriod string    `json:"pay_period,omitempty"` // hourly|daily|monthly|per_case
	Period    string    `json:"period,omitempty"`     // 24h|7d|30d
	JobTypes  []string  `json:"job_types,omitempty"`
	Keyword   string    `json:"keyword,omitempty"`
	Skills    []SkillRow `json:"skills,omitempty"`
	Experience []SkillRow `json:"experience,omitempty"`
	HideSpam  bool      `json:"hide_spam"`
}

type SkillRow struct {
	Name     string `json:"name"`
	YearsMin uint32 `json:"years_min"`
}

const MaxFiltersBytes = 4096

// Decode parses base64url JSON filters from a query parameter.
func Decode(s string) (*Filters, error) {
	if s == "" {
		return &Filters{HideSpam: true}, nil
	}
	if len(s) > MaxFiltersBytes*2 {
		return nil, errors.New("filters too large")
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		// also accept standard base64 with padding for tolerance
		raw, err = base64.StdEncoding.DecodeString(s)
		if err != nil {
			return nil, fmt.Errorf("invalid base64: %w", err)
		}
	}
	if len(raw) > MaxFiltersBytes {
		return nil, errors.New("filters payload too large")
	}
	var f Filters
	if err := json.Unmarshal(raw, &f); err != nil {
		return nil, fmt.Errorf("invalid filters json: %w", err)
	}
	return &f, nil
}

// Encode does the inverse — used by tests.
func Encode(f *Filters) (string, error) {
	b, err := json.Marshal(f)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// Cursor identifies the last row returned (keyset on posted_at, id).
type Cursor struct {
	PostedAt time.Time
	ID       []byte // 16 bytes
}

func (c *Cursor) Encode() string {
	if c == nil {
		return ""
	}
	payload := struct {
		T int64  `json:"t"`
		I string `json:"i"`
	}{
		T: c.PostedAt.UnixMicro(),
		I: hex.EncodeToString(c.ID),
	}
	b, _ := json.Marshal(payload)
	return base64.RawURLEncoding.EncodeToString(b)
}

func DecodeCursor(s string) (*Cursor, error) {
	if s == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	var p struct {
		T int64  `json:"t"`
		I string `json:"i"`
	}
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, err
	}
	id, err := hex.DecodeString(p.I)
	if err != nil {
		return nil, err
	}
	return &Cursor{PostedAt: time.UnixMicro(p.T), ID: id}, nil
}

// recencyToCutoff maps a Period filter to a posted_at lower bound; zero time = no bound.
func recencyToCutoff(p string, now time.Time) time.Time {
	switch strings.ToLower(p) {
	case "24h":
		return now.Add(-24 * time.Hour)
	case "7d":
		return now.Add(-7 * 24 * time.Hour)
	case "30d":
		return now.Add(-30 * 24 * time.Hour)
	}
	return time.Time{}
}
