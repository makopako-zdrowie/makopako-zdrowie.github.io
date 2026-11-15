/* Test całości w prawdziwej przeglądarce: strona z tego repo + prawdziwy Code.gs na symulowanym arkuszu (fikcyjne dane).
   Zapytania do script.google.com przechwytujemy i podajemy do doPost. Szerokości: 360, 390, 412 i 1440 px.
   Uruchom: NODE_PATH=<katalog z playwright> node testy/przegladarka.js [katalog-na-zrzuty] */
process.env.TZ = 'Europe/Warsaw';
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert');
const { chromium } = require('playwright');
const { utworzSrodowisko, fikcyjneDane } = require('./symulacja.js');
const L = require('../logika.js');

const ROOT = path.join(__dirname, '..'), OUT = process.argv[2] || '';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const URL_SKRYPTU = 'https://script.google.com/macros/s/TEST-test_123/exec';
const dzis = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const bledy = [];
  let kroki = 0;
  const ok = (w, opis) => { assert.ok(w, opis); kroki++; };

  async function sesja(width, height, mobile) {
    const env = utworzSrodowisko({ daneStartowe: fikcyjneDane(dzis) });
    env.api.utworzArkusz();
    const klucz = env.api.utworzKlucz();
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, locale: 'pl-PL', timezoneId: 'Europe/Warsaw', serviceWorkers: 'block' });
    let siec = true;
    await ctx.route('https://script.google.com/**', async route => {
      if (!siec) return route.abort('internetdisconnected');
      const out = env.api.doPost({ postData: { contents: route.request().postData() } }).getContent();
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out });
    });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED/.test(m.text())) bledy.push(width + ': ' + m.text()); });   // brak sieci w teście offline jest celowy
    page.on('pageerror', e => bledy.push(width + ': ' + e.message));
    const zrzut = async nazwa => { if (OUT) { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, width + '-' + nazwa + '.png'), fullPage: true }); } };
    /** Nic nie wystaje w bok, a przyciski mają co najmniej 44 px. */
    const uklad = async gdzie => {
      const r = await page.evaluate(() => {
        const za = [];
        document.querySelectorAll('button, a.btn-sm, a.ib, summary').forEach(b => {
          const q = b.getBoundingClientRect(), s = getComputedStyle(b);
          if (!q.width || s.visibility === 'hidden' || b.closest('[hidden]')) return;
          const after = parseFloat(getComputedStyle(b, '::after').height) || 0;        // powiększony obszar dotyku linków
          if (Math.max(q.height, after) < 43.5 || q.width < 43.5 && Math.max(q.width, parseFloat(getComputedStyle(b, '::after').width) || 0) < 43.5) za.push((b.textContent.trim() || b.getAttribute('aria-label') || b.className).slice(0, 30) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height));
        });
        return { szer: document.scrollingElement.scrollWidth, okno: innerWidth, za };
      });
      ok(r.szer <= r.okno, `${width}px ${gdzie}: strona wystaje w bok (${r.szer} > ${r.okno})`);
      if (mobile) ok(r.za.length === 0, `${width}px ${gdzie}: za małe cele dotykowe: ${r.za.join(' | ')}`);
    };
    return { env, ctx, page, klucz, zrzut, uklad, siec: v => { siec = v; }, wiersze: () => env.wiersze('Dziennik') };
  }
  async function polacz(s) {
    await s.page.goto(base);
    await s.page.click('[data-mode="key"]');
    await s.page.fill('#suUrl', URL_SKRYPTU); await s.page.fill('#suKey', s.klucz); await s.page.fill('#suName', 'Telefon testowy');
    await s.page.click('#suGo');
    await s.page.waitForSelector('.lead');
  }

  /* ---------- pełny przebieg na telefonie 390 px ---------- */
  {
    const s = await sesja(390, 844, true), page = s.page;
    await page.goto(base);
    await page.waitForSelector('.setup');
    await s.zrzut('01-laczenie'); await s.uklad('łączenie');
    await polacz(s);
    ok((await page.textContent('.lead')).includes('zostało 5 z 5'), 'zdanie na górze: ' + await page.textContent('.lead'));
    ok((await page.textContent('#abSub')).includes(L.dataPl(dzis)), 'podtytuł z dzisiejszą datą');
    ok(await page.isVisible('.late'), 'karta „Wziąłeś?” jest');
    await s.zrzut('02-dzis'); await s.uklad('Dziś');

    // jedno dotknięcie = wzięte, wiersz w arkuszu, toast z „Cofnij”
    const przed = s.wiersze().length;
    await page.click('.pora .item:first-child .it-main');
    await page.waitForFunction(() => document.querySelector('.pora .item:first-child').classList.contains('st-wziete'));
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')));
    ok(s.wiersze().length === przed + 1, 'wpis w Dzienniku');
    const w = s.wiersze().slice(-1)[0];
    ok(w['Status'] === 'wzięte' && w['Data'] === dzis && w['Pora'] === 'rano' && w['Pozycja'] === 'P1' && w['Ilość'] === 1 && /^\d\d:\d\d$/.test(w['Godzina']) && w['Urządzenie'] === 'Telefon testowy', 'treść wpisu: ' + JSON.stringify(w));
    ok((await page.textContent('.lead')).includes('zostało 4 z 5'), 'licznik po odhaczeniu');
    await page.click('[data-toast-undo]');
    await page.waitForFunction(() => !document.querySelector('.pora .item:first-child').classList.contains('st-wziete'));
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')));
    ok(s.wiersze().slice(-1)[0]['Stan'] === 'cofnięty', 'cofnięcie w arkuszu');

    // cała pora naraz
    await page.click('[data-all="rano"]');
    await page.waitForSelector('details.pora.done');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')));
    ok(s.wiersze().filter(x => x['Data'] === dzis && x['Stan'] === '' && x['Status'] === 'wzięte' && x['Pora'] === 'rano').length === 2, 'cała pora: 2 wpisy');
    ok((await page.textContent('.lead')).includes('zostało 3 z 5'), 'licznik po całej porze');

    // okno pozycji: inna ilość i notatka
    await page.click('.pora:not(.done) .item:nth-child(2) .it-more');
    await page.waitForSelector('#sheet.open');
    await s.zrzut('03-okno-podania'); await s.uklad('okno podania');
    await page.click('[data-q="1"]'); await page.fill('#shNote', 'podwójna porcja');
    await page.click('[data-sh-take]');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')) && !document.querySelector('#sheet.open'));
    const w2 = s.wiersze().slice(-1)[0];
    ok(w2['Pozycja'] === 'P4' && w2['Ilość'] === 1 && w2['Notatka'] === 'podwójna porcja', 'ilość z okna (½ + ½): ' + JSON.stringify(w2));

    // pominięcie z powodem
    await page.click('.pora:not(.done) .item:first-child .it-more');
    await page.waitForSelector('#sheet.open');
    await page.click('[data-sh-skip="brak leku"]');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')) && !document.querySelector('#sheet.open'));
    ok(s.wiersze().slice(-1)[0]['Status'] === 'pominięte' && s.wiersze().slice(-1)[0]['Powód'] === 'brak leku', 'pominięcie z powodem');
    // odhaczone → okno ze szczegółami, cofnięcie drugim dotknięciem
    await page.waitForTimeout(800);
    await page.click('details.pora.done[data-key="pora-wieczór"] summary');
    await page.click('details.pora.done[data-key="pora-wieczór"] .item.st-pominiete .it-main');
    await page.waitForSelector('#sheet.open [data-sh-undo]');
    await page.click('[data-sh-undo]');
    ok((await page.textContent('[data-sh-undo]')).includes('Na pewno'), 'cofnięcie wymaga drugiego dotknięcia');
    await page.click('[data-sh-undo]');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')) && !document.querySelector('#sheet.open'));
    ok(s.wiersze().filter(x => x['Status'] === 'pominięte')[0]['Stan'] === 'cofnięty', 'pominięcie cofnięte');

    // „Wziąłeś?”: Tak, Nie pamiętam, Nie → powód, wszystko naraz
    const grup = await page.locator('.late-g').count();
    ok(grup === 4, 'grupy bez odpowiedzi: ' + grup);
    await page.locator('.late-g').first().locator('[data-late^="tak|"]').first().click();
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')));
    let z = s.wiersze().slice(-1)[0];
    ok(z['Data'] === L.plus(dzis, -1) && z['Później'] === 'TAK' && z['Godzina'] === '' && z['Status'] === 'wzięte', 'odpowiedź „Tak” za wczoraj: ' + JSON.stringify(z));
    await page.locator('.late-g').first().locator('[data-late^="nw|"]').first().click();
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')));
    ok(s.wiersze().slice(-1)[0]['Status'] === 'nie pamiętam', '„Nie pamiętam” zapisane');
    ok(await page.isVisible('.late details.more summary') && !(await page.locator('.late details.more .late-g').first().isVisible()), 'wcześniejsze dni zwinięte');
    await page.locator('.late-g').first().locator('[data-late^="nie|"]').first().click();
    await page.waitForSelector('#sheet.open');
    ok(!(await page.isVisible('[data-sh-take]')), 'okno „Nie” pyta tylko o powód');
    await page.click('[data-sh-skip="zapomniałem"]');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')) && !document.querySelector('#sheet.open'));
    ok(s.wiersze().slice(-1)[0]['Powód'] === 'zapomniałem', '„Nie” z powodem');
    await page.waitForFunction(() => !document.querySelector('.late details.more'));          // nie ma już „wczoraj”: starsze na wierzchu
    await page.click('[data-late-all]');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')));
    await page.click('.late-g [data-late^="tak|"]');
    await page.waitForFunction(() => !document.querySelector('.late') && (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')));
    ok(true, 'karta „Wziąłeś?” znika po odpowiedziach');

    // tydzień
    await page.click('[data-week="P5"]');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')));
    ok((await page.textContent('.week')).includes('1 z 1 w tym tygodniu'), 'pozycja tygodniowa zrobiona');
    // doraźne
    await page.click('[data-adhoc="P1"]');
    await page.waitForSelector('#sheet.open [data-sh-adhoc]');
    await s.zrzut('04-okno-dorazne');
    await page.fill('#shNote', 'po schodach'); await page.fill('#shTime', '06:15');
    await page.click('[data-sh-adhoc]');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zdrowie.outbox') || '[]').length === 0 && !document.body.classList.contains('syncing')) && !document.querySelector('#sheet.open'));
    z = s.wiersze().slice(-1)[0];
    ok(z['Status'] === 'doraźnie' && z['Godzina'] === '06:15' && z['Pora'] === '' && z['Notatka'] === 'po schodach', 'użycie doraźne: ' + JSON.stringify(z));
    ok((await page.textContent('.adhoc')).includes('dziś 1×'), 'licznik doraźnych');

    // bez internetu: odhaczenie widać od razu, wysyła się po powrocie sieci, bez duplikatów
    await page.waitForTimeout(800);
    await page.click('details.pora.done[data-key="pora-wieczór"] .item:first-child .it-main').catch(() => {});
    if (await page.isVisible('#sheet.open')) await page.click('#sheetClose');
    s.siec(false); await s.ctx.setOffline(true);
    const n0 = s.wiersze().length;
    await page.waitForTimeout(400);
    await page.click('.item.st-do .it-main');
    await page.waitForSelector('.item.pending');
    ok(s.wiersze().length === n0, 'offline: nic nie poszło do arkusza');
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('zdrowie.outbox')).length) === 1, 'offline: wpis czeka w kolejce');
    await s.zrzut('05-offline');
    await s.ctx.setOffline(false);                                         // strona się wczyta, ale skrypt nadal nieosiągalny
    await page.reload(); await page.waitForSelector('.item.pending', { state: 'attached' });
    ok(true, 'offline: po ponownym otwarciu wpis nadal widoczny');
    s.siec(true); await s.ctx.setOffline(false);
    await page.evaluate(() => Rdzen.outbox.flush());
    await page.waitForFunction(() => !document.querySelector('.item.pending') && JSON.parse(localStorage.getItem('zdrowie.outbox')).length === 0);
    ok(s.wiersze().length === n0 + 1, 'po powrocie sieci: jeden wpis');
    await page.waitForFunction(() => document.getElementById('sync').hidden);
    ok(true, 'po wysłaniu kolejki komunikat o braku sieci znika');
    await page.waitForSelector('.lead strong');
    ok((await page.textContent('.lead')).includes('wszystko odhaczone'), 'wszystko odhaczone: ' + await page.textContent('.lead'));
    await s.zrzut('06-dzis-gotowe');

    // planowane: „Zaczynam od dziś” (dwa dotknięcia)
    await page.click('details.planned summary');
    ok(!(await page.isVisible('[data-start="P7"]')), 'pozycja bez harmonogramu nie ma przycisku');
    await page.click('[data-start="P6"]'); await page.click('[data-start="P6"]');
    await page.waitForFunction(() => /zostało 1 z/.test(document.querySelector('.lead').textContent));
    ok(s.env.wiersze('Pozycje')[5]['Status'] === 'aktywna', 'pozycja wystartowała');

    // Terapie
    await page.click('#tabbar [data-tab="terapie"]');
    await page.waitForSelector('.th-head');
    const tt = await page.textContent('#app');
    ok(tt.includes('Kardiologia') && tt.includes('dr Przykładowa') && tt.includes('Zakończone (1)'), 'terapie na ekranie');
    ok(/Zostało \d+ z 60 wdechów · wystarczy do \d+ \S+ · ważne do/.test(tt), 'zapas ze znaną ilością: ' + (tt.match(/Zostało[^S]*/) || [''])[0]);
    ok(tt.includes('Otwarte 5 dni temu, ilość nieznana'), 'zapas z nieznaną ilością');
    ok(/Zostało 8 z 10 ampułek/.test(tt), 'zapas ułamkowy (½ + 1 + ½ zużyte): ' + (tt.match(/Zostało \d+,?\d* z 10[^·]*/) || [''])[0]);
    await s.zrzut('07-terapie'); await s.uklad('Terapie');
    // „Skończyło się” z nowym opakowaniem
    await page.click('.stock [data-finish="O2"]');
    await page.waitForSelector('#sheet.open [data-sh-finish]');
    await s.zrzut('08-okno-opakowania'); await s.uklad('okno opakowania');
    await page.fill('#shPack', '300');
    await page.click('[data-sh-finish="nowe"]');
    await page.waitForFunction(() => !document.querySelector('#sheet.open'));
    const op = s.env.wiersze('Opakowania');
    ok(op[1]['Skończone'] === dzis && op[3]['Pozycja'] === 'P3' && op[3]['Ilość w opakowaniu'] === 300, 'nowe opakowanie w arkuszu');
    ok((await page.textContent('#app')).includes('z 300 kropli'), 'nowe opakowanie na ekranie');

    // Ustawienia: przypomnienia, urządzenia, kod parowania przeżywa odświeżenie
    await page.click('[data-tab="ustawienia"]');
    await page.waitForSelector('#h-dev');
    ok((await page.textContent('#app')).includes('Telefon testowy') && (await page.textContent('#app')).includes('to urządzenie'), 'lista urządzeń');
    await page.click('[data-rem="1"]');
    await page.waitForSelector('[data-rem="0"]');
    ok(s.env.kalendarz.zdarzenia.length > 0 && s.env.wyzwalacze.length === 1, 'przypomnienia włączone: wydarzenia i wyzwalacz');
    ok((await page.textContent('#app')).includes('Włączone. Wydarzeń w kalendarzu'), 'stan przypomnień na ekranie');
    await page.click('[data-pair]');
    await page.waitForSelector('.pair-code');
    await page.click('.panel [data-refresh]');
    await page.waitForTimeout(500);
    ok(await page.isVisible('.pair-code'), 'kod parowania nie znika przy odświeżeniu');
    await s.zrzut('09-ustawienia'); await s.uklad('Ustawienia');
    // wstecz (Android) zamyka okno, nie aplikację
    await page.click('#tabbar [data-tab="dzis"]');
    await page.click('[data-adhoc="P1"]'); await page.waitForSelector('#sheet.open');
    await page.goBack(); await page.waitForFunction(() => !document.querySelector('#sheet.open'));
    ok(page.url() === base, '„wstecz” zamyka okno i zostaje w aplikacji');
    // różnica wersji strony i skryptu
    await page.route('https://script.google.com/**', async route => {
      const o = JSON.parse(s.env.api.doPost({ postData: { contents: route.request().postData() } }).getContent()); o.version = '2.0';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    });
    await page.click('[data-refresh]'); await page.waitForSelector('#sync .mm');
    ok((await page.textContent('#sync')).includes('skrypt w Apps Script v2.0'), 'ostrzeżenie o różnicy wersji');
    await s.ctx.close();
  }

  /* ---------- pozostałe szerokości: układ i zrzuty ---------- */
  for (const [w, h, mobile] of [[360, 760, true], [412, 915, true], [1440, 900, false]]) {
    const s = await sesja(w, h, mobile);
    await polacz(s);
    await s.zrzut('dzis'); await s.uklad('Dziś');
    await s.page.click('.pora .item:first-child .it-more'); await s.page.waitForSelector('#sheet.open');
    await s.zrzut('okno'); await s.uklad('okno podania');
    await s.page.click('#sheetClose'); await s.page.waitForFunction(() => !document.querySelector('#sheet.open'));
    await s.page.waitForTimeout(350);
    await s.page.click('#tabbar [data-tab="terapie"]'); await s.page.waitForSelector('.th-head');
    await s.zrzut('terapie'); await s.uklad('Terapie');
    await s.page.click('[data-tab="ustawienia"]'); await s.page.waitForSelector('#h-dev');
    await s.zrzut('ustawienia'); await s.uklad('Ustawienia');
    await s.ctx.close();
  }

  /* ---------- pusty arkusz i unieważnione urządzenie ---------- */
  {
    const s = await sesja(390, 844, true);
    s.env.sheets.filter(x => x.name !== 'Urządzenia').forEach(x => { x.rows.length = 1; });
    await s.page.goto(base);
    await s.page.click('[data-mode="key"]');
    await s.page.fill('#suUrl', URL_SKRYPTU); await s.page.fill('#suKey', 'zly-klucz-zly-klucz-zly-klucz'); await s.page.click('#suGo');
    await s.page.waitForFunction(() => document.getElementById('suErr').textContent.length > 0);
    ok((await s.page.textContent('#suErr')).includes('Niepoprawny klucz'), 'zły klucz: komunikat');
    await s.page.fill('#suKey', s.klucz); await s.page.click('#suGo');
    await s.page.waitForSelector('.empty');
    ok((await s.page.textContent('.empty')).includes('Nie ma jeszcze nic'), 'pusty arkusz: podpowiedź');
    await s.zrzut('10-pusty');
    s.env.api.odlaczWszystkieUrzadzenia();
    await s.page.click('[data-refresh]'); await s.page.waitForSelector('[data-relink]');
    ok((await s.page.textContent('#sync')).includes('odłączone'), 'odłączone urządzenie: komunikat');
    await s.ctx.close();
  }

  await browser.close(); server.close();
  assert.deepEqual(bledy, [], 'błędy w konsoli przeglądarki:\n' + bledy.join('\n'));
  console.log('Przeglądarka: ' + kroki + ' sprawdzeń OK, bez błędów w konsoli.');
})().catch(e => { console.error('BŁĄD TESTU:', e.message); process.exit(1); });
