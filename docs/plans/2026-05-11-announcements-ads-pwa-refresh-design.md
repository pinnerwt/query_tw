# Announcements, ad slots, and PWA refresh — design

Date: 2026-05-11
Status: approved

## Goal

Three additions to 脆找工作:

1. **Announcements** — site-authored notices (fraud warnings, site updates) authored from `/admin`, rendered as cards pinned at the top of the Browse feed.
2. **Ad slots** — Google AdSense cards interleaved in the Browse feed every N job cards, gated on env-var configuration so the slot is invisible until credentials are wired.
3. **PWA refresh UX** — replace silent `autoUpdate` with a "new version available" toast and a manual "check for updates" button in Settings.

All three card types (job, announcement, ad) share the same outer frame (width + height + base padding/border) but have their own internal content layout.

## Non-goals

- No multi-author / role-based admin (existing basic-auth admin is reused).
- No scheduled publish windows; admin deletes a notice when it's no longer relevant.
- No A/B testing or impression tracking on ads.

## Data model

New table:

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

`body` is markdown; rendered safely on the frontend (react-markdown + restricted allowlist, no raw HTML).

Ordering rule: **critical first**, then newest-first within each severity bucket.

## API

Public:

- `GET /api/announcements` → `[{id, severity, body, created_at}]` ordered by the rule above.

Admin (existing basic-auth on `/admin/api/*`):

- `GET    /admin/api/announcements`
- `POST   /admin/api/announcements` body `{severity, body}` → returns created row
- `DELETE /admin/api/announcements/:id`

Validation: `severity ∈ {info,warning,critical}`, `body` non-empty, length ≤ 4 KB.

Caching: announcements piggyback on the existing PWA SW cache only if we add a matcher; for now, leave them off the SW config so fraud notices appear instantly on next request.

## Frontend

### Shared card frame

`web/src/components/CardShell.tsx` extracts the outer box that today lives in `JobCard.tsx:18-22`:

```tsx
<article className="rounded-lg border ... bg-white p-3 shadow-sm ... min-h-[<X>]">
  {children}
</article>
```

Concrete `min-h-*` chosen after measuring an average JobCard so announcements/ads don't visually shrink the feed. `JobCard` is refactored to wrap its existing content in `<CardShell>`.

### AnnouncementCard

- Severity icon + left-border accent: info=slate, warning=amber, critical=rose.
- Body rendered with `react-markdown`, links open in new tab with `rel="noopener noreferrer"`.
- Top-right `×` dismiss button — writes `id` into a localStorage set (`dismissed_announcements`). Dismissed ids filtered out in Browse.
- Critical announcements still show but the dismiss state is respected (user is in control).

### AdCard

- Renders an AdSense `<ins class="adsbygoogle" data-ad-client=... data-ad-slot=... data-ad-format="auto" data-full-width-responsive="true">` only when **both** `VITE_ADSENSE_CLIENT` and `VITE_ADSENSE_SLOT` are non-empty. Otherwise returns `null` and the slot is not injected.
- The AdSense script tag is loaded once per session via an effect in `main.tsx` (gated on env), so the card itself just pushes the impression: `(window.adsbygoogle = window.adsbygoogle || []).push({})`.
- Same `CardShell` frame so the column doesn't reflow.

### Browse integration

- Fetch announcements alongside jobs.
- Filter announcements by the localStorage dismissed set.
- Render order on the Browse page:
  1. All visible announcements (already sorted by API).
  2. Job grid, with an `AdCard` injected after every `N` job cards (default `N=8`, override via `VITE_AD_EVERY`).
- Ads only injected when AdSense env vars are set; otherwise the feed is jobs-only.

### Admin page additions

In `web/src/pages/Admin.tsx`, add a new "公告" section:

- Form: severity select + markdown textarea + live preview pane (rendered with the same react-markdown config as the public card) + 發布 button.
- List below the form: each existing announcement rendered as the same AnnouncementCard preview + 刪除 button.

### PWA refresh prompt

- `web/vite.config.ts`: `registerType: 'autoUpdate'` → `'prompt'`.
- New `web/src/components/RefreshPrompt.tsx`:
  - Uses `useRegisterSW` from `virtual:pwa-register/react`.
  - When `needRefresh` is true, renders a bottom-center toast: `有新版本可用 [立即更新] [稍後]`.
  - 立即更新 → `updateServiceWorker(true)` (calls `skipWaiting` + reloads).
- Mounted once in `App.tsx`.
- Settings page gains a `檢查更新` button: calls `registration.update()`; if a waiting worker exists afterward, calls `updateServiceWorker(true)`, otherwise shows a transient "已是最新版本" message.

## Files touched

Backend:

- `migrations/000N_announcements.up.sql` / `.down.sql`
- new `internal/announcements/` package (handlers, repo) — or extend `internal/jobsrv/`; choice deferred to plan
- route wiring in the existing HTTP mux

Frontend:

- new: `web/src/components/CardShell.tsx`, `components/AnnouncementCard.tsx`, `components/AdCard.tsx`, `components/RefreshPrompt.tsx`
- modified: `web/src/components/jobs/JobCard.tsx`, `pages/Admin.tsx`, `pages/Browse.tsx`, `pages/Settings.tsx`, `App.tsx`, `vite.config.ts`, `types.ts`, `api/` (new client functions)
- `web/package.json`: add `react-markdown` (and a sanitizer if `react-markdown` v9 default isn't strict enough)

Ops:

- New optional env vars: `VITE_ADSENSE_CLIENT`, `VITE_ADSENSE_SLOT`, `VITE_AD_EVERY`. Documented in `CLAUDE.md` env-var section.

## Testing

Backend:

- Go handler tests for list/create/delete (validation, severity allowlist, ordering: critical-first then newest).

Frontend:

- Component test for AnnouncementCard rendering severity styles + dismiss flow.
- Component test for Browse feed interleaving with N=8 and N=0/missing env (no ad cards).
- Smoke test for the refresh toast: simulate `needRefresh=true`, click 立即更新, assert `updateServiceWorker(true)` called.

Manual:

- Author a critical announcement in admin, confirm it pins above an existing info one.
- Verify AdCard renders nothing when env vars are absent.
- After a fresh `deploy-monitor.sh`, the toast appears on the next page load while the old tab is still open.

## Risks / open items

- `react-markdown`'s default config in v9 strips raw HTML, which is the safe path. Confirm in implementation.
- The `min-h-*` value needs to be picked empirically from current JobCard heights.
- AdSense approval is out-of-band; until approved, the slot stays dark — that's intentional.
