# Job Categories (104-style mid-level taxonomy) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a multi-valued `category` axis to `jobs`, seeded with ~18 functional buckets modeled on 104人力銀行's mid-level taxonomy (軟體/工程, MIS/網管, 醫療專業, 財會/金融, …). The LLM extractor classifies each job into 1+ categories; the API exposes them in `JobView`; the frontend ships a category filter pill.

**Architecture:**
- New `categories` reference table (mirrors `skills`/`roles`: `id`, `canonical`, `aliases`, `approved`).
- New `job_categories` join table (mirrors `job_tags` shape: `(job_id, category_id)` PK).
- DeepSeek prompt gains a `categories: [string]` slot per job + a `_new_categories` echo bucket; persistence uses the same `upsertDict` helper, with `approved=false` for unknowns so admin can curate.
- `filters.Filters` gains `Categories []string`; `BuildJobsQuery` adds an `EXISTS` clause per selected category (matching by canonical OR alias, like skills/experience).
- `domain.JobView` gains `Categories []string`; `Repo.List`/`FetchOne` hydrate it.
- Frontend `Filters` type + sidebar gain a multi-select category picker fed by a new `/api/categories` endpoint; URL wire format extends naturally (base64 JSON).

**Tech Stack:** Go 1.22, Postgres 16, pgx/v5, React + Zustand + TanStack Query, Vite.

**Reference:** 104 mid-level groups (vocus.cc/article/652052f4fd897800019606b3, dgbas.gov.tw 中華民國職業標準分類).

**Verified preconditions (audited from repo):**
- `migrations/` is forward-only `.up.sql`/`.down.sql` numbered files; latest is `0002_seed.up.sql`.
- `internal/extract/persist.go:81-112` shows the per-job loop where skills/roles/languages/tags are inserted — categories slot in alongside.
- `internal/extract/persist.go:119` `upsertDict(tx, "categories", name)` works as-is once the table exists; unknowns become `approved=false`.
- `internal/extract/deepseek.go:14-30` `ExtractedJob` already has `Tags []string`; `Categories []string` mirrors it 1:1.
- `internal/extract/prompt.go` builds the system prompt with `%s` slots for skills + roles dictionaries — we add a third for categories and a corresponding `BuildPrompt` arg.
- `internal/filters/sql.go:71-88` shows the EXISTS-clause pattern for skills/experience — categories use the same shape but without `years_min`.
- `internal/jobsrv/repo.go:247-265` `fetchTags` is the exact pattern `fetchCategories` will follow (returns `map[string][]string`).
- `internal/skillsrv/skillsrv.go` already serves `/api/skills` and `/api/roles` with a 5-minute cache — `/api/categories` mirrors that.
- Frontend `web/src/types.ts:3-15` `Filters` type and `web/src/lib/filtersWire.ts` use a tolerant base64 JSON wire format — adding an optional `categories?: string[]` is non-breaking on old payloads.
- Existing posts have intact `posts.raw_text` + `posts.raw_extraction`, so back-population can re-run extraction or, simpler, ship empty categories on legacy rows and let the next scrape re-extract on conflict.
- Master ruleset enforces linear history + squash-only merges (per recent CI work) — every PR opened by this plan goes feature → dev, then dev → master squashed.

---

## Phase 1 — Schema + seed (backend foundation)

### Task 1: Create migration for `categories` + `job_categories`

**Files:**
- Create: `migrations/0003_categories.up.sql`
- Create: `migrations/0003_categories.down.sql`

**Step 1: Write `0003_categories.up.sql`**

```sql
CREATE TABLE categories (
  id        SERIAL PRIMARY KEY,
  canonical TEXT NOT NULL UNIQUE,
  aliases   TEXT[] NOT NULL DEFAULT '{}',
  approved  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE job_categories (
  job_id      BYTEA NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  category_id INT   NOT NULL REFERENCES categories(id),
  PRIMARY KEY (job_id, category_id)
);
CREATE INDEX job_categories_category_idx ON job_categories (category_id);
```

**Step 2: Write `0003_categories.down.sql`**

```sql
DROP TABLE IF EXISTS job_categories;
DROP TABLE IF EXISTS categories;
```

**Step 3: Verify migration runner discovers it**

Run: `grep -n "0003" cmd/api/main.go internal/db/*.go 2>/dev/null || echo "uses glob — fine"`

Expected: either grep matches an explicit list (then add `0003`) or no output (migrations auto-discover by filename).

**Step 4: Commit**

```bash
git checkout -b job-categories
git add migrations/0003_categories.up.sql migrations/0003_categories.down.sql
git commit -m "Add categories + job_categories tables"
```

---

### Task 2: Seed migration with 104 mid-level buckets

**Files:**
- Create: `migrations/0004_seed_categories.up.sql`
- Create: `migrations/0004_seed_categories.down.sql`

**Step 1: Write `0004_seed_categories.up.sql`**

```sql
-- 104 人力銀行 mid-level functional taxonomy (~18 buckets).
-- Canonical is the human-facing label; aliases include English + casual variants
-- the LLM is likely to emit. Add more aliases as needed.
INSERT INTO categories (canonical, aliases, approved) VALUES
  ('軟體/工程',     ARRAY['軟體工程','Software','Engineering','SWE','後端','前端','全端','Backend','Frontend','Fullstack'], true),
  ('MIS/網管',      ARRAY['MIS','IT','資訊管理','系統管理','網管','DevOps','SRE'], true),
  ('工程研發',      ARRAY['硬體研發','韌體','嵌入式','半導體','機電','Hardware','Firmware','Embedded'], true),
  ('生技/醫療研發', ARRAY['生技研發','醫材研發','BioTech','製藥研發'], true),
  ('醫療專業',      ARRAY['醫師','護理師','藥師','醫檢師','醫療','Clinical','Doctor','Nurse'], true),
  ('醫療/保健服務', ARRAY['長照','照服員','物理治療','保健','美容醫學'], true),
  ('財會/金融',     ARRAY['會計','財務','稅務','審計','金融','Banking','Accounting','Finance','CPA'], true),
  ('經營/人資/行政', ARRAY['經營企劃','幕僚','HR','人力資源','行政','總務','法務','智財','秘書'], true),
  ('行銷/企劃',     ARRAY['行銷','企劃','品牌','PM','Product Manager','專案管理','Project Manager','Marketing'], true),
  ('業務銷售',      ARRAY['業務','銷售','Sales','BD','Business Development','貿易','門市'], true),
  ('客服支援',      ARRAY['客服','客戶服務','Customer Service','CS','Support'], true),
  ('設計',          ARRAY['UI','UX','平面設計','視覺設計','Graphic','Designer','UI/UX','工業設計','室內設計'], true),
  ('傳播/編譯',     ARRAY['傳播','記者','編輯','編譯','文字','翻譯','編劇','製作','Translator','Editor','Journalist'], true),
  ('教育/研究',     ARRAY['老師','教師','補教','講師','教育','學術','研究員','Teacher','Lecturer','Researcher'], true),
  ('餐飲/旅遊/美容', ARRAY['餐飲','廚師','旅遊','美容','美髮','Barista','Chef','Stylist'], true),
  ('製造/品管',     ARRAY['作業員','製程','品保','品管','QA','QC','生產管理','環安衛','Manufacturing'], true),
  ('營建/製圖',     ARRAY['營建','工地','監工','建築','土木','製圖','測量','Construction','Drafting'], true),
  ('操作/維修/物流', ARRAY['操作','維修','技師','倉管','採購','物流','司機','Logistics','Warehouse','Driver'], true),
  ('軍警保全/農林漁牧', ARRAY['軍警','保全','警衛','消防','農','林','漁','牧','Security','Farmer'], true),
  ('其他',          ARRAY['Other','其他類'], true);
```

**Step 2: Write `0004_seed_categories.down.sql`**

```sql
TRUNCATE categories CASCADE;
```

**Step 3: Run migrations against dev DB to validate**

Run:
```sh
make migrate
psql "$DATABASE_URL" -c "SELECT count(*) FROM categories WHERE approved;"
```
Expected: `20` rows.

**Step 4: Commit**

```bash
git add migrations/0004_seed_categories.up.sql migrations/0004_seed_categories.down.sql
git commit -m "Seed categories with 104 mid-level taxonomy"
```

---

## Phase 2 — Extractor changes (LLM + persistence)

### Task 3: Add `Categories` to `ExtractedJob` and prompt

**Files:**
- Modify: `internal/extract/deepseek.go`
- Modify: `internal/extract/prompt.go`

**Step 1: Add `Categories` field to `ExtractedJob`**

In `internal/extract/deepseek.go`, after the `Tags` field (line 28):

```go
Tags       []string        `json:"tags,omitempty"`
Categories []string        `json:"categories,omitempty"`
```

And to `JobsExtraction`, after `NewRoles`:

```go
NewCategories []string `json:"_new_categories,omitempty"`
```

**Step 2: Extend the prompt**

In `internal/extract/prompt.go`, modify `promptTemplate`:

- Add inside the per-job schema (after `"tags": [string],`):
  ```
  "categories": [string],       // 從下方類別字典中挑選 1-2 個最貼切；不適用時可空
  ```
- Add a third dictionary block after the roles dictionary block:
  ```
  已核可職類字典（必填欄位 categories，僅從此清單挑選；找不到貼切者放入 _new_categories 並暫填 "其他"）:
  %s
  ```
- Add `"_new_categories": [string]` to the JSON schema example near `_new_roles`.

**Step 3: Update `BuildPrompt` signature**

Change to:

```go
func BuildPrompt(skills, roles, categories []string) string {
    return fmt.Sprintf(promptTemplate,
        strings.Join(skills, ", "),
        strings.Join(roles, ", "),
        strings.Join(categories, ", "),
    )
}
```

**Step 4: Verify it compiles**

Run: `go build ./internal/extract/...`
Expected: callers fail to compile (good — Task 4 fixes them).

**Step 5: Commit**

```bash
git add internal/extract/deepseek.go internal/extract/prompt.go
git commit -m "extract: add categories to schema + prompt"
```

---

### Task 4: Load category dictionary in extractor and pass to prompt

**Files:**
- Modify: `cmd/extractor/main.go`

**Step 1: Extend `dict` struct**

```go
type dict struct {
    Skills     []string
    Roles      []string
    Categories []string
}
```

**Step 2: Add a third query in `loadDict`**

After the roles query block (around line 166-174 — read the file first), add:

```go
rows, err = pool.Query(ctx, "SELECT canonical FROM categories WHERE approved=true ORDER BY canonical")
if err != nil {
    return nil, err
}
for rows.Next() {
    var s string
    if err := rows.Scan(&s); err != nil {
        return nil, err
    }
    d.Categories = append(d.Categories, s)
}
rows.Close()
```

**Step 3: Update `BuildPrompt` callsite**

```go
system := extract.BuildPrompt(dict.Skills, dict.Roles, dict.Categories)
```

And the `logger.Info("extractor ready", ...)` line — add `"categories", len(dict.Categories)`.

**Step 4: Build and run unit-ish smoke**

Run: `go build ./...`
Expected: clean build.

**Step 5: Commit**

```bash
git add cmd/extractor/main.go
git commit -m "extractor: load categories dict and inject into prompt"
```

---

### Task 5: Persist categories in transaction

**Files:**
- Modify: `internal/extract/persist.go`
- Modify: `internal/extract/persist.go` (search-text builder)

**Step 1: Insert categories per job**

In `Persist`, inside the per-job loop after the tags-insert block (line 107-112), add:

```go
for _, c := range j.Categories {
    catID, err := upsertDict(ctx, tx, "categories", c)
    if err != nil {
        return err
    }
    if _, err := tx.Exec(ctx, `INSERT INTO job_categories (job_id, category_id) VALUES ($1,$2)
ON CONFLICT DO NOTHING`, jid, catID); err != nil {
        return fmt.Errorf("insert job_category: %w", err)
    }
}
```

**Step 2: Include categories in tsvector text**

In `buildSearchText` (line 153), append:

```go
parts = append(parts, j.Categories...)
```

(Order: after the existing `tags` append loop.)

**Step 3: Build**

Run: `go build ./...`
Expected: clean.

**Step 4: Commit**

```bash
git add internal/extract/persist.go
git commit -m "extract/persist: write job_categories + include in search_tsv"
```

---

## Phase 3 — API surface

### Task 6: Filter wire format + SQL clause

**Files:**
- Modify: `internal/filters/filters.go`
- Modify: `internal/filters/sql.go`
- Modify: `internal/filters/filters_test.go`

**Step 1: Add the field**

In `Filters` struct (line 16-28):

```go
Categories []string `json:"categories,omitempty"`
```

(Place it after `Cities`.)

**Step 2: Write a failing test for the SQL clause**

In `internal/filters/filters_test.go`, add:

```go
func TestBuildJobsQueryCategories(t *testing.T) {
    now := time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC)
    f := &Filters{Categories: []string{"軟體/工程", "MIS/網管"}, HideSpam: true}
    sql, args := BuildJobsQuery(f, nil, 30, now)
    if !strings.Contains(sql, "FROM job_categories") {
        t.Fatalf("expected job_categories EXISTS clause; got:\n%s", sql)
    }
    found := 0
    for _, a := range args {
        if s, ok := a.(string); ok && (s == "軟體/工程" || s == "MIS/網管") {
            found++
        }
    }
    if found != 2 {
        t.Fatalf("expected both categories bound; args=%v", args)
    }
}
```

**Step 3: Run the test, confirm it fails**

Run: `go test ./internal/filters/...`
Expected: FAIL — clause not present.

**Step 4: Add the clause in `BuildJobsQuery`**

In `internal/filters/sql.go`, after the experience-rows block (line 81-88), add:

```go
// Categories: any-of match against canonical or aliases.
if len(f.Categories) > 0 {
    nm := add(f.Categories)
    sb.WriteString(fmt.Sprintf(` AND EXISTS (
  SELECT 1 FROM job_categories jc JOIN categories cat ON cat.id = jc.category_id
  WHERE jc.job_id = j.id AND (cat.canonical = ANY(%s) OR cat.aliases && %s)
)`, nm, nm))
}
```

**Step 5: Re-run the test**

Run: `go test ./internal/filters/...`
Expected: PASS.

**Step 6: Commit**

```bash
git add internal/filters/filters.go internal/filters/sql.go internal/filters/filters_test.go
git commit -m "filters: add categories filter clause"
```

---

### Task 7: Hydrate `Categories` in `JobView`

**Files:**
- Modify: `internal/domain/job.go` (the file containing `JobView` — confirm name with `grep -l "type JobView" internal/domain/`)
- Modify: `internal/jobsrv/repo.go`

**Step 1: Add field to `JobView`**

After `Tags []string`:

```go
Tags       []string  `json:"tags"`
Categories []string  `json:"categories"`
```

**Step 2: Add `fetchCategories` to `Repo`**

In `internal/jobsrv/repo.go`, after `fetchTags` (line 247-265), add:

```go
func (r *Repo) fetchCategories(ctx context.Context, ids [][]byte) (map[string][]string, error) {
    rows, err := r.Pool.Query(ctx, `
SELECT jc.job_id, cat.canonical
FROM job_categories jc JOIN categories cat ON cat.id = jc.category_id
WHERE jc.job_id = ANY($1)
ORDER BY cat.canonical`, ids)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    m := map[string][]string{}
    for rows.Next() {
        var jobID []byte
        var name string
        if err := rows.Scan(&jobID, &name); err != nil {
            return nil, err
        }
        k := hex.EncodeToString(jobID)
        m[k] = append(m[k], name)
    }
    return m, rows.Err()
}
```

**Step 3: Wire it into `List`**

After the `tags, err := r.fetchTags(...)` line (line 92-95), add:

```go
cats, err := r.fetchCategories(ctx, ids)
if err != nil {
    return nil, nil, err
}
```

In the `JobView` construction loop, set `Categories: cats[hexID],` after `Tags`.

In the `if v.Tags == nil` nil-coalesce block, add:
```go
if v.Categories == nil {
    v.Categories = []string{}
}
```

**Step 4: Wire it into `FetchOne`**

Same shape: fetch via `r.fetchCategories(ctx, [][]byte{rr.id})`, attach `Categories: cats[hexK]`, nil-coalesce.

**Step 5: Build + test**

Run: `go build ./... && go test ./...`
Expected: green.

**Step 6: Commit**

```bash
git add internal/domain internal/jobsrv/repo.go
git commit -m "jobsrv: hydrate categories in JobView"
```

---

### Task 8: Expose `/api/categories`

**Files:**
- Modify: `internal/skillsrv/skillsrv.go`
- Modify: `cmd/api/main.go`

**Step 1: Add cache fields + handler**

In `Server` struct, add `categoriesAt time.Time` and `categoriesCache []Item`.

Add handler mirroring `Skills`:

```go
func (s *Server) Categories(w http.ResponseWriter, r *http.Request) {
    s.mu.RLock()
    if time.Since(s.categoriesAt) < ttl && s.categoriesCache != nil {
        out := s.categoriesCache
        s.mu.RUnlock()
        writeJSON(w, http.StatusOK, map[string]any{"categories": out})
        return
    }
    s.mu.RUnlock()
    items, err := s.fetch(r.Context(), "categories")
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    s.mu.Lock()
    s.categoriesCache = items
    s.categoriesAt = time.Now()
    s.mu.Unlock()
    writeJSON(w, http.StatusOK, map[string]any{"categories": items})
}
```

**Step 2: Register the route**

In `cmd/api/main.go`, after `r.Get("/api/cities", sk.CitiesH)`:

```go
r.Get("/api/categories", sk.Categories)
```

**Step 3: Smoke test locally**

Run:
```sh
make build && ./bin/api &
sleep 1
curl -s http://localhost:8080/api/categories | head -c 400 ; echo
kill %1
```
Expected: JSON `{"categories":[{"id":...,"canonical":"軟體/工程",...},...]}`.

**Step 4: Commit**

```bash
git add internal/skillsrv/skillsrv.go cmd/api/main.go
git commit -m "api: expose /api/categories"
```

---

## Phase 4 — Frontend

### Task 9: Type + wire support

**Files:**
- Modify: `web/src/types.ts`

**Step 1: Extend `Filters` and `JobView`**

```ts
export type Filters = {
  cities?: string[];
  categories?: string[];          // NEW
  remote_ok?: boolean;
  // ...rest unchanged
};

export type JobView = {
  // ...
  tags: string[];
  categories: string[];           // NEW
  // ...
};
```

**Step 2: Verify wire format unaffected**

The base64 JSON encoder/decoder passes through unknown fields — old payloads simply lack `categories`. No change to `web/src/lib/filtersWire.ts`.

Run: `cd web && npm run typecheck`
Expected: pass.

**Step 3: Commit**

```bash
git add web/src/types.ts
git commit -m "web/types: add categories to Filters + JobView"
```

---

### Task 10: Categories API hook

**Files:**
- Create: `web/src/api/categories.ts`

**Step 1: Add hook**

```ts
import { useQuery } from '@tanstack/react-query';

export type CategoryItem = { id: number; canonical: string; aliases: string[] };

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<CategoryItem[]> => {
      const r = await fetch('/api/categories');
      if (!r.ok) throw new Error(`categories ${r.status}`);
      const j = await r.json();
      return j.categories ?? [];
    },
    staleTime: 5 * 60_000,
  });
}
```

**Step 2: typecheck**

Run: `cd web && npm run typecheck`
Expected: pass.

**Step 3: Commit**

```bash
git add web/src/api/categories.ts
git commit -m "web/api: useCategories hook"
```

---

### Task 11: Sidebar category picker

**Files:**
- Create: `web/src/components/sidebar/CategoryPicker.tsx`
- Modify: `web/src/components/sidebar/Sidebar.tsx`

**Step 1: Implement picker**

```tsx
import { useCategories } from '../../api/categories';

export function CategoryPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { data: cats = [] } = useCategories();
  const toggle = (c: string) => {
    onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  };
  return (
    <div>
      <div className="mb-1 text-sm font-medium">職類</div>
      <div className="flex flex-wrap gap-1.5">
        {cats.map((c) => {
          const on = value.includes(c.canonical);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.canonical)}
              className={
                'rounded-full px-2.5 py-1 text-xs transition ' +
                (on
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200')
              }
            >
              {c.canonical}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Mount in `FilterBody`**

In `Sidebar.tsx`, import `CategoryPicker` and place it after `<CitiesPicker .../>`:

```tsx
<CategoryPicker
  value={profile.filters.categories || []}
  onChange={(categories) => updateActive((f) => ({ ...f, categories }))}
/>
```

**Step 3: Build + visually verify**

Run: `cd web && npm run dev` and open the app, confirm the category chips render and toggle.

**Step 4: Commit**

```bash
git add web/src/components/sidebar/CategoryPicker.tsx web/src/components/sidebar/Sidebar.tsx
git commit -m "web/sidebar: category multi-select picker"
```

---

### Task 12: Show categories on the job card and detail page

**Files:**
- Modify: `web/src/pages/Detail.tsx`
- Modify: `web/src/components/jobs/<job-card>.tsx` (find with `grep -ln "tags" web/src/components/jobs/`)

**Step 1: Surface categories above tags**

On Detail (line ~108 has the `j.tags.length > 0` block), add an analogous block immediately above:

```tsx
{j.categories.length > 0 && (
  <section>
    <h3 className="mb-1 text-sm font-medium">職類</h3>
    <div className="flex flex-wrap gap-1.5">
      {j.categories.map((c) => (
        <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{c}</span>
      ))}
    </div>
  </section>
)}
```

On the job-card component, render up to 2 category chips inline near the title (same style, smaller).

**Step 2: typecheck + lint**

Run: `cd web && npm run typecheck && npm run lint`
Expected: pass.

**Step 3: Commit**

```bash
git add web/src
git commit -m "web: render categories on detail + job card"
```

---

## Phase 5 — Roll-out

### Task 13: Run migrations and re-extract a sample on dev

**Step 1: Push branch and let CI run**

```bash
git push -u origin job-categories
gh pr create --base dev --title "Add multi-valued job categories" --body "..."
```

**Step 2: After PR merges to dev → dev auto-deploy → migrations run**

Verify on dev:
```sh
ssh api_server 'docker exec cuizhao-postgres-1 psql -U cuizhao -d cuizhao_dev -c "SELECT count(*) FROM categories WHERE approved;"'
```
Expected: `20`.

**Step 3: Re-extract a small sample to populate `job_categories`**

Easiest path: drop a handful of recent posts' `raw_extraction` so the extractor re-processes them next pass. Or seed a one-shot scrape:
```sh
ssh api_server 'cd /home/ubuntu/cuizhao-dev && sudo docker compose -f deploy/docker-compose.dev.yml --env-file .env --profile manual run --rm scraper'
```

**Step 4: Smoke**

```sh
curl -s --resolve dev.query.tw:443:91.98.207.105 https://dev.query.tw/api/categories | head -c 300
curl -s --resolve dev.query.tw:443:91.98.207.105 'https://dev.query.tw/api/jobs?filters=<base64>' | jq '.jobs[0].categories'
```
Expected: non-empty for re-extracted jobs.

**Step 5: Promote dev → master once verified**

Open PR `dev → master`, squash-merge after CI passes.

---

### Task 14: Backfill on prod (optional, low priority)

**Files:** none (operational).

**Step 1: After prod deploy migrates the schema, decide on backfill strategy**

Options:
- **Do nothing:** old jobs surface without categories; new scrapes populate going forward.
- **Targeted re-extract:** for posts with `raw_text` and `raw_extraction`, write a one-shot CLI (`cmd/extractor` `--reextract-uncategorized`) that re-feeds them to DeepSeek. Cost estimate: ~$0.001/post × current row count.

**Step 2: If chosen, scope as a follow-up plan; not required for shipping the feature.**

---

## Phase 6 — Documentation

### Task 15: Update CLAUDE.md notes

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add a one-paragraph note under "Common change shapes"**

> **Adding a new category alias** (or a new canonical category)
> Edit `migrations/000N_*_categories.up.sql` (or run a SQL UPDATE on `categories.aliases`), then `make migrate`. The extractor's prompt picks up the new dictionary on next process restart (`docker compose up -d extractor`).

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note category dictionary maintenance"
```

---

## Done criteria

- [ ] `categories` + `job_categories` tables exist on prod and dev.
- [ ] `/api/categories` returns 20 seeded canonical buckets.
- [ ] New scrapes populate `job_categories` rows for each extracted job.
- [ ] Frontend sidebar shows a category multi-select; toggling filters the list.
- [ ] `JobView.categories` round-trips through the API and renders on Detail + job card.
- [ ] `go test ./...` and `npm run typecheck && npm run lint` clean.
- [ ] Master deploy green; `https://query.tw/healthz` 200.
