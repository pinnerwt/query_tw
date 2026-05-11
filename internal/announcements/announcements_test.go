package announcements

import (
	"testing"
)

func TestValidateSeverity(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"info", true},
		{"warning", true},
		{"critical", true},
		{"", false},
		{"emergency", false},
		{"INFO", false},
	}
	for _, c := range cases {
		got := validSeverity(c.in)
		if got != c.want {
			t.Errorf("validSeverity(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestValidateBody(t *testing.T) {
	if err := validBody(""); err == nil {
		t.Errorf("empty body should be invalid")
	}
	if err := validBody("hi"); err != nil {
		t.Errorf("short body should be valid, got %v", err)
	}
	long := make([]byte, 4097)
	for i := range long {
		long[i] = 'x'
	}
	if err := validBody(string(long)); err == nil {
		t.Errorf("oversized body should be invalid")
	}
}
