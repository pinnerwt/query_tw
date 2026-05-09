package filters

import (
	"strings"
	"testing"
	"time"
)

func TestEncodeDecodeRoundTrip(t *testing.T) {
	f := &Filters{
		Cities:    []string{"台北市", "新北市"},
		RemoteOK:  true,
		PayMin:    50000,
		PayPeriod: "monthly",
		Period:    "7d",
		JobTypes:  []string{"full_time"},
		Keyword:   "前端",
		Skills:    []SkillRow{{Name: "React", YearsMin: 2}},
		HideSpam:  true,
	}
	s, err := Encode(f)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decode(s)
	if err != nil {
		t.Fatal(err)
	}
	if got.PayMin != 50000 || len(got.Cities) != 2 || len(got.Skills) != 1 || got.Skills[0].Name != "React" {
		t.Fatalf("round trip mismatch: %+v", got)
	}
}

func TestDecodeEmpty(t *testing.T) {
	f, err := Decode("")
	if err != nil {
		t.Fatal(err)
	}
	if !f.HideSpam {
		t.Fatal("empty filters should default HideSpam=true")
	}
}

func TestBuildJobsQueryEmpty(t *testing.T) {
	now := time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC)
	sql, args := BuildJobsQuery(nil, nil, 30, now)
	if !strings.Contains(sql, "spam_score < $1") {
		t.Fatalf("expected default spam threshold; got: %s", sql)
	}
	if len(args) != 2 { // threshold + limit
		t.Fatalf("expected 2 args; got %d", len(args))
	}
}

func TestBuildJobsQueryFull(t *testing.T) {
	now := time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC)
	f := &Filters{
		Cities:    []string{"台北市"},
		RemoteOK:  true,
		PayMin:    50000,
		PayPeriod: "monthly",
		Period:    "7d",
		JobTypes:  []string{"full_time"},
		Keyword:   "前端",
		Skills:    []SkillRow{{Name: "React", YearsMin: 2}, {Name: "Figma", YearsMin: 4}},
		HideSpam:  true,
	}
	sql, args := BuildJobsQuery(f, nil, 10, now)
	for _, want := range []string{
		"j.city = ANY",
		"j.remote",
		"pay_max >=",
		"pay_period =",
		"posted_at >=",
		"job_type = ANY",
		"plainto_tsquery",
		"FROM job_skills",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("missing clause %q in:\n%s", want, sql)
		}
	}
	if len(args) < 8 {
		t.Fatalf("expected many args, got %d", len(args))
	}
}
