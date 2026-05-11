package announcements

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxBodyBytes = 4096

type Announcement struct {
	ID        int64     `json:"id"`
	Severity  string    `json:"severity"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

type Repo struct {
	Pool *pgxpool.Pool
}

func validSeverity(s string) bool {
	switch s {
	case "info", "warning", "critical":
		return true
	}
	return false
}

func validBody(b string) error {
	if len(b) == 0 {
		return errors.New("body is empty")
	}
	if len(b) > maxBodyBytes {
		return errors.New("body exceeds 4096 bytes")
	}
	return nil
}

// List returns announcements ordered critical-first, then newest-first.
func (r *Repo) List(ctx context.Context) ([]Announcement, error) {
	rows, err := r.Pool.Query(ctx, `
SELECT id, severity, body, created_at
FROM announcements
ORDER BY (severity = 'critical') DESC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Announcement{}
	for rows.Next() {
		var a Announcement
		if err := rows.Scan(&a.ID, &a.Severity, &a.Body, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repo) Create(ctx context.Context, severity, body string) (Announcement, error) {
	if !validSeverity(severity) {
		return Announcement{}, errors.New("invalid severity")
	}
	if err := validBody(body); err != nil {
		return Announcement{}, err
	}
	var a Announcement
	err := r.Pool.QueryRow(ctx, `
INSERT INTO announcements (severity, body)
VALUES ($1, $2)
RETURNING id, severity, body, created_at`, severity, body).
		Scan(&a.ID, &a.Severity, &a.Body, &a.CreatedAt)
	return a, err
}

func (r *Repo) Delete(ctx context.Context, id int64) (bool, error) {
	tag, err := r.Pool.Exec(ctx, `DELETE FROM announcements WHERE id=$1`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

type Lister interface {
	List(ctx context.Context) ([]Announcement, error)
}

type PublicHandler struct {
	Lister Lister
}

func (h *PublicHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.Lister.List(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if items == nil {
		items = []Announcement{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
}

type Store interface {
	Lister
	Create(ctx context.Context, severity, body string) (Announcement, error)
	Delete(ctx context.Context, id int64) (bool, error)
}

type AdminHandler struct {
	Store Store
}

func (h *AdminHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.Store.List(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if items == nil {
		items = []Announcement{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
}

type createBody struct {
	Severity string `json:"severity"`
	Body     string `json:"body"`
}

func (h *AdminHandler) Create(w http.ResponseWriter, r *http.Request) {
	var b createBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	a, err := h.Store.Create(r.Context(), b.Severity, b.Body)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(a)
}

func (h *AdminHandler) Delete(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "bad id", 400)
		return
	}
	ok, err := h.Store.Delete(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
