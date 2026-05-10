package domain

import "time"

type Pay struct {
	Min    *int   `json:"min,omitempty"`
	Max    *int   `json:"max,omitempty"`
	Period string `json:"period,omitempty"` // hourly|daily|monthly|per_case
	Raw    string `json:"raw,omitempty"`
}

type Location struct {
	City     string `json:"city,omitempty"`
	District string `json:"district,omitempty"`
	Remote   bool   `json:"remote"`
}

type SkillReq struct {
	Name     string `json:"name"`
	YearsMin *int   `json:"years_min,omitempty"`
}

type RoleReq struct {
	Role     string `json:"role"`
	YearsMin *int   `json:"years_min,omitempty"`
}

type LangReq struct {
	Name  string `json:"name"`
	Level string `json:"level,omitempty"`
}

type Author struct {
	Handle string `json:"handle"`
	Name   string `json:"name,omitempty"`
}

type Requirements struct {
	Skills     []SkillReq `json:"skills"`
	Experience []RoleReq  `json:"experience"`
	Languages  []LangReq  `json:"languages"`
}

type JobView struct {
	ID           string       `json:"id"`
	Title        string       `json:"title"`
	Company      string       `json:"company,omitempty"`
	Location     Location     `json:"location"`
	JobType      string       `json:"job_type"`
	Pay          Pay          `json:"pay"`
	Requirements Requirements `json:"requirements"`
	Tags         []string     `json:"tags"`
	Categories   []string     `json:"categories"`
	PostedAt     time.Time    `json:"posted_at"`
	SourceURL    string       `json:"source_url"`
	Author       Author       `json:"author"`
	SpamScore    float32      `json:"spam_score"`
	RawExcerpt   string       `json:"raw_excerpt,omitempty"`
}
