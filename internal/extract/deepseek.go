package extract

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

type ExtractedJob struct {
	Title      string         `json:"title"`
	Company    string         `json:"company,omitempty"`
	City       string         `json:"city,omitempty"`
	District   string         `json:"district,omitempty"`
	Remote     bool           `json:"remote"`
	JobType    string         `json:"job_type"`
	PayMin     *int           `json:"pay_min,omitempty"`
	PayMax     *int           `json:"pay_max,omitempty"`
	PayPeriod  string         `json:"pay_period,omitempty"`
	PayRaw     string         `json:"pay_raw,omitempty"`
	Skills     []SkillEntry   `json:"skills,omitempty"`
	Experience []RoleEntry    `json:"experience,omitempty"`
	Languages  []LanguageEntry `json:"languages,omitempty"`
	Tags       []string       `json:"tags,omitempty"`
	RawExcerpt string         `json:"raw_excerpt,omitempty"`
}

type SkillEntry struct {
	Name     string `json:"name"`
	YearsMin *int   `json:"years_min,omitempty"`
}

type RoleEntry struct {
	Role     string `json:"role"`
	YearsMin *int   `json:"years_min,omitempty"`
}

type LanguageEntry struct {
	Name  string `json:"name"`
	Level string `json:"level,omitempty"`
}

type JobsExtraction struct {
	Jobs       []ExtractedJob `json:"jobs"`
	SpamScore  float32        `json:"spam_score"`
	NewSkills  []string       `json:"_new_skills,omitempty"`
	NewRoles   []string       `json:"_new_roles,omitempty"`
}

type Client struct {
	APIKey  string
	BaseURL string // defaults to https://api.deepseek.com
	HTTP    *http.Client
}

type chatRequest struct {
	Model        string         `json:"model"`
	Messages     []chatMessage  `json:"messages"`
	ResponseFormat any          `json:"response_format,omitempty"`
	Temperature  float32        `json:"temperature"`
	MaxTokens    int            `json:"max_tokens,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

type Usage struct {
	PromptTokens     int
	CompletionTokens int
	CostCents        int
}

// Extract calls DeepSeek's chat completions with a JSON response and returns
// the parsed JobsExtraction. Retries up to 3 times on 5xx/429/timeout.
func (c *Client) Extract(ctx context.Context, system, user string) (*JobsExtraction, *Usage, error) {
	if c.APIKey == "" {
		return nil, nil, errors.New("missing deepseek api key")
	}
	if c.BaseURL == "" {
		c.BaseURL = "https://api.deepseek.com"
	}
	httpc := c.HTTP
	if httpc == nil {
		httpc = &http.Client{Timeout: 60 * time.Second}
	}

	body := chatRequest{
		Model: "deepseek-chat",
		Messages: []chatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		ResponseFormat: map[string]string{"type": "json_object"},
		Temperature:    0.1,
		MaxTokens:      2048,
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(time.Duration(attempt*attempt) * time.Second):
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			}
		}
		buf, _ := json.Marshal(body)
		req, _ := http.NewRequestWithContext(ctx, "POST", c.BaseURL+"/v1/chat/completions", bytes.NewReader(buf))
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := httpc.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("deepseek %d: %s", resp.StatusCode, string(raw))
			continue
		}
		if resp.StatusCode != 200 {
			return nil, nil, fmt.Errorf("deepseek %d: %s", resp.StatusCode, string(raw))
		}
		var cr chatResponse
		if err := json.Unmarshal(raw, &cr); err != nil {
			return nil, nil, fmt.Errorf("decode envelope: %w; body=%s", err, string(raw))
		}
		if len(cr.Choices) == 0 {
			return nil, nil, errors.New("deepseek: no choices")
		}
		var je JobsExtraction
		if err := json.Unmarshal([]byte(cr.Choices[0].Message.Content), &je); err != nil {
			return nil, nil, fmt.Errorf("decode jobs payload: %w; raw=%s", err, cr.Choices[0].Message.Content)
		}
		// DeepSeek pricing (rough): input ~14 cents per million, output ~28 cents per million.
		costCents := (cr.Usage.PromptTokens*14 + cr.Usage.CompletionTokens*28) / 1_000_000
		return &je, &Usage{PromptTokens: cr.Usage.PromptTokens, CompletionTokens: cr.Usage.CompletionTokens, CostCents: costCents}, nil
	}
	return nil, nil, fmt.Errorf("deepseek: gave up after 3 attempts: %w", lastErr)
}
