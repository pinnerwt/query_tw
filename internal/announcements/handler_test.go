package announcements

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeLister struct {
	out []Announcement
	err error
}

func (f *fakeLister) List(ctx context.Context) ([]Announcement, error) {
	return f.out, f.err
}

func TestPublicListHandler(t *testing.T) {
	now := time.Now().UTC()
	h := &PublicHandler{Lister: &fakeLister{out: []Announcement{
		{ID: 2, Severity: "critical", Body: "fraud", CreatedAt: now},
		{ID: 1, Severity: "info", Body: "hello", CreatedAt: now.Add(-time.Hour)},
	}}}

	req := httptest.NewRequest(http.MethodGet, "/api/announcements", nil)
	w := httptest.NewRecorder()
	h.List(w, req)

	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var got struct {
		Items []Announcement `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 2 || got.Items[0].Severity != "critical" {
		t.Fatalf("unexpected items: %+v", got.Items)
	}
}
