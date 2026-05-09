// Threads.com search scraper for 徵才 / 找人.
// Pushes {url, author_handle, author_name, posted_at, raw_text, stitched}
// onto Redis list `extract_queue`. De-dupes via Redis set `seen_post_urls`.
//
// Strategy: Threads search is gated for unauthenticated visitors and
// only exposes ~4 results per query, but post detail pages render fully
// without login. We:
//   1. Open /search?q=<query>&filter=recent
//   2. Collect a[href*="/post/"] anchors that have a <time> ancestor —
//      these are real result cards (not random links)
//   3. For each new URL, fetch the detail page and read og:description
//      (clean post text) and og:title (author display name)
//   4. Push to Redis extract_queue
//
// Env:
//   REDIS_URL              redis connection string (required)
//   QUERIES                comma-separated list (default: "徵才,找人")
//   MAX_SCROLLS            int (default 60)
//   MAX_CONSEC_KNOWN       int (default 3)
//   MAX_WALL_MINUTES       int (default 10)
//   MIN_POSTED_AT          ISO8601 lower bound (default: now - 30d)
//   STORAGE_STATE          path to playwright storage state JSON (optional;
//                          enables logged-in scraping of the search page)

import { chromium } from 'playwright';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error('REDIS_URL is required');
  process.exit(1);
}

const QUERIES = (process.env.QUERIES || '徵才,找人').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_SCROLLS = parseInt(process.env.MAX_SCROLLS || '60', 10);
const MAX_CONSEC_KNOWN = parseInt(process.env.MAX_CONSEC_KNOWN || '3', 10);
const MAX_WALL_MS = parseInt(process.env.MAX_WALL_MINUTES || '10', 10) * 60_000;
const MIN_POSTED_AT = process.env.MIN_POSTED_AT
  ? new Date(process.env.MIN_POSTED_AT)
  : new Date(Date.now() - 30 * 86_400_000);

const redis = new Redis(REDIS_URL, { lazyConnect: true });

async function main() {
  await redis.connect();
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctxOpts = {
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  };
  if (process.env.STORAGE_STATE) ctxOpts.storageState = process.env.STORAGE_STATE;
  const ctx = await browser.newContext(ctxOpts);

  // Snapshot the set of URLs that were known BEFORE this run. The
  // stop-on-known heuristic only counts those — URLs we enqueue mid-run
  // must not abort a later query whose results overlap.
  const prevKnown = new Set(await redis.smembers('seen_post_urls'));

  let totalEnqueued = 0;
  let totalSkippedOld = 0;
  let totalKnown = 0;
  for (const q of QUERIES) {
    const stats = await scrapeOne(ctx, q, prevKnown);
    totalEnqueued += stats.enqueued;
    totalSkippedOld += stats.skippedOld;
    totalKnown += stats.known;
    console.log(JSON.stringify({ event: 'query_done', query: q, ...stats }));
  }
  await browser.close();
  await redis.quit();
  console.log(JSON.stringify({ event: 'done', enqueued: totalEnqueued, skipped_old: totalSkippedOld, known: totalKnown }));
}

async function scrapeOne(ctx, query, prevKnown) {
  const start = Date.now();
  const page = await ctx.newPage();
  const url = `https://www.threads.com/search?q=${encodeURIComponent(query)}&serp_type=default&filter=recent`;
  console.log(JSON.stringify({ event: 'navigate', url }));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);

  let consecKnown = 0;
  let scrolls = 0;
  let enqueued = 0;
  let skippedOld = 0;
  let known = 0;
  let lastAnchorCount = 0;
  let stagnantScrolls = 0;

  while (consecKnown < MAX_CONSEC_KNOWN && scrolls < MAX_SCROLLS && Date.now() - start < MAX_WALL_MS) {
    const cards = await collectCards(page);
    for (const c of cards) {
      const isNew = (await redis.sadd('seen_post_urls', c.url)) === 1;
      if (!isNew) {
        known += 1;
        if (prevKnown.has(c.url)) {
          consecKnown += 1;
          if (consecKnown >= MAX_CONSEC_KNOWN) break;
        }
        continue;
      }
      consecKnown = 0;
      const detail = await fetchDetail(ctx, c.url);
      if (!detail) continue;
      const postedAt = detail.postedAt || (c.postedAt ? new Date(c.postedAt) : new Date());
      if (postedAt < MIN_POSTED_AT) {
        skippedOld += 1;
        continue;
      }
      const item = {
        url: c.url,
        author_handle: c.authorHandle,
        author_name: detail.authorName || c.authorName || '',
        posted_at: postedAt.toISOString(),
        raw_text: detail.text,
        stitched: detail.stitched,
      };
      await redis.rpush('extract_queue', JSON.stringify(item));
      enqueued += 1;
      console.log(JSON.stringify({ event: 'enqueued', url: c.url, len: detail.text.length }));
    }
    if (consecKnown >= MAX_CONSEC_KNOWN) break;

    if (cards.length === lastAnchorCount) {
      stagnantScrolls += 1;
      if (stagnantScrolls >= 3) break; // search exhausted (Threads gate or no more)
    } else {
      stagnantScrolls = 0;
    }
    lastAnchorCount = cards.length;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
    await page.waitForTimeout(900);
    scrolls += 1;
  }
  await page.close();
  return { enqueued, skippedOld, known, scrolls };
}

async function collectCards(page) {
  return await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    // Real result cards always pair a /post/ anchor with a <time> ancestor.
    const anchors = document.querySelectorAll('a[href*="/post/"]');
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(?:@([^/]+))\/post\/([A-Za-z0-9_-]+)/);
      if (!m) continue;
      const handle = m[1];
      const code = m[2];
      const u = `https://www.threads.com/@${handle}/post/${code}`;
      if (seen.has(u)) continue;
      let timeEl = a.querySelector('time');
      if (!timeEl) {
        // Walk up looking for a sibling <time>.
        let cur = a;
        for (let i = 0; i < 6 && cur; i++) {
          timeEl = cur.querySelector('time');
          if (timeEl) break;
          cur = cur.parentElement;
        }
      }
      if (!timeEl) continue;
      seen.add(u);
      out.push({
        url: u,
        authorHandle: '@' + handle,
        authorName: '',
        postedAt: timeEl.getAttribute('datetime') || null,
      });
    }
    return out;
  });
}

async function fetchDetail(ctx, url) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(800);
    const data = await page.evaluate(() => {
      const meta = (p) => document.querySelector(`meta[property="${p}"]`)?.getAttribute('content') || '';
      const ogDesc = meta('og:description');
      const ogTitle = meta('og:title');
      const time = document.querySelector('time')?.getAttribute('datetime') || null;
      // Author display name: og:title looks like "Threads 上的 NAME（@handle）"
      const nameMatch = ogTitle.match(/Threads 上的\s*(.+?)\s*[（(]@/);
      return {
        ogDesc,
        authorName: nameMatch ? nameMatch[1] : '',
        time,
      };
    });
    if (!data.ogDesc || data.ogDesc.length < 10) return null;
    return {
      text: data.ogDesc,
      authorName: data.authorName,
      postedAt: data.time ? new Date(data.time) : null,
      stitched: false,
    };
  } catch (e) {
    console.log(JSON.stringify({ event: 'detail_failed', url, err: String(e) }));
    return null;
  } finally {
    await page.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
