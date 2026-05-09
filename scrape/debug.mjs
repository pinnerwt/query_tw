import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  locale: 'zh-TW',
  timezoneId: 'Asia/Taipei',
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();
await page.goto('https://www.threads.com/@goose.3953452/post/DYHa0MJiDyL', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
const data = await page.evaluate(() => {
  const main = document.querySelector('main') || document.body;
  return {
    title: document.title,
    bodyLen: document.body.innerText?.length ?? 0,
    sample: document.body.innerText?.slice(0, 1500),
    timeIso: document.querySelector('time')?.getAttribute('datetime'),
    metaDesc: document.querySelector('meta[property="og:description"]')?.content,
    metaTitle: document.querySelector('meta[property="og:title"]')?.content,
  };
});
console.log(JSON.stringify(data, null, 2));
await browser.close();
