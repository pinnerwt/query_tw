# Announcements, Ad slots, and PWA refresh — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add site-authored announcement cards (with admin CRUD) and Google AdSense slot cards to the Browse feed, both reusing the JobCard outer frame; add a PWA "new version available" toast and a manual "check for updates" button.

**Architecture:**
- Backend: a new `announcements` table + a small Go package serving `GET /api/announcements` (public) and `GET|POST|DELETE /admin/api/announcements` (basic-auth).
- Frontend: extract a shared `CardShell` from `JobCard`; add `AnnouncementCard` and `AdCard` (AdSense, gated on env vars); Browse renders announcements above the Virtuoso list (Header) and interleaves `AdCard` every N items in the data array. PWA registration switches from `autoUpdate` to `prompt`; a `RefreshPrompt` toast plus a `檢查更新` Settings button drive the swap.

**Tech stack:** Go 1.22 + chi + pgx; React 18 + TanStack Query + Tailwind + Virtuoso + vite-plugin-pwa; `react-markdown` (new dep, with `rehype-sanitize`).

**Design doc:** `docs/plans/2026-05-11-announcements-ads-pwa-refresh-design.md`

**Repo facts to remember:**
- Routes are wired in `cmd/api/main.go`. Admin routes mount at `/admin/api` via `internal/admin.Server.Routes` (chi sub-router, basic-auth middleware applied to whole group).
- Migrations in `migrations/000N_*.up.sql` / `.down.sql`. Highest existing: `0004_seed_categories`. Next: `0005_announcements`.
- Existing tests use the Go stdlib pattern; see `internal/filters/filters_test.go`. No fixtures harness; we'll add httptest-based tests for handlers and skip DB-backed tests (the repo is thin enough to test by wrapping the SQL in a `Repo` interface and faking).
- Frontend has no unit test runner; verification is via `npm run typecheck`, `npm run lint`, manual browser testing, and Playwright e2e (`web/e2e/`) for end-to-end flows. Add a Playwright spec for the announcement-renders-at-top happy path.
- `web/dist/` is baked into the api image at build time; after frontend changes use `./deploy/deploy-monitor.sh dev` (per CLAUDE.md "Frontend-only change").

---

## Task 1: Create `announcements` migration

**Files:**
- Create: `migrations/0005_announcements.up.sql`
- Create: `migrations/0005_announcements.down.sql`

**Step 1: Write `0005_announcements.up.sql`**

```sql
CREATE TABLE announcements (
    id          BIGSERIAL PRIMARY KEY,
    severity    TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX announcements_order_idx
    ON announcements ((severity = 'critical') DESC, created_at DESC);
```

**Step 2: Write `0005_announcements.down.sql`**

```sql
DROP TABLE IF EXISTS announcements;
```

**Step 3: Apply migration locally**

Run: `make migrate` (or, if no make target works, `go run ./cmd/api --migrate` against the local Postgres)
Expected: `migrations applied` log line, no error.

**Step 4: Verify table exists**

Run: `psql "$DATABASE_URL" -c '\d announcements'`
Expected: shows the three columns + check constraint + index.

**Step 5: Commit**

```bash
git add migrations/0005_announcements.up.sql migrations/0005_announcements.down.sql
git commit -m "Add announcements table migration"
```

---

## Task 2: Announcements Go package — repo + types

**Files:**
- Create: `internal/announcements/announcements.go`
- Create: `internal/announcements/announcements_test.go`

**Step 1: Write the failing test**

`internal/announcements/announcements_test.go`:

```go
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
```

**Step 2: Verify test fails**

Run: `go test ./internal/announcements/...`
Expected: build error / undefined `validSeverity`, `validBody`.

**Step 3: Write `internal/announcements/announcements.go`**

```go
package announcements

import (
	"context"
	"errors"
	"time"

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
```

**Step 4: Verify tests pass**

Run: `go test ./internal/announcements/...`
Expected: PASS.

**Step 5: Commit**

```bash
git add internal/announcements/
git commit -m "Add announcements repo with severity/body validation"
```

---

## Task 3: Public `GET /api/announcements` handler + test

**Files:**
- Modify: `internal/announcements/announcements.go` (add handler)
- Create: `internal/announcements/handler_test.go`
- Modify: `cmd/api/main.go` to wire route

**Step 1: Write the failing test**

`internal/announcements/handler_test.go`:

```go
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
```

**Step 2: Verify test fails**

Run: `go test ./internal/announcements/...`
Expected: build error — `PublicHandler` undefined.

**Step 3: Add handler in `internal/announcements/announcements.go`**

Append:

```go
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
```

Add the imports `encoding/json` and `net/http` at top of file.

**Step 4: Verify test passes**

Run: `go test ./internal/announcements/...`
Expected: PASS.

**Step 5: Wire route in `cmd/api/main.go`**

After line 81 (`r.Get("/api/categories", sk.Categories)`), add:

```go
annRepo := &announcements.Repo{Pool: pool}
r.Get("/api/announcements", (&announcements.PublicHandler{Lister: annRepo}).List)
```

And add the import `"github.com/pgi/matching/internal/announcements"`.

**Step 6: Verify build**

Run: `go build ./...`
Expected: no errors.

**Step 7: Commit**

```bash
git add internal/announcements/ cmd/api/main.go
git commit -m "Wire GET /api/announcements public endpoint"
```

---

## Task 4: Admin announcements handlers (list/create/delete)

**Files:**
- Modify: `internal/announcements/announcements.go` (add `AdminHandler`)
- Modify: `internal/announcements/handler_test.go`
- Modify: `internal/admin/admin.go` to register routes via the existing chi sub-router
- Modify: `cmd/api/main.go` to pass repo to admin server

The simplest wiring is to add the announcements routes inside `admin.Server.Routes`, since the basic-auth middleware is already attached to that group. We'll embed an `AdminHandler` on `admin.Server`.

**Step 1: Write failing tests for create + delete**

Append to `internal/announcements/handler_test.go`:

```go
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
```

Add imports `bytes` and `errors` to the test file.

**Step 2: Verify they fail**

Run: `go test ./internal/announcements/...`
Expected: build error — `AdminHandler` undefined.

**Step 3: Implement `AdminHandler` in `internal/announcements/announcements.go`**

Append:

```go
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
```

Add imports: `"strconv"`, `"github.com/go-chi/chi/v5"`.

**Step 4: Verify tests pass**

Run: `go test ./internal/announcements/...`
Expected: PASS.

**Step 5: Wire admin routes**

In `internal/admin/admin.go`:

- Add field `Announcements *announcements.AdminHandler` on `Server` struct.
- In `Routes`, add (after the existing handlers):

```go
r.Get("/announcements", s.Announcements.List)
r.Post("/announcements", s.Announcements.Create)
r.Delete("/announcements/{id}", s.Announcements.Delete)
```

Add the import `"github.com/pgi/matching/internal/announcements"`.

**Step 6: Construct in `cmd/api/main.go`**

Replace the `adm := &admin.Server{...}` line with:

```go
adm := &admin.Server{
	Pool:           pool,
	BasicAuth:      cfg.AdminBasicAuth,
	Announcements:  &announcements.AdminHandler{Store: annRepo},
}
```

(Reusing the `annRepo` declared in Task 3.)

**Step 7: Verify build**

Run: `go build ./...`
Expected: no errors.

**Step 8: Smoke test admin endpoint**

Run (against a running local API):
```bash
curl -u "$ADMIN_BASIC_AUTH" -H 'Content-Type: application/json' \
  -d '{"severity":"warning","body":"test fraud notice"}' \
  http://localhost:8080/admin/api/announcements
curl http://localhost:8080/api/announcements
```
Expected: first returns the created row; second returns it inside `{"items":[...]}`.

**Step 9: Commit**

```bash
git add internal/announcements/ internal/admin/admin.go cmd/api/main.go
git commit -m "Add admin announcements CRUD endpoints"
```

---

## Task 5: Frontend dep — install `react-markdown` + sanitize

**Files:**
- Modify: `web/package.json`, `web/package-lock.json`

**Step 1: Install deps**

```bash
cd web && npm install react-markdown rehype-sanitize
```

Expected: `react-markdown` (v9 line) and `rehype-sanitize` added.

**Step 2: Verify typecheck still clean**

Run: `npm run typecheck`
Expected: no errors.

**Step 3: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "Add react-markdown + rehype-sanitize for announcement bodies"
```

---

## Task 6: Extract `CardShell` and refactor `JobCard`

**Files:**
- Create: `web/src/components/CardShell.tsx`
- Modify: `web/src/components/jobs/JobCard.tsx`

**Step 1: Create `CardShell.tsx`**

```tsx
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  testId?: string;
  className?: string;
  faded?: boolean;
};

export function CardShell({ children, testId, className = '', faded = false }: Props) {
  return (
    <article
      data-testid={testId}
      className={`min-h-[7rem] rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${
        faded ? 'opacity-70' : ''
      } ${className}`}
    >
      {children}
    </article>
  );
}
```

(`min-h-[7rem]` matches the current JobCard's natural height with title + meta + chips; tune in Task 14 if needed.)

**Step 2: Refactor `JobCard.tsx`**

Replace the outer `<article ...>` element with `<CardShell testId="job-card" faded={seen}>`. Remove the duplicated class list. Keep all inner content unchanged.

**Step 3: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

**Step 4: Verify Browse still renders**

Run: `npm run dev`, open http://localhost:5173, confirm job cards look identical (rough visual check).

**Step 5: Commit**

```bash
git add web/src/components/CardShell.tsx web/src/components/jobs/JobCard.tsx
git commit -m "Extract CardShell and refactor JobCard to use it"
```

---

## Task 7: Frontend types + API hooks for announcements

**Files:**
- Modify: `web/src/types.ts`
- Create: `web/src/api/announcements.ts`

**Step 1: Add types in `types.ts`**

Append:

```ts
export type AnnouncementSeverity = 'info' | 'warning' | 'critical';

export type Announcement = {
  id: number;
  severity: AnnouncementSeverity;
  body: string;
  created_at: string;
};
```

**Step 2: Create `web/src/api/announcements.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Announcement, AnnouncementSeverity } from '../types';

export function useAnnouncements() {
  return useQuery({
    queryKey: ['announcements'],
    queryFn: () => api<{ items: Announcement[] }>(`/api/announcements`),
    staleTime: 60 * 1000,
  });
}

export function useAdminAnnouncements() {
  return useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: () => api<{ items: Announcement[] }>(`/admin/api/announcements`),
  });
}

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { severity: AnnouncementSeverity; body: string }) =>
      api<Announcement>(`/admin/api/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api<void>(`/admin/api/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
}
```

**Step 3: Confirm `api()` supports `method`/`body`**

Open `web/src/api/client.ts`. If it doesn't accept a second `RequestInit` arg, extend it minimally:

```ts
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
```

(Match the existing return-type convention.)

**Step 4: typecheck**

Run: `npm run typecheck`
Expected: no errors.

**Step 5: Commit**

```bash
git add web/src/types.ts web/src/api/announcements.ts web/src/api/client.ts
git commit -m "Add announcement types + react-query hooks"
```

---

## Task 8: `AnnouncementCard` component + dismiss store

**Files:**
- Create: `web/src/state/dismissedStore.ts`
- Create: `web/src/components/AnnouncementCard.tsx`

**Step 1: Create `dismissedStore.ts`**

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type State = {
  ids: number[];
  dismiss: (id: number) => void;
};

export const useDismissedStore = create<State>()(
  persist(
    (set) => ({
      ids: [],
      dismiss: (id) =>
        set((s) => (s.ids.includes(id) ? s : { ids: [...s.ids, id] })),
    }),
    { name: 'dismissed_announcements' },
  ),
);
```

(Matches the existing `configStore` / `seenStore` zustand-persist pattern.)

**Step 2: Create `AnnouncementCard.tsx`**

```tsx
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { CardShell } from './CardShell';
import { useDismissedStore } from '../state/dismissedStore';
import type { Announcement } from '../types';

const SEVERITY_STYLES: Record<Announcement['severity'], { border: string; chip: string; label: string }> = {
  info:     { border: 'border-l-4 border-l-slate-400',  chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200', label: '公告' },
  warning:  { border: 'border-l-4 border-l-amber-500', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200', label: '注意' },
  critical: { border: 'border-l-4 border-l-rose-600',  chip: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-100',     label: '警告' },
};

export function AnnouncementCard({ a }: { a: Announcement }) {
  const dismiss = useDismissedStore((s) => s.dismiss);
  const styles = SEVERITY_STYLES[a.severity];
  return (
    <CardShell testId="announcement-card" className={styles.border}>
      <div className="flex items-start justify-between gap-2">
        <span className={`chip ${styles.chip}`}>{styles.label}</span>
        <button
          aria-label="關閉公告"
          onClick={() => dismiss(a.id)}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          data-testid="dismiss-announcement"
        >
          ✕
        </button>
      </div>
      <div className="prose prose-sm mt-2 max-w-none dark:prose-invert">
        <ReactMarkdown
          rehypePlugins={[rehypeSanitize]}
          components={{
            a: ({ node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
          }}
        >
          {a.body}
        </ReactMarkdown>
      </div>
    </CardShell>
  );
}
```

**Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `prose` Tailwind class isn't available, switch to inline `whitespace-pre-wrap text-sm` and remove `prose` classes — Tailwind typography plugin is optional.)

**Step 4: Commit**

```bash
git add web/src/state/dismissedStore.ts web/src/components/AnnouncementCard.tsx
git commit -m "Add AnnouncementCard with severity styling + dismiss store"
```

---

## Task 9: `AdCard` component (AdSense, env-gated)

**Files:**
- Create: `web/src/components/AdCard.tsx`
- Modify: `web/src/main.tsx`

**Step 1: Loader in `main.tsx`**

Add at the top of `main.tsx`, before `ReactDOM.createRoot`:

```ts
const adsenseClient = import.meta.env.VITE_ADSENSE_CLIENT;
if (adsenseClient && typeof document !== 'undefined' && !document.querySelector('script[data-adsbygoogle]')) {
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.dataset.adsbygoogle = '1';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`;
  document.head.appendChild(s);
}
```

**Step 2: Create `AdCard.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { CardShell } from './CardShell';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const CLIENT = import.meta.env.VITE_ADSENSE_CLIENT as string | undefined;
const SLOT = import.meta.env.VITE_ADSENSE_SLOT as string | undefined;

export function AdCard() {
  const pushed = useRef(false);
  useEffect(() => {
    if (!CLIENT || !SLOT || pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {
      /* noop */
    }
  }, []);

  if (!CLIENT || !SLOT) return null;

  return (
    <CardShell testId="ad-card">
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={CLIENT}
        data-ad-slot={SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </CardShell>
  );
}

export const AD_EVERY = Number(import.meta.env.VITE_AD_EVERY ?? 8);
export const AD_ENABLED = Boolean(CLIENT && SLOT);
```

**Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

**Step 4: Commit**

```bash
git add web/src/components/AdCard.tsx web/src/main.tsx
git commit -m "Add AdCard with env-gated AdSense loader"
```

---

## Task 10: Browse page integration — announcements top + ads every N

**Files:**
- Modify: `web/src/pages/Browse.tsx`

**Step 1: Update Browse**

- Add imports: `useAnnouncements`, `AnnouncementCard`, `AdCard`, `AD_EVERY`, `AD_ENABLED`, `useDismissedStore`.
- Compute visible announcements: filter `useAnnouncements().data?.items ?? []` by `!dismissedIds.includes(a.id)`.
- Build a feed array `({type:'job', job}|{type:'ad', key})[]`:

```ts
type FeedItem = { type: 'job'; job: JobView } | { type: 'ad'; key: string };

const feed: FeedItem[] = AD_ENABLED
  ? jobs.flatMap((j, i): FeedItem[] => {
      const items: FeedItem[] = [{ type: 'job', job: j }];
      if ((i + 1) % AD_EVERY === 0) items.push({ type: 'ad', key: `ad-${i}` });
      return items;
    })
  : jobs.map((j) => ({ type: 'job', job: j }));
```

- Use Virtuoso's `Header` component to render announcements above the list:

```tsx
components={{
  Header: () =>
    announcements.length > 0 ? (
      <div className="space-y-2 px-3 pt-3">
        {announcements.map((a) => (
          <AnnouncementCard key={a.id} a={a} />
        ))}
      </div>
    ) : null,
  Footer: ...,
}}
```

- Update `Virtuoso data={feed}` and `itemContent={(_, item) => item.type === 'job' ? <JobCard ... /> : <AdCard />}`.

(Adjust the empty-state check to `jobs.length === 0 && announcements.length === 0 && !isFetching`.)

**Step 2: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

**Step 3: Visually verify**

Run: `npm run dev`. With `VITE_ADSENSE_CLIENT` unset, the feed should be jobs-only (no broken ad cards). Add an announcement via curl (admin endpoint from Task 4) and confirm it appears at the top of the Browse list.

**Step 4: Commit**

```bash
git add web/src/pages/Browse.tsx
git commit -m "Render announcements at top of feed and interleave AdCard"
```

---

## Task 11: Admin page — announcement form + list

**Files:**
- Modify: `web/src/pages/Admin.tsx`

**Step 1: Add an "公告" section**

At the bottom of the existing Admin page render tree, add a new section that:
- Renders a `<form>` with: `<select>` for severity (info/warning/critical), `<textarea>` for body, a live preview pane that renders the textarea contents via `AnnouncementCard` (preview only — don't dismiss-link it; use a fake id `-1` or render the markdown directly without the dismiss button).
- Lists existing announcements (`useAdminAnnouncements()`) below the form. Each row: rendered `AnnouncementCard` followed by a "刪除" button calling `useDeleteAnnouncement().mutate(a.id)`.

Concrete sketch:

```tsx
import { useState } from 'react';
import { AnnouncementCard } from '../components/AnnouncementCard';
import {
  useAdminAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
} from '../api/announcements';
import type { AnnouncementSeverity } from '../types';

function AnnouncementsAdmin() {
  const [sev, setSev] = useState<AnnouncementSeverity>('info');
  const [body, setBody] = useState('');
  const create = useCreateAnnouncement();
  const del = useDeleteAnnouncement();
  const { data } = useAdminAnnouncements();

  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-lg font-semibold">公告管理</h2>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          create.mutate({ severity: sev, body }, { onSuccess: () => setBody('') });
        }}
      >
        <select value={sev} onChange={(e) => setSev(e.target.value as AnnouncementSeverity)} className="rounded border px-2 py-1 dark:bg-slate-800">
          <option value="info">info</option>
          <option value="warning">warning</option>
          <option value="critical">critical</option>
        </select>
        <textarea
          className="block w-full rounded border p-2 dark:bg-slate-800"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="支援 markdown — **粗體**、[連結](https://…)"
        />
        <div className="text-xs text-slate-500">預覽：</div>
        {body.trim() && (
          <AnnouncementCard a={{ id: -1, severity: sev, body, created_at: new Date().toISOString() }} />
        )}
        <button type="submit" className="btn" disabled={create.isPending}>
          發布
        </button>
      </form>
      <div className="space-y-2">
        {(data?.items ?? []).map((a) => (
          <div key={a.id} className="flex items-start gap-2">
            <div className="flex-1"><AnnouncementCard a={a} /></div>
            <button
              className="btn-ghost text-rose-700"
              onClick={() => del.mutate(a.id)}
              disabled={del.isPending}
            >
              刪除
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
```

Mount `<AnnouncementsAdmin />` inside the Admin page's existing top-level layout (after the existing sections).

**Step 2: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

**Step 3: Manual smoke**

Run dev server, browse to `/admin`, log in with `ADMIN_BASIC_AUTH`, create a `critical` announcement, see it appear in the public Browse feed at the top, dismiss it, refresh — gone (until the user clears localStorage).

**Step 4: Commit**

```bash
git add web/src/pages/Admin.tsx
git commit -m "Add admin UI for creating/previewing/deleting announcements"
```

---

## Task 12: Switch PWA to `prompt` mode

**Files:**
- Modify: `web/vite.config.ts`
- Modify: `web/tsconfig.json` (add `types: ["vite-plugin-pwa/client"]` if not already present)

**Step 1: Edit `vite.config.ts`**

Change `registerType: 'autoUpdate'` to `registerType: 'prompt'`.

**Step 2: tsconfig**

Open `tsconfig.json`; if no `types` array under `compilerOptions`, add:

```json
"types": ["vite-plugin-pwa/client"]
```

(or extend the existing array). This exposes the `virtual:pwa-register/react` module type.

**Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

**Step 4: Commit**

```bash
git add web/vite.config.ts web/tsconfig.json
git commit -m "Switch PWA registerType to prompt"
```

---

## Task 13: `RefreshPrompt` toast component + mount

**Files:**
- Create: `web/src/components/RefreshPrompt.tsx`
- Modify: `web/src/App.tsx`

**Step 1: Create `RefreshPrompt.tsx`**

```tsx
import { useRegisterSW } from 'virtual:pwa-register/react';

export function RefreshPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      if (r) (window as unknown as { __swReg?: ServiceWorkerRegistration }).__swReg = r;
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      data-testid="refresh-prompt"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-800"
    >
      <span className="text-sm">有新版本可用</span>
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => setNeedRefresh(false)}>稍後</button>
        <button className="btn" onClick={() => updateServiceWorker(true)}>立即更新</button>
      </div>
    </div>
  );
}
```

(The `__swReg` global is stashed so the Settings button in Task 14 can call `registration.update()` from anywhere.)

**Step 2: Mount in `App.tsx`**

Import `RefreshPrompt` and place `<RefreshPrompt />` once inside the top-level layout, near the root (e.g. just inside the outer `<div>` that wraps the router).

**Step 3: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean. Build should produce `dist/sw.js` and `registerSW.js`.

**Step 4: Commit**

```bash
git add web/src/components/RefreshPrompt.tsx web/src/App.tsx
git commit -m "Add refresh-available toast and mount in App"
```

---

## Task 14: Settings "檢查更新" button

**Files:**
- Modify: `web/src/pages/Settings.tsx`

**Step 1: Add the button**

At a sensible place in the existing Settings layout, add:

```tsx
const [msg, setMsg] = useState<string | null>(null);

async function checkForUpdate() {
  setMsg('檢查中…');
  const reg = (window as unknown as { __swReg?: ServiceWorkerRegistration }).__swReg;
  if (!reg) {
    setMsg('Service worker 尚未註冊');
    return;
  }
  await reg.update();
  if (reg.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  } else {
    setMsg('已是最新版本');
  }
}
```

Render:

```tsx
<button className="btn" onClick={checkForUpdate} data-testid="check-update">
  檢查更新
</button>
{msg && <p className="text-xs text-slate-500">{msg}</p>}
```

**Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: clean.

**Step 3: Commit**

```bash
git add web/src/pages/Settings.tsx
git commit -m "Add manual 'check for updates' button in Settings"
```

---

## Task 15: Playwright e2e — announcement renders at top

**Files:**
- Create: `web/e2e/announcements.spec.ts`

**Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('announcement appears above job cards on Browse', async ({ page }) => {
  await page.route('**/api/announcements', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          { id: 999, severity: 'critical', body: '**詐騙警告**：請小心', created_at: new Date().toISOString() },
        ],
      }),
    }),
  );
  await page.goto('/');
  const announcement = page.getByTestId('announcement-card');
  await expect(announcement).toBeVisible();
  await expect(announcement).toContainText('詐騙警告');
});

test('dismissed announcement does not reappear after reload', async ({ page }) => {
  await page.route('**/api/announcements', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{ id: 998, severity: 'info', body: 'hello', created_at: new Date().toISOString() }],
      }),
    }),
  );
  await page.goto('/');
  await page.getByTestId('dismiss-announcement').click();
  await page.reload();
  await expect(page.getByTestId('announcement-card')).toHaveCount(0);
});
```

**Step 2: Run e2e**

Run: `npm run e2e -- announcements.spec.ts`
Expected: both tests pass.

**Step 3: Commit**

```bash
git add web/e2e/announcements.spec.ts
git commit -m "Add Playwright spec for announcement render + dismiss"
```

---

## Task 16: Documentation update

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Document new env vars and admin section**

Under the existing "Env-var change" subsection, add a short bullet listing:

- `VITE_ADSENSE_CLIENT`, `VITE_ADSENSE_SLOT` — empty by default; when set, AdCard renders the AdSense slot every `VITE_AD_EVERY` (default 8) job cards.
- Mention announcements are managed via `/admin` (`announcements` table; `GET /api/announcements` is public).

**Step 2: Verify**

Run: `git diff CLAUDE.md` to confirm the changes are small and accurate.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document AdSense env vars and announcements"
```

---

## Verification

After all tasks complete, run:

- `go build ./... && go test ./...` — backend builds and passes.
- `cd web && npm run typecheck && npm run lint && npm run build` — frontend clean.
- `cd web && npm run e2e` — all Playwright tests green.
- Deploy to dev: `./deploy/deploy-monitor.sh dev`, hit `https://dev.query.tw`, manually:
  1. Create an `info` announcement via admin → see it at top of feed.
  2. Create a `critical` one → it bubbles above the `info` one.
  3. Dismiss one → reload → still dismissed.
  4. Confirm no ad slot is rendered (env vars unset).
  5. Re-deploy a trivial change; on the still-open Browse tab, the "有新版本可用" toast should appear within a few seconds of the new SW finishing install. Click 立即更新 → page reloads with the new bundle.
  6. Open Settings, click 檢查更新, see "已是最新版本".

If all green, open a PR `dev` → `master` per the workflow in `CLAUDE.md`.
