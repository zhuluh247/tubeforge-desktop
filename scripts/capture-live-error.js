// Capture the exact client-side exception on the live TubeForge deployment
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('console', m => {
    const t = m.text();
    if (t.length > 0) console.log('[console:' + m.type() + ']', t.slice(0, 1200));
  });
  page.on('pageerror', e => {
    console.log('\n=== PAGEERROR ===');
    console.log(String(e.message).slice(0, 2000));
    if (e.stack) console.log('--- stack ---\n' + String(e.stack).slice(0, 4000));
  });
  page.on('requestfailed', r =>
    console.log('[reqfail]', r.url().slice(0, 120), r.failure() && r.failure().errorText));

  await page.goto('https://tubeforge-j5qn.onrender.com', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(6000);

  // Grab the rendered text to confirm error state
  const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log('\n=== BODY TEXT ===\n' + body);

  await browser.close();
})().catch(e => { console.error('script failed:', e); process.exit(1); });
