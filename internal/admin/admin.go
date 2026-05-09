package admin

import (
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	Pool      *pgxpool.Pool
	BasicAuth string // "user:pass"
}

func (s *Server) Routes(r chi.Router) {
	r.Use(s.basicAuth)
	r.Get("/skills/pending", s.skillsPending)
	r.Post("/skills/approve", s.skillsApprove)
	r.Post("/skills/reject", s.skillsReject)
	r.Get("/roles/pending", s.rolesPending)
	r.Post("/roles/approve", s.rolesApprove)
	r.Post("/roles/reject", s.rolesReject)
	r.Get("/extractions", s.extractions)
	r.Get("/posts/{id}/raw", s.postRaw)
	r.Get("/reports", s.reports)
	r.Get("/whoami", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}

func (s *Server) basicAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		want := s.BasicAuth
		u, p, ok := r.BasicAuth()
		if !ok || subtle.ConstantTimeCompare([]byte(u+":"+p), []byte(want)) != 1 {
			w.Header().Set("WWW-Authenticate", `Basic realm="admin"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type dictItem struct {
	ID        int      `json:"id"`
	Canonical string   `json:"canonical"`
	Aliases   []string `json:"aliases"`
}

func (s *Server) listPending(w http.ResponseWriter, r *http.Request, table string) {
	rows, err := s.Pool.Query(r.Context(), "SELECT id, canonical, aliases FROM "+table+" WHERE approved=false ORDER BY id DESC LIMIT 200")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	out := []dictItem{}
	for rows.Next() {
		var d dictItem
		if err := rows.Scan(&d.ID, &d.Canonical, &d.Aliases); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if d.Aliases == nil {
			d.Aliases = []string{}
		}
		out = append(out, d)
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

func (s *Server) skillsPending(w http.ResponseWriter, r *http.Request) { s.listPending(w, r, "skills") }
func (s *Server) rolesPending(w http.ResponseWriter, r *http.Request)  { s.listPending(w, r, "roles") }

type idsBody struct {
	IDs []int `json:"ids"`
}

func (s *Server) approveAll(w http.ResponseWriter, r *http.Request, table string) {
	var b idsBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if len(b.IDs) == 0 {
		writeJSON(w, 200, map[string]any{"updated": 0})
		return
	}
	tag, err := s.Pool.Exec(r.Context(), "UPDATE "+table+" SET approved=true WHERE id = ANY($1)", b.IDs)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, map[string]any{"updated": tag.RowsAffected()})
}

func (s *Server) rejectAll(w http.ResponseWriter, r *http.Request, table string) {
	var b idsBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if len(b.IDs) == 0 {
		writeJSON(w, 200, map[string]any{"deleted": 0})
		return
	}
	tag, err := s.Pool.Exec(r.Context(), "DELETE FROM "+table+" WHERE id = ANY($1) AND approved=false", b.IDs)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, map[string]any{"deleted": tag.RowsAffected()})
}

func (s *Server) skillsApprove(w http.ResponseWriter, r *http.Request) { s.approveAll(w, r, "skills") }
func (s *Server) skillsReject(w http.ResponseWriter, r *http.Request)  { s.rejectAll(w, r, "skills") }
func (s *Server) rolesApprove(w http.ResponseWriter, r *http.Request)  { s.approveAll(w, r, "roles") }
func (s *Server) rolesReject(w http.ResponseWriter, r *http.Request)   { s.rejectAll(w, r, "roles") }

type extractionItem struct {
	PostID           string  `json:"post_id"`
	URL              string  `json:"url"`
	AuthorHandle     string  `json:"author_handle"`
	FetchedAt        string  `json:"fetched_at"`
	PostedAt         string  `json:"posted_at"`
	JobCount         int     `json:"job_count"`
	SpamScore        *float64 `json:"spam_score,omitempty"`
	ExtractionFailed bool    `json:"extraction_failed"`
}

func (s *Server) extractions(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	rows, err := s.Pool.Query(r.Context(), `
SELECT id, url, author_handle, fetched_at, posted_at, job_count, spam_score, extraction_failed
FROM posts
ORDER BY fetched_at DESC
LIMIT $1`, limit)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	out := []extractionItem{}
	for rows.Next() {
		var (
			id        []byte
			url       string
			handle    string
			fetched   any
			posted    any
			count     int
			spam      *float64
			failed    bool
		)
		if err := rows.Scan(&id, &url, &handle, &fetched, &posted, &count, &spam, &failed); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		out = append(out, extractionItem{
			PostID:           hex.EncodeToString(id),
			URL:              url,
			AuthorHandle:     handle,
			FetchedAt:        toTimeStr(fetched),
			PostedAt:         toTimeStr(posted),
			JobCount:         count,
			SpamScore:        spam,
			ExtractionFailed: failed,
		})
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

func (s *Server) postRaw(w http.ResponseWriter, r *http.Request) {
	hexID := chi.URLParam(r, "id")
	id, err := hex.DecodeString(hexID)
	if err != nil {
		http.Error(w, "bad id", 400)
		return
	}
	row := s.Pool.QueryRow(r.Context(), `
SELECT url, author_handle, posted_at, raw_text, raw_extraction, job_count, extraction_failed
FROM posts WHERE id=$1`, id)
	var (
		url      string
		handle   string
		posted   any
		rawText  *string
		rawExt   []byte
		jobCount int
		failed   bool
	)
	if err := row.Scan(&url, &handle, &posted, &rawText, &rawExt, &jobCount, &failed); err != nil {
		http.Error(w, err.Error(), 404)
		return
	}
	resp := map[string]any{
		"url":               url,
		"author_handle":     handle,
		"posted_at":         toTimeStr(posted),
		"job_count":         jobCount,
		"extraction_failed": failed,
	}
	if rawText != nil {
		resp["raw_text"] = *rawText
	}
	if len(rawExt) > 0 {
		var parsed any
		if err := json.Unmarshal(rawExt, &parsed); err == nil {
			resp["raw_extraction"] = parsed
		} else {
			resp["raw_extraction"] = string(rawExt)
		}
	}
	writeJSON(w, 200, resp)
}

func (s *Server) reports(w http.ResponseWriter, r *http.Request) {
	days := 30
	if v := r.URL.Query().Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 365 {
			days = n
		}
	}
	rows, err := s.Pool.Query(r.Context(),
		"SELECT date, payload FROM daily_reports ORDER BY date DESC LIMIT $1", days)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	type item struct {
		Date    string `json:"date"`
		Payload any    `json:"payload"`
	}
	out := []item{}
	for rows.Next() {
		var (
			date    any
			payload []byte
		)
		if err := rows.Scan(&date, &payload); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		var parsed any
		_ = json.Unmarshal(payload, &parsed)
		out = append(out, item{Date: toTimeStr(date), Payload: parsed})
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

func toTimeStr(v any) string {
	type stringer interface{ String() string }
	if s, ok := v.(stringer); ok {
		return s.String()
	}
	if s, ok := v.(string); ok {
		return s
	}
	if b, err := json.Marshal(v); err == nil {
		return strings.Trim(string(b), `"`)
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
