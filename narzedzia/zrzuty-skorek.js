/* Zrzuty ekranu Dziś (i kilku innych ekranów) we wszystkich skórkach, na zmyślonych danych.
   Uruchom: NODE_PATH=<katalog z playwright> node narzedzia/zrzuty-skorek.js <katalog-na-zrzuty> [szerokość] */
process.env.TZ = 'Europe/Warsaw';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { utworzSrodowisko, fikcyjneDane } = require('../testy/symulacja.js');
const L = require('../logika.js');
const ROOT = path.join(__dirname, '..'), OUT = process.argv[2] || '.', W = +(process.argv[3] || 390);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const dzis = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const skin of ['klasyczny', 'neon', 'synthwave', 'racer', 'jasny']) {
    const env = utworzSrodowisko({ daneStartowe: fikcyjneDane(dzis) });
    env.api.utworzArkusz();
    const key = env.api.utworzKlucz();
    const reg = JSON.parse(env.api.doPost({ postData: { contents: JSON.stringify({ key, fn: 'register', arg: { name: 'Telefon' } }) } }).getContent());
    // jeden wpis dziś, żeby było widać stan „wzięte”
    env.api.doPost({ postData: { contents: JSON.stringify({ token: reg.token, fn: 'logDose', arg: { clientId: 'zrzut000001', items: [{ data: dzis, pora: 'rano', pozycja: 'P1', status: 'wzięte', godz: '07:20' }] } }) } });
    const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 2, isMobile: W < 600, hasTouch: W < 600, locale: 'pl-PL', timezoneId: 'Europe/Warsaw', serviceWorkers: 'block' });
    await ctx.addInitScript(([conn, s]) => { localStorage.setItem('zdrowie.conn', conn); localStorage.setItem('zdrowie.skin', s); localStorage.setItem('zdrowie.tab', 'dzis'); },
      [JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', token: reg.token, id: reg.id }), skin]);
    await ctx.route('https://script.google.com/**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: env.api.doPost({ postData: { contents: route.request().postData() } }).getContent() });
    });
    const page = await ctx.newPage();
    await page.goto(base); await page.waitForSelector('.hero-d'); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${W}-${skin}-dzis.png`) });
    await page.screenshot({ path: path.join(OUT, `${W}-${skin}-dzis-caly.png`), fullPage: true });
    for (const t of ['historia', 'terapie', 'ustawienia']) {
      await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${W}-${skin}-${t}.png`) });
    }
    await page.click('#tabbar [data-tab="dzis"]'); await page.click('.panel.pora:not(.done) .item:not(.st-wziete) .it-more >> nth=0'); await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, `${W}-${skin}-okno.png`) });
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log('zrzuty gotowe');
})().catch(e => { console.error(e); process.exit(1); });
