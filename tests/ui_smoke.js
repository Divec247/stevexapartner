// Drives the real web page in Chromium; the "server" is the real backend code running in Node (same one the unit tests use).
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), make = require('./harness');
const docs = path.join(__dirname, '..', 'docs'), shots = process.argv[2] || null;
const w = make({ today: '2026-11-10' });
w.props.OWNER_NAME = 'Stephen Adeyoye'; w.props.OWNER_EMAIL = 'owner@example.com'; w.props.OWNER_PASSWORD = 'Owner-Pass-2026'; w.api.setupOwner();
const server = http.createServer(function (q, r) {
  const f = path.join(docs, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  const t = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)];
  r.writeHead(200, { 'Content-Type': t }); r.end(fs.readFileSync(f));
});
(async function () {
  await new Promise(function (ok) { server.listen(0, ok); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(), errors = [];
  async function session(email, password, run) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } }), page = await ctx.newPage();
    page.on('pageerror', function (e) { errors.push(email + ': ' + e.message); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push(email + ' console: ' + m.text()); });
    await page.route('**/config.js', function (r) { r.fulfill({ contentType: 'text/javascript', body: 'window.STEVEXA_API="https://api.test/exec";' }); });
    await page.route('https://api.test/exec', function (r) {
      let out; try { const d = JSON.parse(r.request().postData()); out = w.api.handle_(d); } catch (e) { out = { ok: false, error: e.apiMessage || String(e) }; }
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
    });
    await page.goto(base);
    await page.fill('input[type=email]', email); await page.fill('input[type=password]', password); await page.click('button[type=submit]');
    await run(page); await ctx.close();
  }
  const shot = function (page, n) { return shots ? page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }) : null; };
  // owner creates a partner and a BD through the real page
  await session('owner@example.com', 'Owner-Pass-2026', async function (page) {
    await page.waitForSelector('nav'); await page.click('nav button:has-text("People")'); await page.waitForSelector('h2:has-text("Register a business developer")');
    await page.selectOption('select >> nth=0', 'partner');
    await page.fill('form input >> nth=0', 'Mr. Peter'); await page.fill('input[type=email] >> nth=0', 'peter@example.com'); await page.fill('input[type=number] >> nth=1', '100');
    await page.click('button:has-text("Create account")'); await page.waitForSelector('.pw');
    w.peterPw = await page.textContent('.pw');
    await page.selectOption('select >> nth=0', 'bd');
    await page.fill('form input >> nth=0', 'Ade BD'); await page.fill('input[type=email] >> nth=0', 'bd@example.com');
    await page.click('button:has-text("Create account")'); await page.waitForFunction(function (old) { var e = document.querySelector('.pw'); return e && e.textContent !== old; }, w.peterPw);
    w.bdPw = await page.textContent('.pw');
    await shot(page, 'owner_people');
  });
  await session('bd@example.com', w.bdPw, async function (page) {
    await page.waitForSelector('text=Choose your own password');
    const inputs = await page.$$('input[type=password]');
    await inputs[1].fill('Brand-New-2026'); await inputs[2].fill('Brand-New-2026'); await inputs[0].fill(w.bdPw);
    await page.click('button:has-text("Change password")'); await page.waitForSelector('nav');
    await page.click('nav button:has-text("Register a school")');
    await page.fill('form input >> nth=0', 'Alpha Light College'); await page.selectOption('form select', 'Lagos');
    const f = await page.$$('form input'); await f[2].fill('Mrs A'); await f[3].fill('08031234567');
    await page.click('button:has-text("Register school")'); await page.waitForSelector('text=Alpha Light College');
    await shot(page, 'bd_schools');
    if ((await page.$$('nav button:has-text("People")')).length) throw new Error('BD can see the People tab');
  });
  await session('owner@example.com', 'Owner-Pass-2026', async function (page) {
    await page.click('nav button:has-text("Schools")'); await page.waitForSelector('select');
    await page.selectOption('form >> nth=0 >> select', { index: 1 });
    await page.fill('input[inputmode=decimal]', '20000000');
    const d = await page.$$('form >> nth=0 >> input[type=date]'); await d[1].fill('2026-11-10'); await d[2].fill('2027-02-28');
    await page.click('button:has-text("Record payment")'); await page.waitForSelector('.msg'); const mm = await page.textContent('.msg'); if (mm.indexOf('Payment recorded') < 0) throw new Error('payment form: ' + mm);
    await page.click('nav button:has-text("Overview")'); await page.waitForSelector('text=Who gets what');
    await shot(page, 'owner_overview');
  });
  await session('peter@example.com', w.peterPw, async function (page) {
    await page.waitForSelector('text=Choose your own password');
    const inputs = await page.$$('input[type=password]');
    await inputs[0].fill(w.peterPw); await inputs[1].fill('Peter-New-2026'); await inputs[2].fill('Peter-New-2026');
    await page.click('button:has-text("Change password")'); await page.waitForSelector('text=How the revenue is shared');
    const t = await page.textContent('main');
    if (t.indexOf('₦10,000,000.00') < 0 || t.indexOf('₦6,000,000.00') < 0 && t.indexOf('₦8,000,000.00') < 0) throw new Error('split numbers missing: ' + t.slice(0, 400));
    if (t.indexOf('08031234567') >= 0) throw new Error('partner can see school contact');
    await shot(page, 'partner_share');
  });
  await browser.close(); server.close();
  if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('UI smoke test passed: owner, business developer and partner flows work in a real browser.');
})().catch(function (e) { console.log('UI TEST FAILED: ' + e.message); process.exit(1); });
