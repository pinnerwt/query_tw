package jobsrv

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/pgi/matching/internal/domain"
	"github.com/pgi/matching/internal/filters"
)

type Handler struct {
	Repo *Repo
	Now  func() time.Time
}

type page struct {
	Jobs       []domain.JobView `json:"jobs"`
	NextCursor string           `json:"next_cursor,omitempty"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	f, err := filters.Decode(q.Get("filters"))
	if err != nil {
		http.Error(w, "invalid filters: "+err.Error(), http.StatusBadRequest)
		return
	}
	cur, err := filters.DecodeCursor(q.Get("cursor"))
	if err != nil {
		http.Error(w, "invalid cursor: "+err.Error(), http.StatusBadRequest)
		return
	}
	limit := 30
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	now := time.Now()
	if h.Now != nil {
		now = h.Now()
	}
	// Re-tag the cursor type for the filters package
	var fCur *filters.Cursor
	if cur != nil {
		fCur = cur
	}
	sql, args := filters.BuildJobsQuery(f, fCur, limit, now)
	jobs, nc, err := h.Repo.List(ctx, sql, args, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out := page{Jobs: jobs}
	if nc != nil {
		out.NextCursor = nc.Encode()
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) One(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	v, err := h.Repo.FetchOne(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if v == nil {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
