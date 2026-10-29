// Verify the fixed TubeForge production build renders without client errors
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  let errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 300)); });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  const body = await page.evaluate(() => document.body.innerText.slice(0, 600));
  console.log('=== PAGE ERRORS ===');
  console.log(errors.length ? errors.join('\n') : 'NONE ✓');
  console.log('\n=== BODY ===\n' + body);

  // check key dashboard elements are present
  const checks = await page.evaluate(() => ({
    header: !!document.body.innerText.includes('TubeForge'),
    createPanel: !!document.body.innerText.includes('Create a video'),
    voiceAuto: !!document.body.innerText.includes('Auto — best voice per format'),
    pipeline: !!document.body.innerText.includes('How every video gets made'),
    settingsBtn: !!document.body.innerText.includes('Settings'),
  }));
  console.log('\n=== ELEMENT CHECKS ===');
  console.log(JSON.stringify(checks, null, 2));

  // open the voice dropdown to force Radix Select to mount items — the crash path
  await page.click('[data-slot="select-trigger"]:near(:text("Voice"))').catch(async () => {
    // fallback: click the second select trigger in the create panel
    const triggers = await page.$$('button[role="combobox"]');
    if (triggers[1]) await triggers[1].click();
  });
  await page.waitForTimeout(1200);
  const dropdownOk = await page.evaluate(() => document.body.innerText.includes('Jam — British narrator'));
  console.log('\n=== VOICE DROPDOWN OPENED ===');
  console.log(dropdownOk ? 'Items visible — Radix Select OK ✓' : 'Dropdown items not visible!');
  console.log('Errors after dropdown open:', errors.length ? errors.join(' | ') : 'NONE ✓');

  await page.screenshot({ path: '/tmp/verify-fixed.png', fullPage: false });
  await browser.close();
})().catch(e => { console.error('script failed:', e); process.exit(1); });
