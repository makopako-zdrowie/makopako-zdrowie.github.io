/****************************************************************
 * ZDROWIE – rdzeń strony (wydzielony z Finansów v19, 15.11.2026)
 *
 * Kolejność plików w index.html: config.js (SCRIPT_URL) → rdzen.js → app.js.
 * app.js definiuje:
 *   window.CLIENT_VERSION = '0.1';
 *   window.startApp = model => ({ apply(model) {…} });   // rysuje ekrany, zwraca apply do podmiany modelu
 * i na końcu wywołuje:  Rdzen.boot();
 *
 * Strona musi mieć elementy: #app (treść), #sync (pasek komunikatów), #abSub (podtytuł w pasku aplikacji),
 * oraz ikonę icons/icon-192.png (ekran łączenia).
 *
 * Co daje rdzeń:
 *   Rdzen.api(fn, arg)            – zapytanie do Apps Script (POST text/plain, przepustka w treści)
 *   Rdzen.outbox.add(fn, arg, label) – zapis natychmiast do kolejki na urządzeniu, wysyłka w tle (clientId w arg)
 *   Rdzen.outbox.list() / remove(cid) / flush()
 *   Rdzen.devices(ctx)            – panel „Urządzenia” (lista, zmiana nazwy, usuwanie, parowanie kodem)
 *   Rdzen.saveCache(model), Rdzen.forgetDevice()
 ****************************************************************/
(function () {
  'use strict';
  const P = 'zdrowie.';                      // prefiks kluczy w localStorage (inna domena niż Finanse, ale i tak osobne nazwy)
  const CONN = P + 'conn', CACHE = P + 'cache', OUTBOX = P + 'outbox', KNOWN = P + 'knownDevices';
  const major = v => String(v || '').split('.')[0];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bez pamięci przeglądarki */ } };

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installPrompt = e; });

  /* ================= połączenie ================= */
  const getConn = () => { const c = read(CONN); return c && c.url && (c.token || c.key) ? c : null; };
  const saveConn = c => write(CONN, c.token ? { url: c.url, token: c.token, id: c.id, at: Date.now() } : { url: c.url, key: c.key, at: Date.now() });
  const forgetDevice = () => { try { [CONN, CACHE, KNOWN].forEach(k => localStorage.removeItem(k)); } catch (e) { /* bez pamięci */ } };

  /** Opis urządzenia do listy „Urządzenia”: system, model (jeśli przeglądarka go poda) i przeglądarka. */
  async function deviceInfo() {
    const ua = navigator.userAgent || '';
    const uad = navigator.userAgentData;
    let os = '', model = '', mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
    if (uad && uad.getHighEntropyValues) {
      try {
        const h = await uad.getHighEntropyValues(['model', 'platformVersion']);
        mobile = !!uad.mobile || mobile;
        const pv = parseInt(String(h.platformVersion || '').split('.')[0], 10);
        if (uad.platform === 'Windows') os = pv >= 13 ? 'Windows 11' : (pv > 0 ? 'Windows 10' : 'Windows');
        else if (uad.platform === 'Android') os = 'Android' + (pv ? ' ' + pv : '');
        else if (uad.platform === 'macOS') os = 'macOS';
        else os = uad.platform || '';
        model = String(h.model || '').trim();
      } catch (e) { /* bez szczegółów */ }
    }
    if (!os) {
      const m = ua.match(/Android (\d+)/); if (m) os = 'Android ' + m[1];
      else if (/iPhone|iPad/.test(ua)) os = /iPad/.test(ua) ? 'iPadOS' : 'iOS';
      else if (/Windows NT 10/.test(ua)) os = 'Windows 10 lub 11';
      else if (/Mac OS X/.test(ua)) os = 'macOS';
      else if (/Linux/.test(ua)) os = 'Linux';
    }
    if (!model) { const m = ua.match(/Android [\d.]+; ([^;)]+)\)/); if (m && m[1] !== 'K') model = m[1].trim(); }
    let browser = navigator.brave ? 'Brave' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'przeglądarka';
    if (window.matchMedia && matchMedia('(display-mode: standalone)').matches) browser += ', zainstalowana';
    const desc = [os, model, browser].filter(Boolean).join(', ');
    const name = mobile ? (/iPad|tablet/i.test(ua) ? 'Tablet' : 'Telefon') : 'Komputer';
    return { desc, name, mobile };
  }

  /** Zapytanie do skryptu: POST jako text/plain (bez zapytania wstępnego CORS), przepustka w treści, nie w adresie. */
  function api(fn, arg, conn) {
    conn = conn || getConn();
    if (!conn || !conn.url) return Promise.reject(Object.assign(new Error('To urządzenie nie jest połączone z arkuszem.'), { auth: true }));
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), 45000);
    const body = Object.assign(conn.token ? { token: conn.token } : { key: conn.key || '' }, { fn, arg: arg === undefined ? null : arg });
    return fetch(conn.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined, cache: 'no-store', redirect: 'follow' })
      .then(r => { if (!r.ok) throw new Error('Skrypt odpowiedział błędem ' + r.status + '.'); return r.text(); })
      .then(t => {
        let j;
        try { j = JSON.parse(t); } catch (e) { throw new Error(/<html/i.test(t) ? 'Skrypt nie działa jeszcze jako źródło danych. Sprawdź, czy wdrożenie ma dostęp „Każdy” i nową wersję kodu.' : 'Niepoprawna odpowiedź skryptu.'); }
        if (j && j.ok === false && j.auth) throw Object.assign(new Error(j.error || 'Brak dostępu.'), { auth: true, revoked: !!j.revoked });
        return j;
      }, e => {
        if (e && e.name === 'AbortError') throw new Error('Arkusz nie odpowiedział w ciągu 45 sekund. Spróbuj ponownie.');
        if (e instanceof TypeError) throw new Error('Nie udało się połączyć ze skryptem. Sprawdź internet albo adres skryptu.');
        throw e;
      })
      .finally(() => clearTimeout(timer));
  }

  /* ================= kolejka offline ================= */
  /*
   * Każda operacja zapisu (np. odhaczenie dawki) trafia najpierw tutaj i od razu jest widoczna w aplikacji.
   * Wysyłka w tle: od razu, po powrocie internetu, po powrocie do aplikacji i co minutę przy błędach sieci.
   * arg.clientId = cid – skrypt zapisuje taki wpis tylko raz, nawet gdy przyjdzie dwa razy.
   * Błąd zwrócony przez skrypt (r.ok === false) oznacza wpis jako „error”: nie ponawiamy, użytkownik go poprawia albo usuwa.
   */
  const outboxListeners = [];
  const outbox = {
    list: () => read(OUTBOX) || [],
    save: list => write(OUTBOX, list),
    newCid: () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 20),
    add(fn, arg, label) {
      const cid = outbox.newCid();
      const list = outbox.list();
      list.push({ cid, fn, arg: Object.assign({}, arg, { clientId: cid }), label: label || '', at: Date.now() });
      outbox.save(list);
      setTimeout(outbox.flush, 0);
      return cid;
    },
    remove(cid) { outbox.save(outbox.list().filter(x => x.cid !== cid)); },
    /** Słuchacz: fn({ sent: [{item, res}], failed: [{item, error}], model }) po każdej wysyłce. */
    onChange(fn) { outboxListeners.push(fn); },
    _busy: false, _timer: null,
    async flush() {
      if (outbox._busy || navigator.onLine === false || !getConn()) return;
      const todo = outbox.list().filter(x => !x.error);
      if (!todo.length) return;
      outbox._busy = true; document.body.classList.add('syncing');
      const sent = [], failed = []; let model = null;
      try {
        for (const it of todo) {
          let r;
          try { r = await api(it.fn, it.arg); } catch (err) { if (err.auth) failed.push({ item: it, error: err.message }); break; }   // brak sieci – później
          const now = outbox.list();
          if (r && r.ok) { outbox.save(now.filter(x => x.cid !== it.cid)); if (r.model) model = r.model; sent.push({ item: it, res: r }); }
          else { const x = now.find(y => y.cid === it.cid); if (x) { x.error = (r && r.error) || 'Nie udało się zapisać.'; outbox.save(now); } failed.push({ item: it, error: x ? x.error : '' }); }
        }
      } finally { outbox._busy = false; document.body.classList.remove('syncing'); }
      outboxListeners.forEach(f => { try { f({ sent, failed, model }); } catch (e) { /* słuchacz nie psuje kolejki */ } });
      clearTimeout(outbox._timer);
      if (outbox.list().some(x => !x.error)) outbox._timer = setTimeout(outbox.flush, 60000);
    }
  };
  window.addEventListener('online', () => outbox.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') outbox.flush(); });

  /* ================= panel „Urządzenia” ================= */
  /*
   * ctx = { getModel: () => D, setDevices: devs => {…zapisz w D i przerysuj…}, toast: html => {…} }
   * Zwraca { html() } – wstaw wynik html() w ekran Ustawień. Kliknięcia obsługuje rdzeń (delegacja zdarzeń).
   */
  function devices(ctx) {
    const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
    const two = n => String(n).padStart(2, '0');
    const whenTxt = iso => {
      if (!iso) return '–';
      const d = new Date(iso), now = new Date();
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const hm = two(d.getHours()) + ':' + two(d.getMinutes());
      if (dd === day) return 'dziś ' + hm;
      if (day - dd === 864e5) return 'wczoraj ' + hm;
      return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '') + ' ' + hm;
    };
    const EVENT_TXT = {
      connect: e => `Połączono „${esc(e.name)}”: ${esc(e.info)}`,
      confirm: e => `Potwierdzono „${esc(e.name)}” jako Twoje`,
      remove: e => `Usunięto „${esc(e.name)}” ${esc(e.info)}`,
      rename: e => `Nowa nazwa „${esc(e.name)}” (${esc(e.info)})`,
      blocked: e => `Zablokowano „${esc(e.name)}”: ${esc(e.info)}`,
      pair_fail: e => `Błędne kody parowania: ${esc(e.info)}`,
      key_new: () => 'Utworzono nowy klucz główny'
    };
    const ARMED = { id: null, until: 0 };
    let pairTimer = null;
    const DV = () => (ctx.getModel() || {}).devices;
    const newOnes = () => { const d = DV(); return d ? d.list.filter(x => x.active && !x.current && x.confirmed === false) : []; };
    const row = d => `<li class="dev${d.current ? ' me' : ''}${!d.current && d.confirmed === false ? ' fresh' : ''}">
      <div class="dev-body"><div class="nm"><span class="dev-name">${esc(d.name)}</span>${d.current ? '<span class="badge">to urządzenie</span>' : ''}</div>
        ${d.desc ? `<div class="sub">${esc(d.desc)}</div>` : ''}
        <div class="sub">połączone ${whenTxt(d.created)}${d.method === 'kod' ? ' kodem' : d.method === 'klucz' ? ' kluczem' : ''}, ostatnio ${d.current ? 'teraz' : whenTxt(d.seen)}</div>
        ${!d.current && d.confirmed === false ? '<div class="sub warn-line">Niepotwierdzone. Jeśli to nie Twoje urządzenie, usuń je.</div>' : ''}
        <div class="acts">${!d.current && d.confirmed === false ? `<button type="button" class="edit" data-dev-ack="${esc(d.id)}">To moje</button>` : ''}<button type="button" class="edit" data-dev-rename="${esc(d.id)}">Zmień nazwę</button><button type="button" class="edit warn-txt" data-dev-remove="${esc(d.id)}">${ARMED.id === d.id && ARMED.until > Date.now() ? 'Na pewno?' : d.current ? 'Odłącz to urządzenie' : 'Usuń'}</button></div>
      </div></li>`;
    function html() {
      const D = DV();
      const install = window.__installPrompt ? '<div class="dev-acts"><button type="button" class="btn-sm" data-install>Zainstaluj aplikację na tym urządzeniu</button></div>' : '';
      const head = `<div class="panel-head"><div><h2 id="h-dev">Urządzenia</h2><p class="desc">Te urządzenia mają dostęp do Twojego arkusza. Jeśli widzisz obce, usuń je, a dla pewności utwórz nowy klucz w Apps Script.</p></div>
        <button type="button" class="btn-sm" data-pair>+ Połącz nowe</button></div><div class="pair-box" id="pairBox" hidden></div>`;
      if (!D) return `<section class="panel device" aria-labelledby="h-dev">${head}${install}</section>`;
      const active = D.list.filter(d => d.active).sort((a, b) => (b.current - a.current) || String(b.seen).localeCompare(String(a.seen)));
      const hist = D.events.length ? `<details class="paid-more"><summary><span>Historia <small>${D.events.length}</small></span></summary>
        <ul class="dev-events">${D.events.map(e => `<li><span class="t">${whenTxt(e.t)}</span><span>${(EVENT_TXT[e.type] || (x => esc(x.info)))(e)}</span></li>`).join('')}</ul></details>` : '';
      return `<section class="panel device" aria-labelledby="h-dev">${head}<ul class="dev-list">${active.map(row).join('')}</ul>${install}${hist}</section>`;
    }
    async function act(fn, arg, okMsg) {
      const r = await api(fn, arg);
      if (!r || !r.ok) throw new Error((r && r.error) || 'Nie udało się.');
      if (r.self) { forgetDevice(); location.reload(); return; }
      ctx.setDevices(r.devices);
      if (okMsg) ctx.toast(okMsg);
    }
    document.addEventListener('click', async e => {
      let b;
      if ((b = e.target.closest('[data-install]')) && window.__installPrompt) {
        const ev = window.__installPrompt; window.__installPrompt = null; ev.prompt();
        try { await ev.userChoice; } catch (err) { /* anulowano */ }
        ctx.setDevices(DV()); return;
      }
      if ((b = e.target.closest('[data-dev-ack]'))) {
        b.disabled = true;
        try { await act('confirmDevice', { id: b.dataset.devAck }, 'Potwierdzone. Ostrzeżenie zniknie na wszystkich urządzeniach.'); }
        catch (err) { b.disabled = false; ctx.toast('Nie udało się potwierdzić: ' + esc(err.message)); }
        return;
      }
      if ((b = e.target.closest('[data-dev-rename]'))) {
        const id = b.dataset.devRename, d = DV().list.find(x => x.id === id);
        const name = window.prompt('Nowa nazwa urządzenia', d ? d.name : '');
        if (!name || !name.trim()) return;
        try { await act('renameDevice', { id, name: name.trim() }, 'Zmieniono nazwę na „' + esc(name.trim()) + '”.'); }
        catch (err) { ctx.toast('Nie udało się zmienić nazwy: ' + esc(err.message)); }
        return;
      }
      if ((b = e.target.closest('[data-dev-remove]'))) {
        const id = b.dataset.devRemove, d = DV().list.find(x => x.id === id) || { name: 'urządzenie' };
        if (!(ARMED.id === id && ARMED.until > Date.now())) {   // potwierdzenie drugim dotknięciem
          ARMED.id = id; ARMED.until = Date.now() + 4000; b.textContent = 'Na pewno?';
          setTimeout(() => { if (ARMED.id === id && ARMED.until <= Date.now()) { ARMED.id = null; ctx.setDevices(DV()); } }, 4100);
          return;
        }
        ARMED.id = null; b.disabled = true;
        try { await act('removeDevice', { id }, 'Usunięto „' + esc(d.name) + '”. To urządzenie straciło dostęp do arkusza.'); }
        catch (err) { b.disabled = false; ctx.toast('Nie udało się usunąć: ' + esc(err.message)); }
        return;
      }
      if ((b = e.target.closest('[data-pair]'))) {
        const box = document.getElementById('pairBox');
        b.disabled = true;
        try {
          const r = await api('pairStart');
          if (!r || !r.ok) throw new Error(r && r.error || 'Nie udało się utworzyć kodu.');
          let left = r.seconds || 300;
          const paint = () => {
            box.innerHTML = left > 0
              ? `<div class="pair-code num">${r.code.slice(0, 3)} ${r.code.slice(3)}</div><p>Na nowym urządzeniu otwórz aplikację, wybierz „Kolejne urządzenie” i wpisz ten kod. Ważny jeszcze <b class="num">${Math.floor(left / 60)}:${two(left % 60)}</b>, działa raz.</p>`
              : '<p>Kod wygasł. Poproś o nowy, jeśli nadal chcesz połączyć urządzenie.</p>';
          };
          box.hidden = false; paint();
          clearInterval(pairTimer);
          pairTimer = setInterval(() => { left--; if (!document.getElementById('pairBox')) { clearInterval(pairTimer); return; } paint(); if (left <= 0) clearInterval(pairTimer); }, 1000);
        } catch (err) { box.hidden = false; box.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
        finally { b.disabled = false; }
      }
    });
    return { html, newOnes };
  }

  /* ================= start: dane z pamięci, potem świeże z arkusza ================= */
  function boot() {
    const VERSION = window.CLIENT_VERSION || '0';
    const syncEl = document.getElementById('sync'), appEl = document.getElementById('app');
    let app = null, mismatch = '';
    const readCache = () => { const c = read(CACHE); return c && c.version === VERSION && c.model ? c : null; };
    const saveCache = m => write(CACHE, { version: VERSION, savedAt: Date.now(), model: m });
    Rdzen.saveCache = saveCache;
    function status(kind, html) {
      document.body.classList.toggle('syncing', kind === 'busy');
      if (kind === 'busy' || kind === 'ok') kind = '';
      if (!kind && !mismatch) { syncEl.hidden = true; syncEl.innerHTML = ''; return; }
      syncEl.hidden = false;
      syncEl.className = 'sync ' + (kind || 'warn');
      syncEl.innerHTML = (kind ? `<span>${html}</span>` : '') + (mismatch ? `<span class="mm">${mismatch}</span>` : '');
    }
    const checkVersion = sv => { mismatch = !sv || major(sv) === major(VERSION) ? '' : `Strona jest w wersji v${esc(VERSION)}, a skrypt w Apps Script v${esc(sv)}. Wklej nowy Code.gs i wdróż nową wersję.`; };
    const markKnown = m => { if (m && m.devices && read(KNOWN) === null) write(KNOWN, m.devices.list.map(d => d.id)); };
    function start(model) {
      document.body.classList.remove('booting', 'setup');
      app = window.startApp(model);
      outbox.flush();
    }
    function refresh() {
      if (!getConn()) return;
      status('busy', '');
      api('refreshData').then(m => {
        if (!m || m.ok === false || !m.generatedAt) throw new Error(m && m.error || 'Skrypt nie zwrócił danych.');
        checkVersion(m.version); markKnown(m); saveCache(m);
        if (app) app.apply(m); else start(m);
        status('', '');
      }).catch(e => {
        if (e.auth) { status('err', esc(e.message) + ' <button type="button" data-relink>Połącz ponownie</button>'); return; }
        status('err', (app ? 'Nie udało się odświeżyć, pokazuję zapisane dane. ' : 'Nie udało się wczytać danych. ') + esc(e.message || e) + ' <button type="button" data-retry>Spróbuj ponownie</button>');
      });
    }
    Rdzen.refresh = refresh;
    // kolejka wysłała wpisy i dostała świeże dane: stary komunikat o braku połączenia jest nieaktualny
    outbox.onChange(x => { if (x.model && !x.failed.length && syncEl.classList.contains('err')) { checkVersion(x.model.version); status('', ''); } });

    function showSetup(message) {
      document.body.classList.remove('booting');
      document.body.classList.add('setup');
      const sub = document.getElementById('abSub'); if (sub) sub.textContent = 'połączenie z arkuszem';
      status('', '');
      const needUrl = !(typeof SCRIPT_URL !== 'undefined' && SCRIPT_URL);   // config.js: const SCRIPT_URL = '…/exec' albo ''
      appEl.innerHTML = `<section class="setup" aria-labelledby="h-setup">
        <img class="setup-ico" src="icons/icon-192.png" alt="" width="64" height="64">
        <h1 id="h-setup">Połącz to urządzenie</h1>
        <p class="setup-lead">Robisz to tylko raz. Potem aplikacja otwiera się od razu, a dane biorą się z Twojego arkusza.</p>
        <div class="setup-choices" id="suChoices">
          <button type="button" class="choice" data-mode="key"><b>Pierwsze urządzenie</b><span>Mam klucz utworzony w Apps Script</span><i aria-hidden="true">›</i></button>
          <button type="button" class="choice" data-mode="code"><b>Kolejne urządzenie</b><span>Mam 6-cyfrowy kod z urządzenia, na którym aplikacja już działa</span><i aria-hidden="true">›</i></button>
        </div>
        <form id="setupForm" novalidate hidden>
          <button type="button" class="linkish su-back" id="suBack">‹ Zmień sposób połączenia</button>
          ${needUrl ? `<label class="field"><span>Adres skryptu (kończy się na /exec)</span><input id="suUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></label>` : ''}
          <label class="field" id="suCodeRow" hidden><span>Kod parowania (6 cyfr)</span><input id="suCode" class="code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000 000"></label>
          <p class="hint-avg" id="suCodeHint" hidden>Na urządzeniu, które już działa: Ustawienia → Urządzenia → Połącz nowe. Kod jest ważny 5 minut.</p>
          <label class="field" id="suKeyRow" hidden><span>Klucz</span><input id="suKey" autocomplete="off" spellcheck="false" placeholder="48 znaków z Apps Script"></label>
          <p class="hint-avg" id="suKeyHint" hidden>Klucz tworzysz w Apps Script: Uruchom → utworzKlucz, a potem skopiuj go z dziennika wykonania.</p>
          <label class="field"><span>Nazwa tego urządzenia</span><input id="suName" maxlength="40" autocomplete="off" placeholder="np. Telefon Maćka"></label>
          <p class="err" id="suErr" role="alert">${message ? esc(message) : ''}</p>
          <button class="save" id="suGo" type="submit">Połącz</button>
        </form>
        <p class="setup-foot">Przepustka zostaje tylko na tym urządzeniu. Bez niej skrypt nie pokaże nikomu Twoich danych.</p>
      </section>`;
      let mode = 'key';
      const $s = id => document.getElementById(id);
      appEl.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
        mode = b.dataset.mode;
        $s('suChoices').hidden = true; $s('setupForm').hidden = false;
        $s('suCodeRow').hidden = $s('suCodeHint').hidden = mode !== 'code';
        $s('suKeyRow').hidden = $s('suKeyHint').hidden = mode !== 'key';
        $s('suErr').textContent = '';
        (mode === 'code' ? $s('suCode') : $s('suKey')).focus();
      }));
      deviceInfo().then(i => { const n = $s('suName'); if (n && !n.value) n.value = i.name + (i.desc ? ' (' + i.desc.split(', ')[0] + ')' : ''); });
      $s('suBack').addEventListener('click', () => { $s('setupForm').hidden = true; $s('suChoices').hidden = false; $s('suErr').textContent = ''; });
      $s('suCode').addEventListener('input', e => { const d = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = d.length > 3 ? d.slice(0, 3) + ' ' + d.slice(3) : d; });
      $s('setupForm').addEventListener('submit', async ev => {
        ev.preventDefault();
        const err = $s('suErr'), go = $s('suGo');
        const url = ((typeof SCRIPT_URL !== 'undefined' && SCRIPT_URL) || ($s('suUrl') ? $s('suUrl').value : '')).trim();
        err.textContent = '';
        if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { err.textContent = 'Wklej pełny adres wdrożenia z Apps Script. Kończy się na /exec.'; return; }
        go.disabled = true; go.textContent = 'Łączę…';
        try {
          const info = await deviceInfo();
          const name = ($s('suName').value || info.name).trim();
          let conn;
          if (mode === 'code') {
            const code = $s('suCode').value.replace(/\D/g, '');
            if (code.length !== 6) throw new Error('Wpisz 6 cyfr kodu.');
            const r = await api('pairFinish', { code, name, desc: info.desc }, { url, key: '' });
            if (!r || !r.ok || !r.token) throw new Error(r && r.error || 'Nie udało się sparować.');
            conn = { url, token: r.token, id: r.id };
          } else {
            const key = $s('suKey').value.trim();
            if (key.length < 20) throw new Error('Wklej cały klucz z Apps Script.');
            const r = await api('register', { name, desc: info.desc }, { url, key });
            if (!r || !r.ok || !r.token) throw new Error(r && r.error || 'Nie udało się połączyć.');
            conn = { url, token: r.token, id: r.id };   // klucz główny nie zostaje na urządzeniu
          }
          const m = await api('refreshData', null, conn);
          if (!m || m.ok === false || !m.generatedAt) throw new Error(m && m.error || 'Skrypt nie zwrócił danych.');
          saveConn(conn); markKnown(m); saveCache(m); checkVersion(m.version);
          start(m); status('', '');
        } catch (e) {
          err.textContent = e.message || String(e);
        } finally {
          if (go.isConnected) { go.disabled = false; go.textContent = 'Połącz'; }
        }
      });
    }

    document.addEventListener('click', e => {
      if (e.target.closest('[data-retry]') || e.target.closest('[data-refresh]')) refresh();
      if (e.target.closest('[data-relink]')) { forgetDevice(); location.reload(); }
    });
    // po powrocie do aplikacji: świeże dane (nie częściej niż co minutę) – ważne przy zmianie dnia
    let hiddenAt = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && app && Date.now() - hiddenAt > 60000) refresh();
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    });

    if (!getConn()) showSetup('');
    else { const cached = readCache(); if (cached) start(cached.model); refresh(); }

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* bez trybu offline */ });
    }
  }

  const Rdzen = window.Rdzen = { api, outbox, devices, deviceInfo, getConn, forgetDevice, boot, esc, saveCache: () => {}, refresh: () => {} };
})();
