package skillsrv

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Item struct {
	ID        int      `json:"id"`
	Canonical string   `json:"canonical"`
	Aliases   []string `json:"aliases"`
}

type Server struct {
	Pool *pgxpool.Pool

	mu          sync.RWMutex
	skillsAt    time.Time
	rolesAt     time.Time
	skillsCache []Item
	rolesCache  []Item
}

const ttl = 5 * time.Minute

var Cities = []string{"台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市", "新竹市", "新竹縣", "其他"}

func (s *Server) Skills(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	if time.Since(s.skillsAt) < ttl && s.skillsCache != nil {
		out := s.skillsCache
		s.mu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]any{"skills": out})
		return
	}
	s.mu.RUnlock()
	items, err := s.fetch(r.Context(), "skills")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.skillsCache = items
	s.skillsAt = time.Now()
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"skills": items})
}

func (s *Server) Roles(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	if time.Since(s.rolesAt) < ttl && s.rolesCache != nil {
		out := s.rolesCache
		s.mu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]any{"roles": out})
		return
	}
	s.mu.RUnlock()
	items, err := s.fetch(r.Context(), "roles")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.rolesCache = items
	s.rolesAt = time.Now()
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"roles": items})
}

func (s *Server) CitiesH(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"cities": Cities})
}

func (s *Server) fetch(ctx context.Context, table string) ([]Item, error) {
	q := "SELECT id, canonical, aliases FROM " + table + " WHERE approved = true ORDER BY canonical"
	rows, err := s.Pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Item{}
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.ID, &it.Canonical, &it.Aliases); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
