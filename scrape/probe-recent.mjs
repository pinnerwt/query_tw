// One-off probe: hit Threads /search?...&filter=recent and report
// (1) which tab is highlighted, (2) the order of post anchors, and
// (3) each anchor's datetime ancestor — so we can see whether the
// 最近 tab is actually selected and whether results come back in
// chronological (newest-first) order.
import { chromium } from 'playwright';

const QUERY = process.argv[2] || '徵才';
const URL = `https://www.threads.com/search?q=${encodeURIComponent(QUERY)}&serp_type=default&filter=recent`;

const browser = await chromium.launch({ headless: true });
const ctxOpts = {
  locale: 'zh-TW',
  timezoneId: 'Asia/Taipei',
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
};
if (process.env.STORAGE_STATE) {
  ctxOpts.storageState = process.env.STORAGE_STATE;
  console.log('using storageState:', process.env.STORAGE_STATE);
}
const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();
console.log('GET', URL);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForTimeout(1500);

// Scroll a bit to see how many cards we can pull from the recent feed.
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
  await page.waitForTimeout(900);
}

const out = await page.evaluate(() => {
  // Find the tab strip — Threads renders top-level filter pills
  // ("熱門" / "最近"). Grab their text + which one looks active.
  const tabs = [];
  for (const el of document.querySelectorAll('a, span, div[role="tab"], button')) {
    const t = (el.textContent || '').trim();
    if (t === '最近' || t === 'Recent' || t === '熱門' || t === 'Top') {
      const ariaSel = el.getAttribute('aria-selected');
      const cs = getComputedStyle(el);
      tabs.push({
        text: t,
        href: el.getAttribute('href') || null,
        ariaSelected: ariaSel,
        weight: cs.fontWeight,
        color: cs.color,
      });
    }
  }
  // Page heading / context if any
  const h1 = (document.querySelector('h1, h2')?.textContent || '').trim();

  // Post anchors in DOM order, with their <time> ancestor
  const seen = new Set();
  const posts = [];
  for (const a of document.querySelectorAll('a[href*="/post/"]')) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/(?:@([^/]+))\/post\/([A-Za-z0-9_-]+)/);
    if (!m) continue;
    const u = `https://www.threads.com/@${m[1]}/post/${m[2]}`;
    if (seen.has(u)) continue;
    let timeEl = a.querySelector('time');
    if (!timeEl) {
      let cur = a;
      for (let i = 0; i < 6 && cur; i++) {
        timeEl = cur.querySelector('time');
        if (timeEl) break;
        cur = cur.parentElement;
      }
    }
    if (!timeEl) continue;
    seen.add(u);
    posts.push({
      url: u,
      datetime: timeEl.getAttribute('datetime'),
      label: (timeEl.textContent || '').trim(),
    });
  }
  return { tabs, h1, posts };
});

console.log('\n=== tab strip (最近/熱門 detection) ===');
console.log(JSON.stringify(out.tabs, null, 2));
console.log('\nheading:', out.h1);
console.log('\n=== posts in DOM order (top → bottom) ===');
for (const p of out.posts) {
  console.log(p.datetime, '·', p.label, '·', p.url);
}

await browser.close();
