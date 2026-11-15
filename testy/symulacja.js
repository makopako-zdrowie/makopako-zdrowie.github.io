/* Symulowany Apps Script do testów: arkusz w pamięci, ustawienia skryptu, pamięć podręczna, blokada, kalendarz i wyzwalacze.
   Wczytuje prawdziwy apps-script/Code.gs i pozwala wywoływać doPost tak jak strona. Tylko dane fikcyjne. */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

function fmt(d, tz, pattern) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return pattern.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
}

class Range {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  _check() { if (this.r + this.nr - 1 > this.sh.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.'); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh._get(this.r + i, this.c + j)); out.push(row); } return out; }
  getDisplayValues() { return this.getValues().map(r => r.map(v => (v instanceof Date ? v.toISOString() : String(v)))); }
  setValues(v) {
    this._check();
    if (v.length !== this.nr || v.some(r => r.length !== this.nc)) throw new Error('The number of rows/columns in the data does not match the range.');
    v.forEach((row, i) => row.forEach((x, j) => this.sh._set(this.r + i, this.c + j, x)));
    return this;
  }
  setValue(x) { this._check(); this.sh._set(this.r, this.c, x); return this; }
  setFontWeight() { return this; }
  setNumberFormat(f) { for (let j = 0; j < this.nc; j++) this.sh.formats[this.c + j] = f; return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.maxRows = 1000; this.formats = {}; }
  _get(r, c) { const row = this.rows[r - 1]; const v = row ? row[c - 1] : ''; return v === undefined ? '' : v; }
  _set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    // jak w Arkuszach: tekst wyglądający na datę w kolumnie bez formatu „zwykły tekst” staje się datą
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && this.formats[c] !== '@') v = new Date(v + 'T00:00:00');
    if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
    row[c - 1] = v;
  }
  getName() { return this.name; }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some(v => v !== '' && v !== null && v !== undefined)) return i; return 0; }
  getLastColumn() { return this.rows.reduce((m, r) => { let n = r.length; while (n > 0 && (r[n - 1] === '' || r[n - 1] === undefined)) n--; return Math.max(m, n); }, 0); }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') { return new Range(this, 1, 1, 1, 1); }
    return new Range(this, a, b, c || 1, d || 1);
  }
  appendRow(row) { const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; row.forEach((v, j) => this._set(r, j + 1, v)); return this; }
  setFrozenRows() {}
}

function utworzSrodowisko(opts) {
  opts = opts || {};
  const tz = opts.tz || 'Europe/Warsaw';
  const sheets = [];
  const props = {}, cache = {};
  const kalendarz = { utworzony: false, zdarzenia: [], id: 'cal-test' };
  const wyzwalacze = [];
  const dziennik = [];
  let uuid = 0;
  const ss = {
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: n => { const s = new Sheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: s => { sheets.splice(sheets.indexOf(s), 1); },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST/edit',
    getSpreadsheetTimeZone: () => tz, setSpreadsheetTimeZone: () => {}
  };
  if (opts.pustyArkusz1) ss.insertSheet('Arkusz1');
  class Zdarzenie {
    constructor(title, start, end, o) { this.title = title; this.start = start; this.end = end; this.desc = (o && o.description) || ''; this.przyp = [30]; this.usuniete = false; }
    getDescription() { return this.desc; } setDescription(d) { this.desc = d; }
    getTitle() { return this.title; } setTitle(t) { this.title = t; }
    setTime(s, e) { this.start = s; this.end = e; }
    deleteEvent() { this.usuniete = true; kalendarz.zdarzenia.splice(kalendarz.zdarzenia.indexOf(this), 1); }
    removeAllReminders() { this.przyp = []; }
    addPopupReminder(m) { if (opts.popupMin5 && m < 5) throw new Error('Reminder must be at least 5 minutes'); this.przyp.push(m); }
  }
  const cal = {
    getId: () => kalendarz.id,
    getEvents: (a, b) => kalendarz.zdarzenia.filter(e => e.start >= a && e.start <= b),
    createEvent: (t, s, e, o) => { const z = new Zdarzenie(t, s, e, o); kalendarz.zdarzenia.push(z); kalendarz.utworzono = (kalendarz.utworzono || 0) + 1; return z; }
  };
  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({
      get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; },
      putAll: o => { Object.keys(o).forEach(k => { cache[k] = String(o[k]); }); }, getAll: keys => { const o = {}; keys.forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; }
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => { uuid++; return crypto.createHash('md5').update('u' + uuid + Math.random()).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'); },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      formatDate: (d, zone, pattern) => fmt(d, zone, pattern)
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ _text: s, setMimeType() { return this; }, getContent() { return this._text; } }) },
    Session: { getScriptTimeZone: () => tz },
    Logger: { log: s => { dziennik.push(String(s)); } },
    CalendarApp: {
      Color: { TEAL: 'teal', RED: 'red' },
      getCalendarById: id => { if (opts.brakZgodyNaKalendarz) throw new Error('You do not have permission to call CalendarApp.getCalendarById. Required permissions'); return kalendarz.utworzony && id === kalendarz.id ? cal : null; },
      createCalendar: () => { if (opts.brakZgodyNaKalendarz) throw new Error('You do not have permission to call CalendarApp.createCalendar. Required permissions'); kalendarz.utworzony = true; return cal; }
    },
    ScriptApp: {
      getProjectTriggers: () => wyzwalacze.slice(), deleteTrigger: t => { wyzwalacze.splice(wyzwalacze.indexOf(t), 1); },
      newTrigger: fn => ({ timeBased() { return this; }, everyMinutes(m) { this.min = m; return this; }, everyHours(h) { this.min = h * 60; return this; },
        create() { const t = { getHandlerFunction: () => fn, min: this.min }; wyzwalacze.push(t); return t; } })
    }
  };
  if (opts.teraz) {                                   // zamrożony zegar skryptu
    const Prawdziwa = Date, t0 = new Prawdziwa(opts.teraz).getTime();
    sandbox.Date = class extends Prawdziwa { constructor(...a) { if (a.length) super(...a); else super(t0); } static now() { return t0; } };
  }
  vm.createContext(sandbox);
  const kod = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(kod + '\n;this.__api = { doPost, doGet, utworzKlucz, utworzArkusz, wlaczPrzypomnienia, wylaczPrzypomnienia, odswiezPrzypomnienia, odlaczWszystkieUrzadzenia, buildModel_, onEdit, Logika, TABS };', sandbox, { filename: 'Code.gs' });
  if (opts.daneStartowe) vm.runInContext('var DANE_STARTOWE = ' + JSON.stringify(opts.daneStartowe) + ';', sandbox);
  const api = sandbox.__api;
  const post = body => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  return {
    api, post, ss, sheets, props, cache, kalendarz, wyzwalacze, dziennik, sandbox,
    arkusz: n => ss.getSheetByName(n),
    wiersze: n => { const s = ss.getSheetByName(n); if (!s) return []; const h = s.rows[0]; return s.rows.slice(1).filter(r => r.some(v => v !== '')).map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i] === undefined ? '' : r[i]; }); return o; }); },
    /** Pierwsze urządzenie: klucz → przepustka. Zwraca funkcję call(fn, arg). */
    polacz(nazwa) {
      const key = props.API_KEY || api.utworzKlucz();
      const r = post({ key, fn: 'register', arg: { name: nazwa || 'Telefon testowy', desc: 'Android 16, test' } });
      if (!r.ok) throw new Error(r.error);
      return (fn, arg) => post({ token: r.token, fn, arg });
    }
  };
}

/* Fikcyjne dane startowe: daty liczone od podanego „dziś”, nazwy zmyślone. */
function fikcyjneDane(dzis) {
  const L = require('../logika.js'), d = k => L.plus(dzis, k);
  return {
    poryDnia: [
      { nazwa: 'rano', godzina: '07:30', godzinaWeekend: '09:00', kolejnosc: 1 },
      { nazwa: 'w ciągu dnia', godzina: '13:00', godzinaWeekend: '13:00', kolejnosc: 2 },
      { nazwa: 'wieczór', godzina: '21:30', godzinaWeekend: '22:00', kolejnosc: 3 }
    ],
    terapie: [
      { id: 'T1', nazwa: 'Kardiologia', lekarz: 'dr Przykładowa', specjalizacja: 'kardiolog', od: d(-60), do: null, kolor: '#4fa3e0', uwagi: '' },
      { id: 'T2', nazwa: 'Dermatologia', lekarz: 'dr Testowy', specjalizacja: 'dermatolog', od: d(-20), do: null, kolor: '#c0567a', uwagi: '' }
    ],
    pozycje: [
      { id: 'P1', terapia: 'T1', nazwa: 'Testolek', rodzaj: 'lek', postac: 'inhalator', dawka: 1, jednostka: 'wdech', harmonogram: 'codziennie', pory: 'rano+wieczór', dorazne: true, warunki: '', od: d(-10), do: null, status: 'aktywna', uwagi: '' },
      { id: 'P2', terapia: 'T1', nazwa: 'Staryl', rodzaj: 'lek', postac: 'tabletka', dawka: 1, jednostka: 'tabletka', harmonogram: 'codziennie', pory: 'rano', dorazne: false, warunki: '', od: d(-60), do: d(-11), status: 'zakończona', uwagi: 'zastąpiony' },
      { id: 'P3', terapia: 'T2', nazwa: 'Witamina Fikcyjna', rodzaj: 'suplement', postac: 'krople', dawka: 2, jednostka: 'kropla', harmonogram: 'codziennie', pory: 'rano', dorazne: false, warunki: 'po posiłku', od: d(-5), do: null, status: 'aktywna', uwagi: '' },
      { id: 'P4', terapia: 'T2', nazwa: 'Maść Próbna', rodzaj: 'kosmetyk', postac: 'maść', dawka: 0.5, jednostka: 'ampułki', harmonogram: 'co 2 dni', pory: 'wieczór', dorazne: false, warunki: '', od: d(-4), do: null, status: 'aktywna', uwagi: '' },
      { id: 'P5', terapia: 'T2', nazwa: 'Peeling Zmyślony', rodzaj: 'kosmetyk', postac: 'peeling', dawka: 1, jednostka: 'zabieg', harmonogram: '1x/tydz nd', pory: 'w ciągu dnia', dorazne: false, warunki: '', od: d(-14), do: null, status: 'aktywna', uwagi: '' },
      { id: 'P6', terapia: 'T2', nazwa: 'Suplement Planowany', rodzaj: 'suplement', postac: 'tabletka', dawka: 1, jednostka: 'tabletka', harmonogram: 'codziennie', pory: 'rano', dorazne: false, warunki: 'nie z kawą', od: null, do: null, status: 'planowana', uwagi: 'do kupienia' },
      { id: 'P7', terapia: 'T2', nazwa: 'Kuracja Nieustalona', rodzaj: 'lek', postac: 'tabletka', dawka: null, jednostka: 'tabletka', harmonogram: null, pory: null, dorazne: false, warunki: '', od: null, do: null, status: 'planowana', uwagi: '', doUstalenia: 'wszystko po wizycie' }
    ],
    opakowania: [
      { id: 'O1', pozycja: 'P1', otwarto: d(-10), ilosc: 60, wazneDo: d(80), alertDni: 14, skonczone: null, uwagi: '' },
      { id: 'O2', pozycja: 'P3', otwarto: d(-5), ilosc: null, wazneDo: null, alertDni: 7, skonczone: null, uwagi: 'butelka, liczba porcji nieznana' },
      { id: 'O3', pozycja: 'P4', otwarto: d(-4), ilosc: 10, wazneDo: null, alertDni: 10, skonczone: null, uwagi: '' }
    ],
    dziennikWstecz: [
      { od: d(-10), do: d(-3), pozycja: 'P1', pory: ['rano', 'wieczór'], status: 'wzięte' },
      { od: d(-5), do: d(-2), pozycja: 'P3', pora: 'rano', status: 'wzięte' },
      { data: d(-4), pozycja: 'P4', pora: 'wieczór', status: 'wzięte' }
    ]
  };
}

module.exports = { utworzSrodowisko, fikcyjneDane, fmt };
