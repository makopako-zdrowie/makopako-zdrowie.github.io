/****************************************************************
 * ZDROWIE – skrypt Apps Script (v1.0, 15.11.2026)
 *
 * Rdzeń przeniesiony z Finansów v19 (bez zmian w działaniu):
 *  - API dla strony: doPost {token|key, fn, arg} jako text/plain, odpowiedź JSON, bez HtmlService,
 *  - klucz główny (utworzKlucz) do połączenia pierwszego urządzenia,
 *  - przepustki urządzeń (skrót SHA-256 w zakładce „Urządzenia”), parowanie 6-cyfrowym kodem,
 *  - historia zdarzeń urządzeń (DEV_EVENTS), awaryjne odlaczWszystkieUrzadzenia,
 *  - pamięć modelu w CacheService (porcje po 90 tys. znaków), onEdit kasuje pamięć,
 *  - withLock_: zapis pod blokadą, potem świeży model w odpowiedzi.
 *
 * Aplikacja Zdrowie (v1):
 *  - utworzArkusz: zakładki Terapie, Pozycje, Pory dnia, Dziennik, Opakowania (+ dane z pliku DaneStartowe.gs, jeśli jest),
 *  - buildModel_: dane dla strony (plan dnia, tydzień i zapasy liczy wspólna LOGIKA, ta sama co w telefonie),
 *  - logDose / undoDose: odhaczenia w Dzienniku (tylko dopisywanie, cofanie przez kolumnę „Stan”),
 *  - finishPackage, startPosition, saveReminders,
 *  - przypomnienia w Kalendarzu Google: jedno wydarzenie na porę dnia, wyzwalacz co 15 minut.
 *
 * W TYM PLIKU NIE MA DANYCH ZDROWOTNYCH. Dane startowe są w osobnym pliku DaneStartowe.gs (poza repozytorium).
 *
 * Wdrożenie: Aplikacja internetowa, Wykonaj jako: Ja, Kto ma dostęp: Każdy.
 * Przy zmianach edytuj istniejące wdrożenie (Nowa wersja), żeby adres /exec się nie zmienił.
 * Strefa czasowa projektu: Europe/Warsaw (Ustawienia projektu).
 ****************************************************************/

const CORE = {
  VERSION: '1.0',             // ta sama liczba główna co CLIENT_VERSION w stronie; strona ostrzega, gdy się różnią
  APP_NAME: 'Zdrowie',
  DEVICES_SHEET: 'Urządzenia'
};

/* ============================ API DLA STRONY ============================ */

/** Operacje dostępne dla połączonych urządzeń (każda zwraca tekst JSON). */
const ACTIONS = {
  refreshData: function (arg) { return cachedModelJson_(!!(arg && arg.force)); },
  logDose: function (arg) { return logDose(arg); },
  undoDose: function (arg) { return undoDose(arg); },
  finishPackage: function (arg) { return finishPackage(arg); },
  startPosition: function (arg) { return startPosition(arg); },
  saveReminders: function (arg) { return saveReminders(arg); }
};

/** Kto wywołał bieżącą operację (do kolumny „Urządzenie” w Dzienniku). */
let WHO_ = null;

function doGet() {
  return ContentService.createTextOutput(CORE.APP_NAME + ': to jest adres danych aplikacji. Bez przepustki urządzenia nie ma tu żadnych danych.');
}

function doPost(e) {
  let req = null;
  try { req = JSON.parse(e && e.postData ? e.postData.contents : ''); } catch (err) { req = null; }
  if (!req || typeof req !== 'object') return apiJson_({ ok: false, error: 'Niepoprawne zapytanie.' });
  try {
    if (req.fn === 'pairFinish') return apiJson_(pairFinish_(req.arg));   // jedyna operacja bez przepustki: kod parowania → nowa przepustka
    const who = authorize_(req);
    if (!who.ok) return apiJson_({ ok: false, auth: true, revoked: !!who.revoked, error: who.error });
    WHO_ = who;
    const core = {
      pairStart: pairStart_,
      register: function (arg) { return JSON.stringify(registerDevice_(arg, who.device ? 'kod' : 'klucz')); },
      renameDevice: function (arg) { return withDevices_(who, renameDevice_(arg)); },
      confirmDevice: function (arg) { return withDevices_(who, confirmDevice_(arg)); },
      removeDevice: function (arg) { return withDevices_(who, removeDevice_(arg, who)); }
    };
    const fn = Object.prototype.hasOwnProperty.call(core, req.fn) ? core[req.fn]
      : Object.prototype.hasOwnProperty.call(ACTIONS, req.fn) ? ACTIONS[req.fn] : null;
    if (!fn) return apiJson_({ ok: false, error: 'Nieznana operacja.' });
    if (req.fn === 'register' && who.device) return apiJson_({ ok: false, error: 'To urządzenie jest już połączone.' });
    const out = fn(req.arg === undefined ? null : req.arg);
    return apiText_(attachDevices_(out, who));
  } catch (err) {
    return apiJson_({ ok: false, error: String(err && err.message || err) });
  }
}

function apiText_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON); }
function apiJson_(o) { return apiText_(JSON.stringify(o)); }

/** Dokłada listę urządzeń do modelu (sam model albo { ok, model }). Model rozpoznajemy po polu generatedAt. */
function attachDevices_(out, who) {
  let o;
  try { o = JSON.parse(out); } catch (e) { return out; }
  const target = o && o.generatedAt ? o : (o && o.model && o.model.generatedAt ? o.model : null);
  if (!target) return out;
  target.devices = devicesInfo_(who.device ? who.device.id : null);
  return JSON.stringify(o);
}

function withDevices_(who, res) {
  res.devices = devicesInfo_(who.device ? who.device.id : null);
  return JSON.stringify(res);
}

/** Kto pyta: urządzenie z przepustką albo ktoś z głównym kluczem (pierwsze połączenie). */
function authorize_(req) {
  if (typeof req.token === 'string' && req.token) {
    const dev = deviceByToken_(req.token);
    if (dev && dev.active) { touchDevice_(dev); return { ok: true, device: dev }; }
    if (dev) {
      const c = CacheService.getScriptCache();
      if (!c.get('rv_' + dev.id)) { c.put('rv_' + dev.id, '1', 3600); logEvent_('blocked', dev.name, 'próba użycia usuniętego urządzenia'); }
      return { ok: false, revoked: true, error: 'To urządzenie zostało odłączone. Połącz je ponownie kluczem albo kodem z innego urządzenia.' };
    }
    return { ok: false, revoked: true, error: 'Nie rozpoznaję tego urządzenia. Połącz je ponownie kluczem albo kodem.' };
  }
  const real = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!real) return { ok: false, error: 'Skrypt nie ma jeszcze klucza. Uruchom w edytorze Apps Script funkcję utworzKlucz.' };
  // Klucz ma ok. 180 bitów losowości, więc bez blokady (pozwalałaby obcemu odciąć właściciela złymi kluczami).
  if (typeof req.key !== 'string' || !sameText_(req.key.trim(), real)) return { ok: false, error: 'Niepoprawny klucz.' };
  return { ok: true, device: null };
}

/** Porównanie bez skracania przy pierwszej różnicy. */
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------------- pomocnicze ---------------- */

function isEmpty_(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }
function cleanText_(s, max) { return String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function dateStr_(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
/** Tekst do komórki – bez zamiany na formułę/liczbę przez arkusz. */
function asText_(x) {
  if (typeof x === 'number') return x;
  const s = String(x === null || x === undefined ? '' : x);
  return /^[=+\-@']/.test(s) ? "'" + s : s;
}
function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/* ---------------- urządzenia ---------------- */

const DEV_HEADER = ['ID', 'Nazwa', 'Urządzenie', 'Połączono', 'Ostatnio', 'Sposób', 'Status', 'Usunięto', 'Skrót przepustki', 'Potwierdzone'];

function devicesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CORE.DEVICES_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CORE.DEVICES_SHEET);
    sh.appendRow(DEV_HEADER);
    try {
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, DEV_HEADER.length).setFontWeight('bold');
      sh.getRange('D:E').setNumberFormat('yyyy-mm-dd hh:mm');
      sh.getRange('H:H').setNumberFormat('yyyy-mm-dd hh:mm');
    } catch (e) { /* formatowanie jest opcjonalne */ }
  }
  return sh;
}

function readDevices_() {
  const v = devicesSheet_().getDataRange().getValues();
  const out = [];
  for (let r = 1; r < v.length; r++) {
    if (isEmpty_(v[r][0])) continue;
    out.push({
      row: r + 1, id: String(v[r][0]), name: String(v[r][1] || ''), desc: String(v[r][2] || ''),
      created: isDate_(v[r][3]) ? v[r][3] : null, seen: isDate_(v[r][4]) ? v[r][4] : null,
      method: String(v[r][5] || ''), active: !/usuni/i.test(String(v[r][6] || '')),
      removed: isDate_(v[r][7]) ? v[r][7] : null, hash: String(v[r][8] || ''),
      confirmed: /^TAK$/i.test(String(v[r][9] || '').trim())
    });
  }
  return out;
}

function deviceByToken_(token) {
  const hash = sha256_(token);
  return readDevices_().filter(function (d) { return d.hash && sameText_(d.hash, hash); })[0] || null;
}

/** Ostatnia aktywność: zapis najwyżej co 10 minut na urządzenie. */
function touchDevice_(dev) {
  const c = CacheService.getScriptCache();
  if (c.get('seen_' + dev.id)) return;
  c.put('seen_' + dev.id, '1', 600);
  devicesSheet_().getRange(dev.row, 5).setValue(new Date());
}

function registerDevice_(arg, method) {
  arg = arg || {};
  const name = cleanText_(arg.name, 40) || 'Urządzenie';
  const desc = cleanText_(arg.desc, 80);
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');   // 64 znaki, ok. 240 bitów losowości
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  const now = new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // kodem łączy się tylko z urządzenia, które już ma dostęp – takie jest od razu potwierdzone; pierwsze urządzenie też
    const first = !readDevices_().some(function (d) { return d.active; });
    devicesSheet_().appendRow([id, name, desc, now, now, method, 'aktywne', '', sha256_(token), method === 'kod' || first ? 'TAK' : '']);
  } finally { lock.releaseLock(); }
  logEvent_('connect', name, desc + (method === 'kod' ? ', kodem z innego urządzenia' : ', głównym kluczem'));
  return { ok: true, token: token, id: id };
}

function renameDevice_(arg) {
  const name = cleanText_(arg && arg.name, 40);
  if (!name) throw new Error('Podaj nazwę urządzenia.');
  const d = readDevices_().filter(function (x) { return x.id === String(arg.id); })[0];
  if (!d) throw new Error('Nie znalazłem tego urządzenia.');
  devicesSheet_().getRange(d.row, 2).setValue(name);
  logEvent_('rename', name, 'wcześniej: ' + d.name);
  return { ok: true };
}

function confirmDevice_(arg) {
  const d = readDevices_().filter(function (x) { return x.id === String(arg && arg.id); })[0];
  if (!d) throw new Error('Nie znalazłem tego urządzenia.');
  devicesSheet_().getRange(d.row, 10).setValue('TAK');
  logEvent_('confirm', d.name, 'potwierdzone jako Twoje');
  return { ok: true };
}

function removeDevice_(arg, who) {
  const d = readDevices_().filter(function (x) { return x.id === String(arg && arg.id); })[0];
  if (!d) throw new Error('Nie znalazłem tego urządzenia.');
  if (!d.active) return { ok: true };
  devicesSheet_().getRange(d.row, 7, 1, 2).setValues([['usunięte', new Date()]]);
  logEvent_('remove', d.name, who.device && who.device.id === d.id ? 'na nim samym' : (who.device ? 'z urządzenia „' + who.device.name + '”' : 'kluczem głównym'));
  return { ok: true, self: !!(who.device && who.device.id === d.id) };
}

/** Lista dla aplikacji: bez skrótów przepustek. Usunięte urządzenia z ostatnich 90 dni jako historia. */
function devicesInfo_(currentId) {
  const iso = function (d) { return d ? d.toISOString() : null; };
  const limit = Date.now() - 90 * 864e5;
  const list = readDevices_().filter(function (d) { return d.active || (d.removed && d.removed.getTime() > limit); }).map(function (d) {
    return { id: d.id, name: d.name, desc: d.desc, created: iso(d.created), seen: iso(d.seen), method: d.method, active: d.active, removed: iso(d.removed), current: d.id === currentId, confirmed: d.confirmed };
  });
  return { list: list, events: readEvents_().slice(0, 30), current: currentId };
}

/* ---------------- historia zdarzeń (ostatnie 60, w ustawieniach skryptu) ---------------- */

function readEvents_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('DEV_EVENTS') || '[]'); } catch (e) { return []; }
}

function logEvent_(type, name, info) {
  const ev = readEvents_();
  ev.unshift({ t: new Date().toISOString(), type: type, name: cleanText_(name, 40), info: cleanText_(info, 120) });
  PropertiesService.getScriptProperties().setProperty('DEV_EVENTS', JSON.stringify(ev.slice(0, 60)));
}

/* ---------------- parowanie kodem ---------------- */

/** Połączone urządzenie prosi o 6-cyfrowy kod ważny 5 minut; nowe urządzenie wymienia go raz na własną przepustkę. */
function pairStart_() {
  const code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1000000).padStart(6, '0');
  CacheService.getScriptCache().put('pair_' + code, '1', 300);
  return JSON.stringify({ ok: true, code: code, seconds: 300 });
}

function pairFinish_(arg) {
  const cache = CacheService.getScriptCache();
  const bad = Number(cache.get('pair_bad') || 0);
  if (bad >= 10) return { ok: false, error: 'Za dużo błędnych kodów. Parowanie wróci za 15 minut.' };
  const code = String(arg && arg.code || '').replace(/\D/g, '');
  if (code.length !== 6 || !cache.get('pair_' + code)) {
    cache.put('pair_bad', String(bad + 1), 900);
    if (bad + 1 === 3 || bad + 1 === 10) logEvent_('pair_fail', '', (bad + 1) + ' błędne kody parowania w ciągu 15 minut');
    return { ok: false, error: 'Kod jest nieprawidłowy albo wygasł. Poproś o nowy na połączonym urządzeniu.' };
  }
  cache.remove('pair_' + code);   // kod działa tylko raz
  return registerDevice_(arg, 'kod');
}

/* ---------------- funkcje do uruchamiania ręcznie w edytorze ---------------- */

/** Uruchom → utworzKlucz. Nowy klucz główny w dzienniku wykonania. Połączone urządzenia działają dalej. */
function utworzKlucz() {
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 48);
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  CacheService.getScriptCache().remove('pair_bad');
  logEvent_('key_new', '', 'utworzono nowy klucz główny');
  Logger.log('Nowy klucz do aplikacji (skopiuj go): ' + key);
  return key;
}

/** Awaryjnie: odłącza wszystkie urządzenia. */
function odlaczWszystkieUrzadzenia() {
  const sh = devicesSheet_(), now = new Date();
  readDevices_().filter(function (d) { return d.active; }).forEach(function (d) { sh.getRange(d.row, 7, 1, 2).setValues([['usunięte', now]]); });
  logEvent_('remove', 'wszystkie urządzenia', 'funkcją odlaczWszystkieUrzadzenia');
  Logger.log('Wszystkie urządzenia odłączone.');
}

/* ---------------- pamięć modelu (CacheService, porcje po 90 tys. znaków) ---------------- */

function modelCacheKey_() {
  const d = new Date();
  return 'model:' + CORE.VERSION + ':' + dateStr_(d);   // zmiana dnia = nowy model (ważne: lista „Dziś”)
}
function cachedModelJson_(force) {
  const key = modelCacheKey_();
  if (!force) { const hit = cacheGetBig_(key); if (hit) return hit; }
  const json = JSON.stringify(buildModel_());
  cachePutBig_(key, json, 1800);
  return json;
}
function cachePutBig_(key, text, ttl) {
  try {
    const c = CacheService.getScriptCache(), size = 90000, obj = {};
    const n = Math.ceil(text.length / size);
    for (let i = 0; i < n; i++) obj[key + ':' + i] = text.slice(i * size, (i + 1) * size);
    obj[key] = String(n);
    c.putAll(obj, ttl);
  } catch (e) { /* bez pamięci – policzymy następnym razem */ }
}
function cacheGetBig_(key) {
  try {
    const c = CacheService.getScriptCache();
    const n = Number(c.get(key) || 0);
    if (!n) return null;
    const keys = []; for (let i = 0; i < n; i++) keys.push(key + ':' + i);
    const got = c.getAll(keys);
    let out = '';
    for (let i = 0; i < n; i++) { if (got[keys[i]] === undefined || got[keys[i]] === null) return null; out += got[keys[i]]; }
    return out;
  } catch (e) { return null; }
}
function invalidateModel_() {
  try { CacheService.getScriptCache().remove(modelCacheKey_()); } catch (e) { /* nic */ }
}
/** Prosty wyzwalacz: ręczna zmiana w arkuszu kasuje pamięć modelu. */
function onEdit() { invalidateModel_(); }

/* ---------------- ustawienia aplikacji w ustawieniach skryptu ---------------- */

function readPrefs_(name, dflt) {
  try { const v = PropertiesService.getScriptProperties().getProperty(name); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
}
function writePrefs_(name, value) { PropertiesService.getScriptProperties().setProperty(name, JSON.stringify(value)); invalidateModel_(); }

/* ---------------- zapis pod blokadą ---------------- */

/** fn(ss) zwraca obiekt; dokładamy ok: true i świeży model. Błąd → { ok: false, error }. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return JSON.stringify({ ok: false, error: 'Arkusz jest zajęty innym zapisem. Spróbuj za chwilę.' }); }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const out = fn(ss) || {};
    SpreadsheetApp.flush();
    invalidateModel_();
    out.ok = true;
    out.model = JSON.parse(cachedModelJson_(true));
    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.message || e) });
  } finally {
    lock.releaseLock();
  }
}

/* ============================ LOGIKA (wspólna ze stroną) ============================ */
/* Poniższy blok to kopia pliku logika.js ze strony. Nie zmieniaj go tutaj: wstawia go narzedzia/zbuduj.js. */
/* >>> LOGIKA >>> */
/****************************************************************
 * ZDROWIE – wspólna logika (v1.0)
 *
 * Czyste funkcje bez dostępu do strony i do arkusza: harmonogramy, plan dnia, tydzień, doraźne, zapasy,
 * lista przypomnień. Ten sam tekst jest w stronie (logika.js) i w Code.gs (między znacznikami LOGIKA),
 * żeby telefon i skrypt liczyły dokładnie tak samo. Zmieniasz tutaj, potem: node narzedzia/zbuduj.js.
 *
 * Daty to teksty 'RRRR-MM-DD' (porównywanie tekstów = porównywanie dat). Bez stref czasowych.
 ****************************************************************/
var Logika = (function () {
  'use strict';
  const DZIEN = 864e5;
  const two = n => (n < 10 ? '0' : '') + n;

  /* ---------------- daty ---------------- */
  const num = s => { const p = String(s).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DZIEN); };
  const str = n => { const d = new Date(n * DZIEN); return d.getUTCFullYear() + '-' + two(d.getUTCMonth() + 1) + '-' + two(d.getUTCDate()); };
  const plus = (s, k) => str(num(s) + k);
  const dzienTyg = s => (((num(s) + 3) % 7) + 7) % 7;          // 0 = poniedziałek … 6 = niedziela
  const poczatekTyg = s => plus(s, -dzienTyg(s));
  const poprawnaData = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && str(num(s)) === s;

  const MIES = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const DNI = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
  const DNI_W = ['w poniedziałek', 'we wtorek', 'w środę', 'w czwartek', 'w piątek', 'w sobotę', 'w niedzielę'];
  const DNI_SKROT = ['pn', 'wt', 'śr', 'cz', 'pt', 'sb', 'nd'];
  /** „2 stycznia”; z rokiem, gdy jest inny niż rok daty odniesienia. */
  function dataPl(s, odniesienie) {
    if (!poprawnaData(s)) return '';
    const p = s.split('-');
    return (+p[2]) + ' ' + MIES[+p[1] - 1] + (odniesienie && odniesienie.slice(0, 4) !== p[0] ? ' ' + p[0] : '');
  }

  /* ---------------- harmonogram ---------------- */
  const ALIAS = { pn: 0, pon: 0, 'poniedziałek': 0, wt: 1, wto: 1, wtorek: 1, 'śr': 2, sr: 2, 'śro': 2, sro: 2, 'środa': 2,
    cz: 3, czw: 3, czwartek: 3, pt: 4, 'pią': 4, pia: 4, 'piątek': 4, sb: 5, sob: 5, so: 5, sobota: 5, nd: 6, ndz: 6, nie: 6, niedz: 6, niedziela: 6 };
  function listaDni(t) {
    const cz = String(t).split(/[,;\s]+/).filter(Boolean);
    if (!cz.length) return null;
    const out = [];
    for (const c of cz) {
      const k = c.replace(/\.$/, '');
      if (!Object.prototype.hasOwnProperty.call(ALIAS, k)) return null;
      if (out.indexOf(ALIAS[k]) < 0) out.push(ALIAS[k]);
    }
    return out.sort((a, b) => a - b);
  }
  /** Tekst z kolumny „Harmonogram” → reguła. Nieczytelny tekst daje typ 'blad' (pozycja nie pojawia się w planie, model ostrzega). */
  function harmonogram(tekst) {
    const t = String(tekst == null ? '' : tekst).trim().toLowerCase().replace(/×/g, 'x').replace(/\s+/g, ' ');
    let m;
    if (!t) return { typ: 'brak' };
    if (t === 'codziennie' || t === 'co dzień' || t === 'codzień') return { typ: 'codziennie' };
    if (t === 'jednorazowo' || t === 'raz') return { typ: 'raz' };
    if (t === 'co drugi dzień') return { typ: 'coDni', n: 2 };
    if ((m = t.match(/^co (\d+) dni$/)) && +m[1] >= 1) return +m[1] === 1 ? { typ: 'codziennie' } : { typ: 'coDni', n: +m[1] };
    if (t === 'co tydzień') return { typ: 'coTyg', n: 1 };
    if ((m = t.match(/^co (\d+) tyg(\.|odnie|odni)?$/)) && +m[1] >= 1) return { typ: 'coTyg', n: +m[1] };
    if ((m = t.match(/^(\d+) ?x ?\/ ?tydz(\.|ień)?(?: (.+))?$/)) && +m[1] >= 1 && +m[1] <= 7) {
      const pref = m[3] ? listaDni(m[3]) : [];
      return pref ? { typ: 'tydz', n: +m[1], pref: pref } : { typ: 'blad' };
    }
    if ((m = t.match(/^cykl (\d+) ?\/ ?(\d+)$/)) && +m[1] >= 1) return { typ: 'cykl', a: +m[1], b: +m[2] };
    const dni = listaDni(t);
    return dni ? { typ: 'dniTyg', dni: dni } : { typ: 'blad' };
  }
  function opisHarmonogramu(h) {
    switch (h.typ) {
      case 'codziennie': return 'codziennie';
      case 'coDni': return h.n === 2 ? 'co drugi dzień' : 'co ' + h.n + ' dni';
      case 'dniTyg': return h.dni.map(d => DNI_SKROT[d]).join(', ');
      case 'tydz': return (h.n === 1 ? 'raz' : h.n + ' razy') + ' w tygodniu' + (h.pref.length ? ', najlepiej ' + h.pref.map(d => DNI_W[d]).join(' i ') : '');
      case 'cykl': return h.a + ' dni brania, ' + h.b + ' dni przerwy';
      case 'coTyg': return h.n === 1 ? 'co tydzień' : 'co ' + h.n + ' tyg.';
      case 'raz': return 'jednorazowo';
      case 'brak': return 'bez stałych pór';
      default: return 'nieczytelny harmonogram';
    }
  }

  /* ---------------- ilości i jednostki ---------------- */
  // [1, 2–4, 5+, ułamek]
  const FORMY = [
    ['wdech', 'wdechy', 'wdechów', 'wdechu'], ['kropla', 'krople', 'kropli', 'kropli'], ['kapsułka', 'kapsułki', 'kapsułek', 'kapsułki'],
    ['tabletka', 'tabletki', 'tabletek', 'tabletki'], ['ampułka', 'ampułki', 'ampułek', 'ampułki'], ['saszetka', 'saszetki', 'saszetek', 'saszetki'],
    ['mycie', 'mycia', 'myć', 'mycia'], ['zabieg', 'zabiegi', 'zabiegów', 'zabiegu'], ['porcja', 'porcje', 'porcji', 'porcji'],
    ['dawka', 'dawki', 'dawek', 'dawki'], ['psiknięcie', 'psiknięcia', 'psiknięć', 'psiknięcia'], ['raz', 'razy', 'razy', 'raza'],
    ['łyżeczka', 'łyżeczki', 'łyżeczek', 'łyżeczki'], ['plaster', 'plastry', 'plastrów', 'plastra'], ['zastrzyk', 'zastrzyki', 'zastrzyków', 'zastrzyku']
  ];
  const ULAMKI = { '0.5': '½', '0.25': '¼', '0.75': '¾' };
  function liczba(n) {
    if (!isFinite(n)) return '';
    const c = Math.floor(n + 1e-9), u = Math.round((n - c) * 100) / 100;
    if (u && ULAMKI[String(u)]) return (c ? c : '') + ULAMKI[String(u)];
    return String(Math.round(n * 100) / 100).replace('.', ',');
  }
  function jednostka(n, j) {
    const t = String(j || '').trim(), k = t.toLowerCase();
    const f = FORMY.filter(x => x.indexOf(k) >= 0)[0];
    if (!f) return t;
    if (Math.abs(n - Math.round(n)) > 1e-9) return f[3];
    const a = Math.abs(Math.round(n));
    if (a === 1) return f[0];
    return a % 10 >= 2 && a % 10 <= 4 && !(a % 100 >= 12 && a % 100 <= 14) ? f[1] : f[2];
  }
  /** „1 wdech”, „½ ampułki”, „4000 IU”. */
  function ilosc(n, j) { const jj = jednostka(n, j); return liczba(n) + (jj ? ' ' + jj : ''); }

  /* ---------------- przygotowanie modelu ---------------- */
  const klucz = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const DOMYSLNA_PORA = 'w ciągu dnia';
  function przygotuj(model) {
    const pory = (model.pory || []).map(p => Object.assign({}, p, { klucz: klucz(p.nazwa) }))
      .sort((a, b) => (a.kolejnosc || 0) - (b.kolejnosc || 0));
    const poryMap = {}; pory.forEach(p => { poryMap[p.klucz] = p; });
    const terapie = {}; (model.terapie || []).forEach(t => { terapie[t.id] = t; });
    const pozycje = (model.pozycje || []).map(p => Object.assign({}, p, {
      h: harmonogram(p.harmonogram),
      poryN: String(p.pory || '').split(/[+,;]/).map(klucz).filter(Boolean),
      dawkaN: p.dawka > 0 ? p.dawka : 1
    }));
    const pozMap = {}; pozycje.forEach(p => { pozMap[p.id] = p; });
    const otwarte = {}, skonczone = {};
    (model.opakowania || []).forEach(o => {
      if (o.skonczone) (skonczone[o.pozycja] = skonczone[o.pozycja] || []).push(o);
      else if (!otwarte[o.pozycja] || String(o.otwarto || '') >= String(otwarte[o.pozycja].otwarto || '')) otwarte[o.pozycja] = o;
    });
    return { pory: pory, poryMap: poryMap, terapie: terapie, pozycje: pozycje, pozMap: pozMap, otwarte: otwarte, skonczone: skonczone };
  }
  /** Pory pozycji; bez wpisanej pory trafia do „w ciągu dnia”. */
  const poryPozycji = p => (p.poryN.length ? p.poryN : [DOMYSLNA_PORA]);

  /* ---------------- dziennik ---------------- */
  const kluczSlotu = (data, pora, poz) => data + '|' + klucz(pora) + '|' + poz;
  /**
   * Jedna odpowiedź na jedno zaplanowane podanie: liczy się ostatni wpis dla (dzień, pora, pozycja).
   * Wpisy „doraźnie” nie mają pory i liczą się wszystkie.
   */
  function indeks(wpisy) {
    const sloty = {}, dorazne = [];
    (wpisy || []).forEach(w => {
      if (w.status === 'doraźnie') dorazne.push(w);
      else sloty[kluczSlotu(w.data, w.pora, w.pozycja)] = w;
    });
    const lista = Object.keys(sloty).map(k => sloty[k]);
    return { sloty: sloty, dorazne: dorazne, lista: lista };
  }
  const stanWpisu = w => (!w ? 'do' : w.status === 'wzięte' ? 'wziete' : w.status === 'pominięte' ? 'pominiete' : 'niewiem');

  /* ---------------- plan dnia ---------------- */
  function wZakresie(p, data) {
    if (p.status === 'planowana' || !p.od || data < p.od) return false;
    if (p.do && data > p.do) return false;
    if (p.status !== 'aktywna' && !p.do) return false;        // zakończona bez daty „Do”: nie zgadujemy
    return true;
  }
  /** Czy pozycja ma tego dnia stałe podanie (harmonogramy „N razy w tygodniu” są osobno, w tygodniu). */
  function wypada(p, data) {
    if (!wZakresie(p, data)) return false;
    const h = p.h, dni = num(data) - num(p.od);
    switch (h.typ) {
      case 'codziennie': return true;
      case 'coDni': return dni % h.n === 0;
      case 'dniTyg': return h.dni.indexOf(dzienTyg(data)) >= 0;
      case 'cykl': return dni % (h.a + h.b) < h.a;
      case 'coTyg': return dni % (7 * h.n) === 0;
      case 'raz': return data === p.od;
      default: return false;
    }
  }
  const godzinaPory = (pora, data) => (pora ? (dzienTyg(data) >= 5 && pora.weekend ? pora.weekend : pora.godzina) || '' : '');
  /** Karty pór na dany dzień: [{ klucz, nazwa, godzina, pozycje: [{ p, pora, wpis, stan }], doZrobienia }]. */
  function dzien(ctx, idx, data) {
    const karty = {};
    ctx.pozycje.forEach(p => {
      if (!wypada(p, data)) return;
      poryPozycji(p).forEach(k => {
        const w = idx.sloty[kluczSlotu(data, k, p.id)] || null;
        (karty[k] = karty[k] || []).push({ p: p, pora: k, wpis: w, stan: stanWpisu(w) });
      });
    });
    const kolej = ctx.pory.map(p => p.klucz);
    Object.keys(karty).forEach(k => { if (kolej.indexOf(k) < 0) kolej.push(k); });
    return kolej.filter(k => karty[k]).map(k => {
      const pora = ctx.poryMap[k];
      return { klucz: k, nazwa: pora ? pora.nazwa : k, godzina: godzinaPory(pora, data), pozycje: karty[k],
        doZrobienia: karty[k].filter(x => x.stan === 'do').length };
    });
  }
  /** Podania z ostatnich dni bez żadnej odpowiedzi (karta „Wziąłeś?”), od wczoraj wstecz. */
  function zalegle(ctx, idx, dzis, ileDni) {
    const out = [];
    for (let k = 1; k <= (ileDni || 3); k++) {
      const d = plus(dzis, -k);
      dzien(ctx, idx, d).forEach(karta => {
        const braki = karta.pozycje.filter(x => x.stan === 'do');
        if (braki.length) out.push({ data: d, dniTemu: k, klucz: karta.klucz, nazwa: karta.nazwa, pozycje: braki });
      });
    }
    return out;
  }

  /* ---------------- tydzień („N razy w tygodniu”) ---------------- */
  function stanTygodnia(p, idx, data) {
    const pon = poczatekTyg(data), nd = plus(pon, 6);
    let wziete = 0, pominiete = 0;
    idx.lista.forEach(w => {
      if (w.pozycja !== p.id || w.data < pon || w.data > nd) return;
      if (w.status === 'wzięte') wziete++; else if (w.status === 'pominięte') pominiete++;
    });
    return { wziete: wziete, pominiete: pominiete, zostalo: Math.max(0, p.h.n - wziete - pominiete) };
  }
  function tydzien(ctx, idx, dzis) {
    const dw = dzienTyg(dzis);
    return ctx.pozycje.filter(p => p.h.typ === 'tydz' && wZakresie(p, dzis)).map(p => {
      const s = stanTygodnia(p, idx, dzis), pora = poryPozycji(p)[0];
      const wpisDzis = idx.sloty[kluczSlotu(dzis, pora, p.id)] || null;
      return { p: p, pora: pora, n: p.h.n, wziete: s.wziete, pominiete: s.pominiete, zostalo: s.zostalo, wpisDzis: wpisDzis,
        prefDzis: p.h.pref.indexOf(dw) >= 0, prefMinal: p.h.pref.length > 0 && p.h.pref.every(d => d < dw), dniDoKonca: 6 - dw };
    });
  }
  /** Czy przypominać o pozycji tygodniowej danego dnia: w dniu preferowanym i po nim, albo gdy kończy się tydzień. */
  function tygodniowaDzis(p, idx, data) {
    const s = stanTygodnia(p, idx, data);
    if (s.zostalo <= 0 || idx.sloty[kluczSlotu(data, poryPozycji(p)[0], p.id)]) return false;
    const dw = dzienTyg(data), zrobione = s.wziete + s.pominiete;
    if (7 - dw <= s.zostalo) return true;
    return Math.min(p.h.n, p.h.pref.filter(d => d <= dw).length) > zrobione;
  }

  /* ---------------- doraźne ---------------- */
  function dorazne(ctx, idx, dzis) {
    const pon = poczatekTyg(dzis);
    return ctx.pozycje.filter(p => p.dorazne && p.status === 'aktywna' && (!p.od || p.od <= dzis) && (!p.do || p.do >= dzis)).map(p => {
      const moje = idx.dorazne.filter(w => w.pozycja === p.id);
      return { p: p, dzis: moje.filter(w => w.data === dzis), tydzien: moje.filter(w => w.data >= pon && w.data <= dzis).length };
    });
  }

  /* ---------------- zapasy ---------------- */
  /** Ile jednostek pozycji zeszło od dnia „od” (wzięte i doraźne). */
  function zuzycie(idx, p, od) {
    let s = 0;
    const dodaj = w => { if (w.pozycja === p.id && w.data >= od) s += (w.ilosc > 0 || w.ilosc === 0) ? +w.ilosc : p.dawkaN; };
    idx.lista.forEach(w => { if (w.status === 'wzięte') dodaj(w); });
    idx.dorazne.forEach(dodaj);
    return s;
  }
  /** Ile zejdzie danego dnia według planu; dziś liczą się tylko podania jeszcze bez odpowiedzi. */
  function potrzeba(p, idx, data, dzis) {
    if (p.h.typ === 'tydz') return wZakresie(p, data) ? p.h.n * p.dawkaN / 7 : 0;
    if (!wypada(p, data)) return 0;
    const pory = poryPozycji(p);
    const ile = data === dzis ? pory.filter(k => !idx.sloty[kluczSlotu(data, k, p.id)]).length : pory.length;
    return ile * p.dawkaN;
  }
  /**
   * Stan otwartych opakowań. Koniec zapasu to wcześniejsza z dat: koniec dawek i „Ważne do”.
   * Nieznana ilość: liczymy dni od otwarcia, a koniec prognozujemy z poprzednich opakowań tej pozycji.
   */
  function zapasy(ctx, idx, dzis) {
    const out = [];
    ctx.pozycje.forEach(p => {
      const o = ctx.otwarte[p.id];
      if (!o || p.status === 'zakończona') return;
      const r = { p: p, opak: o, znane: o.ilosc > 0, razem: o.ilosc > 0 ? o.ilosc : null, zuzyte: null, zostalo: null,
        koniecDawek: null, koniec: null, powod: null, dniDoKonca: null, alert: false,
        otwarteDni: o.otwarto ? num(dzis) - num(o.otwarto) : null, poTerminie: !!(o.wazneDo && o.wazneDo < dzis) };
      if (r.znane) {
        r.zuzyte = (o.zuzytePrzed || 0) + (o.otwarto ? zuzycie(idx, p, o.otwarto) : 0);
        r.zostalo = Math.round((r.razem - r.zuzyte) * 1000) / 1000;
        let z = r.zostalo, d = dzis, ost = null, bylo = false, i = 0;
        for (; i < 800; i++) {
          const n = potrzeba(p, idx, d, dzis);
          if (n > 0) { bylo = true; if (z - n < -1e-9) break; z -= n; }
          ost = d; d = plus(d, 1);
        }
        if (bylo && i < 800) { r.koniecDawek = ost || plus(dzis, -1); r.koniec = r.koniecDawek; r.powod = 'dawki'; }
      } else if (o.otwarto) {
        const hist = (ctx.skonczone[p.id] || []).filter(x => x.otwarto && x.skonczone && x.skonczone >= x.otwarto).map(x => num(x.skonczone) - num(x.otwarto));
        if (hist.length) {
          r.sredniaDni = Math.round(hist.reduce((a, b) => a + b, 0) / hist.length);
          r.koniec = plus(o.otwarto, r.sredniaDni); r.powod = 'prognoza';
        }
      }
      if (o.wazneDo && (!r.koniec || o.wazneDo < r.koniec)) { r.koniec = o.wazneDo; r.powod = 'waznosc'; }
      if (r.koniec) {
        r.dniDoKonca = num(r.koniec) - num(dzis);
        r.alert = r.dniDoKonca <= (o.alertDni >= 0 && o.alertDni !== null && o.alertDni !== '' ? +o.alertDni : 14);
      }
      out.push(r);
    });
    return out;
  }

  /* ---------------- przypomnienia (dla Kalendarza) ---------------- */
  /** Na każdy z najbliższych dni: pory, w których zostało coś bez odpowiedzi. [{ data, klucz, nazwa, godzina, nazwy }] */
  function przypomnienia(ctx, idx, dzis, ileDni) {
    const out = [];
    for (let k = 0; k < (ileDni || 7); k++) {
      const d = plus(dzis, k), karty = {}, kolej = [];
      const dodaj = (kl, nazwa) => { if (!karty[kl]) { karty[kl] = []; kolej.push(kl); } karty[kl].push(nazwa); };
      dzien(ctx, idx, d).forEach(karta => karta.pozycje.forEach(x => { if (x.stan === 'do') dodaj(karta.klucz, x.p.nazwa); }));
      ctx.pozycje.forEach(p => { if (p.h.typ === 'tydz' && wZakresie(p, d) && tygodniowaDzis(p, idx, d)) dodaj(poryPozycji(p)[0], p.nazwa); });
      kolej.forEach(kl => {
        const pora = ctx.poryMap[kl];
        out.push({ data: d, klucz: kl, nazwa: pora ? pora.nazwa : kl, godzina: godzinaPory(pora, d) || '12:00', nazwy: karty[kl] });
      });
    }
    return out;
  }

  return { num: num, str: str, plus: plus, dzienTyg: dzienTyg, poczatekTyg: poczatekTyg, poprawnaData: poprawnaData, dataPl: dataPl,
    DNI: DNI, DNI_W: DNI_W, DNI_SKROT: DNI_SKROT, harmonogram: harmonogram, opisHarmonogramu: opisHarmonogramu,
    liczba: liczba, jednostka: jednostka, ilosc: ilosc, klucz: klucz, przygotuj: przygotuj, poryPozycji: poryPozycji,
    kluczSlotu: kluczSlotu, indeks: indeks, stanWpisu: stanWpisu, wZakresie: wZakresie, wypada: wypada, godzinaPory: godzinaPory,
    dzien: dzien, zalegle: zalegle, tydzien: tydzien, tygodniowaDzis: tygodniowaDzis, dorazne: dorazne,
    zuzycie: zuzycie, zapasy: zapasy, przypomnienia: przypomnienia };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Logika;
/* <<< LOGIKA <<< */

/* ============================ ARKUSZ: ZAKŁADKI I ODCZYT ============================ */

/** Zakładki aplikacji. Kolumny odnajdujemy po nazwie z wiersza 1, więc można je przestawiać i dopisywać własne. */
const TABS = {
  TERAPIE: { name: 'Terapie', head: ['ID', 'Nazwa', 'Lekarz', 'Specjalizacja', 'Od', 'Do', 'Kolor', 'Uwagi'], text: ['Od', 'Do'] },
  POZYCJE: { name: 'Pozycje', head: ['ID', 'Terapia', 'Nazwa', 'Rodzaj', 'Postać', 'Dawka', 'Jednostka', 'Harmonogram', 'Pory', 'Doraźnie', 'Warunki', 'Od', 'Do', 'Status', 'Uwagi'], text: ['Harmonogram', 'Pory', 'Od', 'Do'] },
  PORY: { name: 'Pory dnia', head: ['Nazwa', 'Godzina', 'Godzina w weekend', 'Kolejność'], text: ['Godzina', 'Godzina w weekend'] },
  DZIENNIK: { name: 'Dziennik', head: ['ID', 'Zapisano', 'Data', 'Godzina', 'Pora', 'Pozycja', 'Nazwa', 'Status', 'Ilość', 'Powód', 'Później', 'Notatka', 'Urządzenie', 'Stan'], text: ['ID', 'Zapisano', 'Data', 'Godzina'] },
  OPAKOWANIA: { name: 'Opakowania', head: ['ID', 'Pozycja', 'Otwarto', 'Ilość w opakowaniu', 'Ważne do', 'Alert (dni przed)', 'Skończone', 'Uwagi'], text: ['Otwarto', 'Ważne do', 'Skończone'] }
};
const OKNO_DNI = 40;                                              // tyle dni dziennika dostaje strona; starsze zużycie zapasu liczy skrypt
const STATUSY = ['wzięte', 'pominięte', 'doraźnie', 'nie pamiętam'];

function tz_() { return Session.getScriptTimeZone() || 'Europe/Warsaw'; }
function todayStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function nowStamp_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }

/** Zakładka jako lista wierszy { _row, 'Nazwa kolumny': wartość }. display = teksty tak, jak je widać (godziny). */
function readTable_(ss, tab, display) {
  const sh = ss.getSheetByName(tab.name);
  if (!sh) return { tab: tab, sh: null, rows: [], col: {}, missing: true };
  const range = sh.getDataRange();
  const v = display ? range.getDisplayValues() : range.getValues();
  const head = (v[0] || []).map(function (h) { return String(h).trim().toLowerCase(); });
  const col = {};
  tab.head.forEach(function (h) { col[h] = head.indexOf(h.toLowerCase()); });
  const rows = [];
  for (let r = 1; r < v.length; r++) {
    if (v[r].every(isEmpty_)) continue;
    const o = { _row: r + 1 };
    tab.head.forEach(function (h) { o[h] = col[h] >= 0 ? v[r][col[h]] : ''; });
    rows.push(o);
  }
  return { tab: tab, sh: sh, rows: rows, col: col, missing: false };
}
function colIdx_(t, name) {
  if (!(t.col[name] >= 0)) throw new Error('W zakładce „' + t.tab.name + '” brakuje kolumny „' + name + '”. Uruchom funkcję utworzArkusz.');
  return t.col[name] + 1;
}
/** Wiersz do dopisania: wartości trafiają pod swoje nagłówki, teksty bez zamiany na formuły. */
function rowFor_(t, obj) {
  const width = Math.max(t.sh.getLastColumn(), t.tab.head.length);
  const row = []; for (let i = 0; i < width; i++) row.push('');
  Object.keys(obj).forEach(function (k) { row[colIdx_(t, k) - 1] = asText_(obj[k]); });
  return row;
}
function appendRows_(sh, rows) {
  if (!rows.length) return;
  const start = sh.getLastRow() + 1, need = start + rows.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}
function nextId_(rows, prefix) {
  let max = 0;
  rows.forEach(function (r) { const m = String(r.ID).match(/^[A-Za-z]+(\d+)$/); if (m) max = Math.max(max, +m[1]); });
  return prefix + (max + 1);
}

/* ---------------- wartości z komórek ---------------- */

function textCell_(v) { return isDate_(v) ? dateCell_(v) : String(v === null || v === undefined ? '' : v).trim(); }
/** Data z komórki (prawdziwa data albo tekst RRRR-MM-DD lub DD.MM.RRRR) → 'RRRR-MM-DD'; inaczej ''. */
function dateCell_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || tz_(), 'yyyy-MM-dd');
  const s = String(v === null || v === undefined ? '' : v).trim();
  let t = '';
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) t = s;
  else if (m) t = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return t && Logika.poprawnaData(t) ? t : '';
}
function timeCell_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, tz_(), 'HH:mm');
  const m = String(v === null || v === undefined ? '' : v).trim().match(/^(\d{1,2})[:.](\d{2})/);
  return m && +m[1] < 24 && +m[2] < 60 ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}
function numCell_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v === null || v === undefined ? '' : v).trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  if (s === '½') return 0.5;
  const n = Number(s);
  return isFinite(n) ? n : null;
}
function boolCell_(v) { return v === true || /^(tak|t|true|1|x)$/i.test(String(v === null || v === undefined ? '' : v).trim()); }

/* ============================ MODEL DLA STRONY ============================ */

/**
 * Surowe dane z arkusza + dziennik z ostatnich OKNO_DNI dni. Plan dnia, tydzień i zapasy liczy LOGIKA
 * (w telefonie od razu, także bez internetu; tutaj na potrzeby przypomnień).
 * MUSI mieć pole generatedAt (po nim attachDevices_ rozpoznaje model).
 */
function buildModel_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = todayStr_(), od = Logika.plus(today, -OKNO_DNI), warnings = [];
  const tT = readTable_(ss, TABS.TERAPIE), tP = readTable_(ss, TABS.POZYCJE), tR = readTable_(ss, TABS.PORY, true),
    tD = readTable_(ss, TABS.DZIENNIK), tO = readTable_(ss, TABS.OPAKOWANIA);
  const missing = [tT, tP, tR, tD, tO].filter(function (t) { return t.missing; }).map(function (t) { return t.tab.name; });
  if (missing.length) warnings.push('W arkuszu brakuje zakładek: ' + missing.join(', ') + '. Uruchom w edytorze Apps Script funkcję utworzArkusz.');

  const terapie = tT.rows.filter(function (r) { return !isEmpty_(r['ID']); }).map(function (r) {
    const kolor = textCell_(r['Kolor']);
    return { id: textCell_(r['ID']), nazwa: textCell_(r['Nazwa']), lekarz: textCell_(r['Lekarz']), specjalizacja: textCell_(r['Specjalizacja']),
      od: dateCell_(r['Od']), do: dateCell_(r['Do']), kolor: /^#[0-9a-f]{6}$/i.test(kolor) ? kolor : '', uwagi: textCell_(r['Uwagi']) };
  });
  const pory = tR.rows.filter(function (r) { return !isEmpty_(r['Nazwa']); }).map(function (r, i) {
    const k = numCell_(r['Kolejność']);
    return { nazwa: textCell_(r['Nazwa']), godzina: timeCell_(r['Godzina']), weekend: timeCell_(r['Godzina w weekend']), kolejnosc: k === null ? 100 + i : k };
  });
  const pozycje = tP.rows.filter(function (r) { return !isEmpty_(r['ID']); }).map(function (r) {
    return { id: textCell_(r['ID']), terapia: textCell_(r['Terapia']), nazwa: textCell_(r['Nazwa']), rodzaj: textCell_(r['Rodzaj']).toLowerCase(),
      postac: textCell_(r['Postać']), dawka: numCell_(r['Dawka']), jednostka: textCell_(r['Jednostka']), harmonogram: textCell_(r['Harmonogram']),
      pory: textCell_(r['Pory']), dorazne: boolCell_(r['Doraźnie']), warunki: textCell_(r['Warunki']), od: dateCell_(r['Od']), do: dateCell_(r['Do']),
      status: textCell_(r['Status']).toLowerCase() || 'aktywna', uwagi: textCell_(r['Uwagi']) };
  });
  const opakowania = tO.rows.filter(function (r) { return !isEmpty_(r['ID']); }).map(function (r) {
    return { id: textCell_(r['ID']), pozycja: textCell_(r['Pozycja']), otwarto: dateCell_(r['Otwarto']), ilosc: numCell_(r['Ilość w opakowaniu']),
      wazneDo: dateCell_(r['Ważne do']), alertDni: numCell_(r['Alert (dni przed)']), skonczone: dateCell_(r['Skończone']), uwagi: textCell_(r['Uwagi']) };
  });

  const okno = [], starsze = [];
  tD.rows.forEach(function (r) {
    if (isEmpty_(r['ID']) || /cofni/i.test(String(r['Stan'] || ''))) return;
    const data = dateCell_(r['Data']);
    if (!data) return;
    const w = { id: textCell_(r['ID']), data: data, pozycja: textCell_(r['Pozycja']), status: textCell_(r['Status']).toLowerCase() };
    const godz = timeCell_(r['Godzina']), pora = textCell_(r['Pora']), il = numCell_(r['Ilość']), powod = textCell_(r['Powód']), notatka = textCell_(r['Notatka']);
    if (godz) w.godz = godz;
    if (pora) w.pora = pora;
    if (il !== null) w.ilosc = il;
    if (powod) w.powod = powod;
    if (notatka) w.notatka = notatka;
    if (boolCell_(r['Później'])) w.pozniej = true;
    (data >= od ? okno : starsze).push(w);
  });

  // zużycie zapasu sprzed okna: strona dolicza do niego wpisy z okna i te czekające w telefonie
  const ctx = Logika.przygotuj({ terapie: terapie, pozycje: pozycje, pory: pory, opakowania: opakowania });
  const stare = Logika.indeks(starsze);
  opakowania.forEach(function (o) {
    const p = ctx.pozMap[o.pozycja];
    if (!p) { warnings.push('Opakowanie ' + o.id + ' wskazuje pozycję „' + o.pozycja + '”, której nie ma w zakładce Pozycje.'); return; }
    if (!o.skonczone && o.otwarto && o.ilosc > 0 && o.otwarto < od) o.zuzytePrzed = Logika.zuzycie(stare, p, o.otwarto);
  });

  ctx.pozycje.forEach(function (p) {
    if (p.status !== 'aktywna') return;
    const kto = 'Pozycja „' + p.nazwa + '”';
    if (!p.od) warnings.push(kto + ' jest aktywna, ale nie ma daty „Od”, więc nie pojawia się w planie.');
    if (p.h.typ === 'blad') warnings.push(kto + ': nie rozumiem harmonogramu „' + p.harmonogram + '”.');
    if (p.h.typ === 'brak' && !p.dorazne) warnings.push(kto + ' nie ma harmonogramu.');
    if (p.h.typ !== 'brak' && p.h.typ !== 'blad' && !(p.dawka > 0)) warnings.push(kto + ' nie ma dawki. Do zapasu liczę 1 na podanie.');
    p.poryN.forEach(function (k) { if (!ctx.poryMap[k]) warnings.push(kto + ': pory „' + k + '” nie ma w zakładce Pory dnia.'); });
    if (p.terapia && !ctx.terapie[p.terapia]) warnings.push(kto + ' wskazuje terapię „' + p.terapia + '”, której nie ma w zakładce Terapie.');
  });
  if (tz_() !== 'Europe/Warsaw') warnings.push('Strefa czasowa skryptu to ' + tz_() + '. Ustaw Europe/Warsaw w ustawieniach projektu Apps Script.');

  return { generatedAt: new Date().toISOString(), version: CORE.VERSION, dzis: today, sheetUrl: ss.getUrl(),
    terapie: terapie, pozycje: pozycje, pory: pory, opakowania: opakowania, dziennik: { od: od, wpisy: okno },
    prefs: { reminders: remindersInfo_() }, warnings: warnings };
}

/* ============================ ZAPISY ============================ */

/** Po zapisie: kalendarz od razu wie, co odhaczone (bez czekania na wyzwalacz). Błąd kalendarza nie psuje zapisu. */
function afterWrite_() {
  try { if (remindersPrefs_().enabled) syncReminders_(false); }
  catch (e) { const r = remindersPrefs_(); r.error = authHint_(e); storeReminders_(r); }
}

/**
 * Odhaczenia: arg = { clientId, items: [{ data, pora, pozycja, status, ilosc, powod, pozniej, notatka, godz }] }.
 * ID wiersza = 'K' + clientId + '-' + numer, więc ponowienie z kolejki offline niczego nie dubluje.
 */
function logDose(arg) {
  const res = withLock_(function (ss) {
    const items = arg && Array.isArray(arg.items) ? arg.items : [];
    if (!items.length || items.length > 60) throw new Error('Brak wpisów do zapisania.');
    const tD = readTable_(ss, TABS.DZIENNIK), tP = readTable_(ss, TABS.POZYCJE);
    if (!tD.sh || !tP.sh) throw new Error('W arkuszu brakuje zakładki Dziennik albo Pozycje. Uruchom funkcję utworzArkusz.');
    const poz = {}, have = {};
    tP.rows.forEach(function (r) { poz[textCell_(r['ID'])] = r; });
    tD.rows.forEach(function (r) { have[textCell_(r['ID'])] = true; });
    const today = todayStr_(), min = Logika.plus(today, -370), max = Logika.plus(today, 1);
    const cid = String(arg.clientId || '');
    const base = /^[A-Za-z0-9_-]{8,40}$/.test(cid) ? 'K' + cid : 'W' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    const stamp = nowStamp_(), dev = WHO_ && WHO_.device ? WHO_.device.name : 'klucz główny';
    const rows = [];
    let dup = 0;
    items.forEach(function (it, i) {
      const id = base + '-' + i;
      if (have[id]) { dup++; return; }
      const p = poz[String(it && it.pozycja)];
      if (!p) throw new Error('W arkuszu nie ma pozycji „' + cleanText_(it && it.pozycja, 20) + '”.');
      const status = String(it.status || '');
      if (STATUSY.indexOf(status) < 0) throw new Error('Nieznany status wpisu.');
      if (!Logika.poprawnaData(it.data) || it.data < min || it.data > max) throw new Error('Niepoprawna data wpisu.');
      let il = '';
      if (status === 'wzięte' || status === 'doraźnie') {
        const dawka = numCell_(p['Dawka']);
        il = Number(it.ilosc);
        if (!(il >= 0 && il <= 100000) || it.ilosc === null || it.ilosc === undefined || it.ilosc === '') il = dawka > 0 ? dawka : 1;
      }
      rows.push(rowFor_(tD, {
        'ID': id, 'Zapisano': stamp, 'Data': it.data, 'Godzina': timeCell_(it.godz), 'Pora': status === 'doraźnie' ? '' : cleanText_(it.pora, 30),
        'Pozycja': textCell_(p['ID']), 'Nazwa': cleanText_(p['Nazwa'], 60), 'Status': status, 'Ilość': il,
        'Powód': status === 'pominięte' ? cleanText_(it.powod, 60) : '', 'Później': it.pozniej ? 'TAK' : '',
        'Notatka': cleanText_(it.notatka, 200), 'Urządzenie': dev, 'Stan': ''
      }));
    });
    appendRows_(tD.sh, rows);
    return { saved: rows.length, duplicate: dup };
  });
  afterWrite_();
  return res;
}

/** Cofnięcie wpisów: arg = { ids: [...] }. Wiersz zostaje w Dzienniku ze stanem „cofnięty” i nie liczy się nigdzie. */
function undoDose(arg) {
  const res = withLock_(function (ss) {
    const ids = arg && Array.isArray(arg.ids) ? arg.ids.map(String).slice(0, 100) : [];
    const tD = readTable_(ss, TABS.DZIENNIK);
    if (!tD.sh) throw new Error('W arkuszu brakuje zakładki Dziennik.');
    const c = colIdx_(tD, 'Stan');
    let n = 0;
    tD.rows.forEach(function (r) {
      if (ids.indexOf(textCell_(r['ID'])) < 0 || /cofni/i.test(String(r['Stan'] || ''))) return;
      tD.sh.getRange(r._row, c).setValue('cofnięty');
      n++;
    });
    return { undone: n };
  });
  afterWrite_();
  return res;
}

/** „Skończyło się”: arg = { id, data, nowe: { ilosc, wazneDo } | null }. Z „nowe” od razu otwiera kolejne opakowanie. */
function finishPackage(arg) {
  const res = withLock_(function (ss) {
    const tO = readTable_(ss, TABS.OPAKOWANIA);
    if (!tO.sh) throw new Error('W arkuszu brakuje zakładki Opakowania.');
    const o = tO.rows.filter(function (r) { return textCell_(r['ID']) === String(arg && arg.id); })[0];
    if (!o) throw new Error('Nie znalazłem tego opakowania.');
    if (dateCell_(o['Skończone'])) return { already: true };
    const today = todayStr_(), otw = dateCell_(o['Otwarto']);
    let data = Logika.poprawnaData(arg.data) ? arg.data : today;
    if (data > today) data = today;
    if (otw && data < otw) data = otw;
    tO.sh.getRange(o._row, colIdx_(tO, 'Skończone')).setValue(data);
    if (!arg.nowe) return {};
    const il = Number(arg.nowe.ilosc), id = nextId_(tO.rows, 'O');
    appendRows_(tO.sh, [rowFor_(tO, { 'ID': id, 'Pozycja': textCell_(o['Pozycja']), 'Otwarto': data, 'Ilość w opakowaniu': il > 0 && il <= 100000 ? il : '',
      'Ważne do': Logika.poprawnaData(arg.nowe.wazneDo) ? arg.nowe.wazneDo : '', 'Alert (dni przed)': numCell_(o['Alert (dni przed)']) === null ? '' : numCell_(o['Alert (dni przed)']),
      'Skończone': '', 'Uwagi': '' })]);
    return { opened: id };
  });
  afterWrite_();
  return res;
}

/** „Zaczynam od dziś”: pozycja planowana dostaje datę „Od” i status „aktywna”. arg = { id }. */
function startPosition(arg) {
  const res = withLock_(function (ss) {
    const tP = readTable_(ss, TABS.POZYCJE);
    if (!tP.sh) throw new Error('W arkuszu brakuje zakładki Pozycje.');
    const p = tP.rows.filter(function (r) { return textCell_(r['ID']) === String(arg && arg.id); })[0];
    if (!p) throw new Error('Nie znalazłem tej pozycji.');
    if (textCell_(p['Status']).toLowerCase() !== 'planowana') return { already: true };
    const h = Logika.harmonogram(textCell_(p['Harmonogram']));
    if (h.typ === 'blad' || (h.typ === 'brak' && !boolCell_(p['Doraźnie']))) throw new Error('Najpierw uzupełnij w arkuszu harmonogram tej pozycji.');
    tP.sh.getRange(p._row, colIdx_(tP, 'Od')).setValue(todayStr_());
    tP.sh.getRange(p._row, colIdx_(tP, 'Status')).setValue('aktywna');
    return { started: textCell_(p['ID']) };
  });
  afterWrite_();
  return res;
}

/* ============================ PRZYPOMNIENIA W KALENDARZU GOOGLE ============================ */
/*
 * Osobny kalendarz „Zdrowie – przypomnienia”. Jedno wydarzenie na porę dnia („🌅 Rano: …”) na 7 dni do przodu,
 * z powiadomieniem o godzinie pory. Gdy wszystko z pory jest odhaczone, wydarzenie znika; gdy zostało coś,
 * tytuł pokazuje tylko to, co zostało. Zapasy: wydarzenie o 9:00 na tyle dni przed końcem, ile ma „Alert (dni przed)”.
 * Powiadomienia na telefonie wysyła aplikacja Kalendarz Google.
 * Pierwsze włączenie: w edytorze uruchom wlaczPrzypomnienia (zgoda na dostęp do Kalendarza).
 */
const CAL_NAME = 'Zdrowie – przypomnienia';
const PORA_EMOJI = { 'rano': '🌅', 'w ciągu dnia': '☀️', 'południe': '☀️', 'wieczór': '🌙', 'noc': '🌙' };

function remindersPrefs_() {
  const r = readPrefs_('REMINDERS', {});
  return { enabled: !!r.enabled, lastSync: r.lastSync || null, error: r.error || null, count: r.count || 0 };
}
function remindersInfo_() { const r = remindersPrefs_(); r.calendar = CAL_NAME; return r; }
function storeReminders_(r) { PropertiesService.getScriptProperties().setProperty('REMINDERS', JSON.stringify(r)); }

function authHint_(e) {
  const m = String(e && e.message || e);
  return /authoriz|autoryz|uprawnie|permission|scopes/i.test(m)
    ? 'Skrypt nie ma jeszcze dostępu do Kalendarza. W edytorze Apps Script uruchom raz funkcję wlaczPrzypomnienia i zatwierdź uprawnienia.'
    : m;
}

/** Włącznik z Ustawień aplikacji: arg = { enabled }. */
function saveReminders(arg) {
  const r = remindersPrefs_();
  r.enabled = !!(arg && arg.enabled);
  r.error = null;
  storeReminders_(r);
  try {
    setReminderTrigger_(r.enabled);
    syncReminders_(true);
  } catch (e) {
    const x = remindersPrefs_(); x.error = authHint_(e); storeReminders_(x);
  }
  invalidateModel_();
  return JSON.stringify({ ok: true, model: JSON.parse(cachedModelJson_(true)) });
}

function setReminderTrigger_(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'odswiezPrzypomnienia') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('odswiezPrzypomnienia').timeBased().everyMinutes(15).create();
}

/** Uruchom raz w edytorze (Uruchom → wlaczPrzypomnienia): zatwierdzasz dostęp do Kalendarza, a przypomnienia się włączają. */
function wlaczPrzypomnienia() {
  const r = remindersPrefs_(); r.enabled = true; r.error = null; storeReminders_(r);
  setReminderTrigger_(true);
  syncReminders_(true);
  invalidateModel_();
  Logger.log('Przypomnienia włączone. Wydarzenia są w kalendarzu „' + CAL_NAME + '”. Liczba: ' + remindersPrefs_().count);
}

/** Uruchom w edytorze, żeby wyłączyć przypomnienia i wyczyścić kalendarz z wydarzeń aplikacji. */
function wylaczPrzypomnienia() {
  const r = remindersPrefs_(); r.enabled = false; r.error = null; storeReminders_(r);
  setReminderTrigger_(false);
  syncReminders_(true);
  invalidateModel_();
  Logger.log('Przypomnienia wyłączone.');
}

/** Wywoływane przez wyzwalacz co 15 minut. */
function odswiezPrzypomnienia() {
  try { syncReminders_(false); } catch (e) { const r = remindersPrefs_(); r.error = authHint_(e); storeReminders_(r); }
}

function reminderCalendar_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CAL_ID');
  let cal = null;
  if (id) { try { cal = CalendarApp.getCalendarById(id); } catch (e) { cal = null; } }
  if (!cal) {
    cal = CalendarApp.createCalendar(CAL_NAME, { summary: 'Przypomnienia z aplikacji Zdrowie. Wydarzenia tworzy i usuwa skrypt.', color: CalendarApp.Color.TEAL });
    props.setProperty('CAL_ID', cal.getId());
  }
  return cal;
}

/** Wydarzenia, które powinny teraz być w kalendarzu: { znacznik: { title, start, desc, late } }. */
function remindersWanted_(today) {
  const want = {};
  const model = JSON.parse(cachedModelJson_(false));
  const ctx = Logika.przygotuj(model), idx = Logika.indeks(model.dziennik.wpisy);
  const at = function (iso, hm) { const p = String(iso).split('-').map(Number), t = String(hm || '09:00').split(':').map(Number); return new Date(p[0], p[1] - 1, p[2], t[0] || 0, t[1] || 0, 0); };
  Logika.przypomnienia(ctx, idx, today, 7).forEach(function (x) {
    const nazwa = x.nazwa.charAt(0).toUpperCase() + x.nazwa.slice(1);
    want['pora:' + x.data + ':' + x.klucz] = { title: (PORA_EMOJI[x.klucz] || '⏰') + ' ' + nazwa + ': ' + x.nazwy.join(', '), start: at(x.data, x.godzina),
      desc: 'Odhacz w aplikacji Zdrowie. Gdy wszystko z tej pory jest odhaczone, wydarzenie znika.' };
  });
  Logika.zapasy(ctx, idx, today).forEach(function (z) {
    if (!z.koniec) return;
    const dni = z.opak.alertDni >= 0 && z.opak.alertDni !== null ? z.opak.alertDni : 14;
    const kiedy = Logika.plus(z.koniec, -dni), late = kiedy < today;
    want['zapas:' + z.opak.id] = { late: late, start: at(late ? today : kiedy, '09:00'),
      title: '📦 ' + z.p.nazwa + ': ' + (z.p.rodzaj === 'lek' ? 'załatw receptę' : 'kup nowe opakowanie') + ' (wystarczy do ' + Logika.dataPl(z.koniec, today) + ')',
      desc: z.powod === 'waznosc' ? 'Opakowanie traci ważność ' + Logika.dataPl(z.koniec, today) + '.' : 'Według odhaczeń zapas skończy się około ' + Logika.dataPl(z.koniec, today) + '.' };
  });
  return want;
}

function syncReminders_(force) {
  const props = PropertiesService.getScriptProperties();
  const r = remindersPrefs_();
  if (!r.enabled && !props.getProperty('CAL_ID')) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return;
  try {
    const now = new Date(), today = todayStr_();
    const want = r.enabled ? remindersWanted_(today) : {};
    // nic się nie zmieniło od ostatniego razu: nie ruszamy Kalendarza (wyzwalacz chodzi 96 razy na dobę)
    const all = sha256_(today + JSON.stringify(Object.keys(want).sort().map(function (k) { return [k, want[k].title, want[k].start.getTime()]; })));
    const cache = CacheService.getScriptCache();
    if (!force && cache.get('rem_sig') === all) return;
    const cal = reminderCalendar_();
    const existing = {};
    cal.getEvents(new Date(now.getTime() - 60 * 864e5), new Date(now.getTime() + 120 * 864e5)).forEach(function (ev) {
      const m = String(ev.getDescription() || '').match(/\[zdrowie:([^\]]+)\]/);
      if (!m) return;
      if (existing[m[1]]) ev.deleteEvent(); else existing[m[1]] = ev;
    });
    Object.keys(existing).forEach(function (tag) { if (!want[tag]) existing[tag].deleteEvent(); });
    Object.keys(want).forEach(function (tag) {
      const w = want[tag], ev = existing[tag];
      if (w.late && ev) return;                                  // przypomnienie o zapasie już było; nie przesuwamy go co dzień
      const sig = sha256_(w.title + '|' + w.start.getTime()).slice(0, 12);
      const desc = w.desc + '\n\n[zdrowie:' + tag + '] [sig:' + sig + ']';
      const end = new Date(w.start.getTime() + 15 * 60000);
      if (ev) {
        if (String(ev.getDescription() || '').indexOf('[sig:' + sig + ']') >= 0) return;   // bez zmian
        ev.setTitle(w.title); ev.setTime(w.start, end); ev.setDescription(desc);
        return;
      }
      const e = cal.createEvent(w.title, w.start, end, { description: desc });
      e.removeAllReminders();
      try { e.addPopupReminder(0); } catch (err) { e.addPopupReminder(5); }
    });
    cache.put('rem_sig', all, 21600);
    const x = remindersPrefs_();
    x.lastSync = now.toISOString(); x.error = null; x.count = Object.keys(want).length;
    storeReminders_(x);
  } finally {
    lock.releaseLock();
  }
}

/* ============================ PIERWSZE URUCHOMIENIE: ZAKŁADKI I DANE STARTOWE ============================ */

/**
 * Uruchom raz w edytorze (Uruchom → utworzArkusz). Tworzy brakujące zakładki i nagłówki. Jeśli w projekcie jest plik
 * DaneStartowe.gs (zmienna DANE_STARTOWE), wypełnia puste zakładki danymi z niego. Zakładek z danymi nie rusza,
 * więc można uruchamiać wiele razy.
 */
function utworzArkusz() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = [];
  try { ss.setSpreadsheetTimeZone('Europe/Warsaw'); } catch (e) { /* zostaje strefa arkusza */ }
  Object.keys(TABS).forEach(function (k) {
    const t = TABS[k];
    let sh = ss.getSheetByName(t.name);
    if (!sh) { sh = ss.insertSheet(t.name); log.push('nowa zakładka „' + t.name + '”'); }
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, t.head.length).setValues([t.head]);
    } else {
      const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
      t.head.forEach(function (h) {
        if (head.indexOf(h.toLowerCase()) >= 0) return;
        sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
        log.push('nowa kolumna „' + h + '” w zakładce „' + t.name + '”');
      });
    }
    try {
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
      const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
      t.text.forEach(function (h) {
        const c = head.indexOf(h.toLowerCase());
        if (c >= 0) sh.getRange(1, c + 1, sh.getMaxRows(), 1).setNumberFormat('@');   // daty i godziny jako tekst: arkusz ich nie przerabia
      });
    } catch (e) { /* formatowanie jest opcjonalne */ }
  });
  devicesSheet_();
  const dane = typeof DANE_STARTOWE !== 'undefined' ? DANE_STARTOWE : null;
  if (dane) seedSheet_(ss, dane, log);
  else log.push('bez danych startowych (w projekcie nie ma pliku DaneStartowe.gs), zakładki zostają puste');
  ['Arkusz1', 'Sheet1'].forEach(function (n) {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) { ss.deleteSheet(sh); log.push('usunięta pusta zakładka „' + n + '”'); }
  });
  invalidateModel_();
  const warnings = buildModel_().warnings;
  Logger.log('Arkusz gotowy: ' + (log.length ? log.join('; ') : 'nic do zrobienia') + '.' + (warnings.length ? '\nUwagi:\n- ' + warnings.join('\n- ') : ''));
}

/** Wypełnia puste zakładki danymi startowymi (ten sam układ co dane-startowe.json). */
function seedSheet_(ss, dane, log) {
  const fill = function (tab, rows) {
    const t = readTable_(ss, tab);
    if (t.rows.length) { log.push('„' + tab.name + '” ma już dane, zostaje bez zmian'); return; }
    if (!rows.length) return;
    appendRows_(t.sh, rows.map(function (o) { return rowFor_(t, o); }));
    log.push('„' + tab.name + '”: ' + rows.length + ' wierszy');
  };
  const nz = function (v) { return v === null || v === undefined ? '' : v; };
  const uwagi = function (x) { return [nz(x.uwagi), x.doUstalenia ? 'Do ustalenia: ' + x.doUstalenia : ''].filter(Boolean).join('. '); };
  fill(TABS.PORY, (dane.poryDnia || []).map(function (x) {
    return { 'Nazwa': x.nazwa, 'Godzina': nz(x.godzina), 'Godzina w weekend': nz(x.godzinaWeekend), 'Kolejność': nz(x.kolejnosc) };
  }));
  fill(TABS.TERAPIE, (dane.terapie || []).map(function (x) {
    return { 'ID': x.id, 'Nazwa': nz(x.nazwa), 'Lekarz': nz(x.lekarz), 'Specjalizacja': nz(x.specjalizacja), 'Od': nz(x.od), 'Do': nz(x.do), 'Kolor': nz(x.kolor), 'Uwagi': uwagi(x) };
  }));
  fill(TABS.POZYCJE, (dane.pozycje || []).map(function (x) {
    return { 'ID': x.id, 'Terapia': nz(x.terapia), 'Nazwa': nz(x.nazwa), 'Rodzaj': nz(x.rodzaj), 'Postać': nz(x.postac), 'Dawka': nz(x.dawka), 'Jednostka': nz(x.jednostka),
      'Harmonogram': nz(x.harmonogram), 'Pory': nz(x.pory), 'Doraźnie': x.dorazne ? 'TAK' : '', 'Warunki': nz(x.warunki), 'Od': nz(x.od), 'Do': nz(x.do),
      'Status': nz(x.status) || 'aktywna', 'Uwagi': uwagi(x) };
  }));
  fill(TABS.OPAKOWANIA, (dane.opakowania || []).map(function (x) {
    return { 'ID': x.id, 'Pozycja': x.pozycja, 'Otwarto': nz(x.otwarto), 'Ilość w opakowaniu': nz(x.ilosc !== undefined ? x.ilosc : x.dawek), 'Ważne do': nz(x.wazneDo),
      'Alert (dni przed)': nz(x.alertDni), 'Skończone': nz(x.skonczone), 'Uwagi': uwagi(x) };
  }));
  // dziennik wstecz: pojedyncze wpisy { data, pozycja, pora, status } albo zakres { od, do, pozycja, pory: [...] }
  const poz = {};
  (dane.pozycje || []).forEach(function (p) { poz[p.id] = p; });
  const stamp = nowStamp_(), wpisy = [];
  (dane.dziennikWstecz || []).forEach(function (x) {
    if (!x || !x.pozycja || !poz[x.pozycja]) return;
    const dni = [];
    if (x.od && x.do) { for (let d = x.od; d <= x.do; d = Logika.plus(d, 1)) dni.push(d); } else if (x.data) dni.push(x.data);
    dni.forEach(function (d) {
      (x.pory || [x.pora || '']).forEach(function (pora) {
        const p = poz[x.pozycja], status = x.status || 'wzięte';
        wpisy.push({ 'ID': 'S' + (wpisy.length + 1), 'Zapisano': stamp, 'Data': d, 'Godzina': '', 'Pora': status === 'doraźnie' ? '' : pora, 'Pozycja': p.id, 'Nazwa': nz(p.nazwa),
          'Status': status, 'Ilość': status === 'wzięte' || status === 'doraźnie' ? (x.ilosc > 0 ? x.ilosc : (p.dawka > 0 ? p.dawka : 1)) : '',
          'Powód': '', 'Później': 'TAK', 'Notatka': nz(x.uwagi), 'Urządzenie': 'dane startowe', 'Stan': '' });
      });
    });
  });
  fill(TABS.DZIENNIK, wpisy);
}
