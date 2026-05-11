package announcements

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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

type fakeCRUD struct {
	listed  []Announcement
	created Announcement
	createE error
	deleted bool
	delErr  error
}

func (f *fakeCRUD) List(ctx context.Context) ([]Announcement, error) { return f.listed, nil }
func (f *fakeCRUD) Create(ctx context.Context, sev, body string) (Announcement, error) {
	f.created = Announcement{Severity: sev, Body: body, ID: 7}
	return f.created, f.createE
}
func (f *fakeCRUD) Delete(ctx context.Context, id int64) (bool, error) {
	if f.delErr != nil {
		return false, f.delErr
	}
	return f.deleted, nil
}

func TestAdminCreate(t *testing.T) {
	crud := &fakeCRUD{deleted: true}
	h := &AdminHandler{Store: crud}
	body := bytes.NewBufferString(`{"severity":"warning","body":"hello"}`)
	req := httptest.NewRequest(http.MethodPost, "/admin/api/announcements", body)
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if crud.created.Severity != "warning" || crud.created.Body != "hello" {
		t.Fatalf("unexpected create: %+v", crud.created)
	}
}

func TestAdminCreateInvalidSeverity(t *testing.T) {
	crud := &fakeCRUD{createE: errors.New("invalid severity")}
	h := &AdminHandler{Store: crud}
	body := bytes.NewBufferString(`{"severity":"meow","body":"hi"}`)
	req := httptest.NewRequest(http.MethodPost, "/admin/api/announcements", body)
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
