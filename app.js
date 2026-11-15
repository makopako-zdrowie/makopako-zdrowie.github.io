/****************************************************************
 * ZDROWIE – ekrany (v2.0): Dziś, Terapie, Ustawienia + wspólne narzędzia dla moduly.js (Historia, Raport, edycja).
 *
 * Dane przychodzą ze skryptu jako surowy model (terapie, pozycje, pory, opakowania, dziennik z ostatnich tygodni).
 * Plan dnia, tydzień i zapasy liczy tu Logika (logika.js), więc odhaczenie widać od razu, także bez internetu:
 * widok = dziennik z modelu + wpisy czekające w kolejce (Rdzen.outbox) + wpisy wysłane przed chwilą.
 * Kolejność plików: config.js → rdzen.js → logika.js → app.js → moduly.js. Start (Rdzen.boot) po wczytaniu wszystkich.
 ****************************************************************/
window.CLIENT_VERSION = '2.1';
(function () {
  'use strict';
  const L = Logika, esc = Rdzen.esc;
  const $ = id => document.getElementById(id);
  const two = n => String(n).padStart(2, '0');
  const lsGet = k => { try { return localStorage.getItem('zdrowie.' + k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem('zdrowie.' + k, v); } catch (e) { /* bez pamięci przeglądarki */ } };
  const TABS = ['dzis', 'historia', 'terapie', 'raport', 'ustawienia'];
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4.2 4.2 8.8-9.4"/></svg>';

  /** Wspólne dla moduly.js. */
  const Z = window.Zdrowie = { widoki: {}, klik: [], klikOkno: [], poRenderze: [] };

  let D = null, ctx = null;                 // model ze skryptu i jego przygotowana postać
  let tab = TABS.indexOf(lsGet('tab')) >= 0 ? lsGet('tab') : 'dzis';
  let recent = [];                          // operacje wysłane przed chwilą (na wypadek starszego modelu w drodze)
  let lastDay = '';
  const opened = {};                        // rozwinięte sekcje (pamiętane do zamknięcia strony)
  const swieze = {};                        // podania odhaczone przed chwilą (animacja)
  let blysk = { pora: '', do: 0 };          // karta pory podświetlona po wejściu z linku przypomnienia
  let devPanel = null, inited = false;

  /* ---------------- czas urządzenia ---------------- */
  const dzis = () => { const d = new Date(); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); };
  const teraz = () => { const d = new Date(); return two(d.getHours()) + ':' + two(d.getMinutes()); };
  const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const dni = n => n + (Math.abs(n) === 1 ? ' dzień' : ' dni');
  const kiedy = (data, ref) => { const k = L.num(ref) - L.num(data); return k === 0 ? 'dziś' : k === 1 ? 'wczoraj' : k === 2 ? 'przedwczoraj' : L.dataPl(data, ref); };
  const brr = wzor => { try { if (navigator.vibrate) navigator.vibrate(wzor); } catch (e) { /* bez wibracji */ } };

  /* ---------------- dziennik widoczny na ekranie ---------------- */
  const idWpisu = (cid, i) => 'K' + cid + '-' + i;
  /** Dziennik z modelu (+ starsze wpisy z getLog w „starsze”) z nałożonymi operacjami z kolejki i wysłanymi przed chwilą. */
  function wpisy(starsze) {
    const base = (starsze || []).concat((D.dziennik && D.dziennik.wpisy) || []);
    const ids = {}, cofniete = {};
    base.forEach(w => { ids[w.id] = true; });
    const out = base.slice();
    recent.concat(Rdzen.outbox.list().filter(x => !x.error)).forEach(op => {
      if (op.fn === 'logDose') (op.arg.items || []).forEach((it, i) => {
        const id = idWpisu(op.cid, i);
        if (!ids[id]) { ids[id] = true; out.push(Object.assign({ id: id, czeka: !op.sentAt }, it)); }
      });
      if (op.fn === 'undoDose') (op.arg.ids || []).forEach(id => { cofniete[id] = true; });
    });
    return out.filter(w => !cofniete[w.id]);
  }
  function przytnijRecent() {
    const ids = {};
    ((D.dziennik && D.dziennik.wpisy) || []).forEach(w => { ids[w.id] = true; });
    const now = Date.now();
    recent = recent.filter(op => now - op.sentAt < 180000 &&
      (op.fn !== 'logDose' || !(op.arg.items || []).every((_, i) => ids[idWpisu(op.cid, i)])));
  }
  function stan() {
    const t = dzis(), idx = L.indeks(wpisy());
    return { dzis: t, idx: idx, karty: L.dzien(ctx, idx, t), zalegle: L.zalegle(ctx, idx, t, 3), tydzien: L.tydzien(ctx, idx, t),
      dorazne: L.dorazne(ctx, idx, t), zapasy: L.zapasy(ctx, idx, t) };
  }
  function ustawModel(m) { D = m; ctx = L.przygotuj(D); przytnijRecent(); Rdzen.saveCache(D); render(); }

  /* ---------------- słowa i ikony ---------------- */
  const lekowe = p => p.rodzaj === 'lek' || p.rodzaj === 'suplement' || !p.rodzaj;
  const slowo = p => (lekowe(p) ? 'wzięte' : 'zrobione');
  const dawkaTxt = (p, n) => (p.dawka > 0 || n > 0 ? L.ilosc(n > 0 || n === 0 ? n : p.dawka, p.jednostka) : '');
  const podpis = p => [dawkaTxt(p), p.warunki, p.przyp && p.przyp !== 'nie' ? '⏰ ' + p.przyp : ''].filter(Boolean).join(' · ');
  const opisPrzyp = p => (p.przyp === 'nie' ? 'bez przypomnienia' : p.przyp ? 'przypomnienie o ' + p.przyp : '');
  /* kolory terapii w skórkach (jak kolory kategorii w Finansach): Neon ma własną paletę, Synthwave i Racer przeliczają odcień */
  const NEON_CACHE = {};
  function neonize(c, mode) {
    const key = mode + c;
    if (NEON_CACHE[key]) return NEON_CACHE[key];
    const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const l0 = (mx + mn) / 2, s0 = d ? d / (1 - Math.abs(2 * l0 - 1)) : 0;
    const P = { neon: [1, 0.58, 0.52], synthwave: [0.92, 0.66, 0.6], racer: [0.6, 0.44, 0.46] }[mode] || [1, 0.58, 0.52];
    const S = s0 < 0.12 ? s0 : P[0], Lx = s0 < 0.12 ? Math.max(0.62, l0) : (h > 40 && h < 75 ? P[2] : P[1]);
    const k = n => (n + h / 30) % 12, a = S * Math.min(Lx, 1 - Lx);
    const f = n => Math.round((Lx - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255).toString(16).padStart(2, '0');
    return (NEON_CACHE[key] = '#' + f(0) + f(8) + f(4));
  }
  const NEON_PAL = { '#4fa3e0': '#00e5ff', '#2fbf93': '#39ff88', '#e0b84c': '#ffb800', '#c0567a': '#ff2a6d', '#9b7be0': '#8c6bff', '#e0894c': '#ff8a00', '#5cc8d6': '#3df2ff', '#a3b84f': '#c6ff00' };
  const skinKolor = c => {
    const s = window.SKIN;
    if (!/^#[0-9a-f]{6}$/i.test(c) || !(s === 'neon' || s === 'synthwave' || s === 'racer')) return c;
    c = c.toLowerCase();
    return s === 'neon' && NEON_PAL[c] ? NEON_PAL[c] : neonize(c, s);
  };
  const kolor = p => { const t = ctx.terapie[p.terapia]; return t && t.kolor ? skinKolor(t.kolor) : 'var(--line)'; };
  const nazwaPory = k => { const p = ctx.poryMap[k]; return p ? p.nazwa : k; };
  const slot = (data, pora, p) => esc(data + '|' + pora + '|' + p.id);
  const zeSlotu = s => { const a = String(s).split('|'); return { data: a[0], pora: a[1], p: ctx.pozMap[a[2]] }; };
  const IKONY = {
    inhalator: '<path d="M9 3h5v5H9z"/><path d="M7 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/><path d="M18 14h3"/>',
    krople: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/>',
    tabletka: '<rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m9.5 9.5 5 5"/>',
    ampulka: '<path d="M10 2.5h4v3l1.2 2V20a1.5 1.5 0 0 1-1.5 1.5h-3.4A1.5 1.5 0 0 1 8.8 20V7.5l1.2-2z"/><path d="M8.8 12h6.4"/>',
    szampon: '<path d="M9.5 2.5h5v3h-5z"/><path d="M8.5 5.5h7l1.5 4V20a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20V9.5z"/><path d="M7 13h10"/>',
    sloik: '<path d="M4.5 6.5h15v3h-15z"/><path d="M5.5 9.5h13V19a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z"/>'
  };
  function ikona(p) {
    const t = String(p.postac || '').toLowerCase();
    const k = /inhal/.test(t) ? 'inhalator' : /kropl/.test(t) ? 'krople' : /ampu/.test(t) ? 'ampulka' : /szampon|płyn|lotion/.test(t) ? 'szampon'
      : /peel|krem|maś|masc|żel|zel|maska/.test(t) || p.rodzaj === 'kosmetyk' || p.rodzaj === 'zabieg' ? 'sloik' : 'tabletka';
    return `<i class="ic" aria-hidden="true"><svg viewBox="0 0 24 24">${IKONY[k]}</svg></i>`;
  }
  function opisWpisu(p, w) {
    if (!w) return '';
    if (w.status === 'korekta') return 'korekta zapasu: zostało ' + dawkaTxt(p, w.ilosc);
    if (w.status === 'doraźnie') return 'doraźnie' + (w.godz ? ' o ' + w.godz : '') + ' · ' + dawkaTxt(p, w.ilosc);
    const st = L.stanWpisu(w);
    if (st === 'wziete') return slowo(p) + (w.godz ? ' o ' + w.godz : '') + (w.ilosc > 0 && w.ilosc !== p.dawkaN ? ' · ' + dawkaTxt(p, w.ilosc) : '');
    if (st === 'pominiete') return 'pominięte' + (w.powod ? ': ' + w.powod : '');
    return 'brak danych (nie pamiętam)';
  }

  /* ---------------- zapisy ---------------- */
  function nowyWpis(p, pora, data, status, extra) {
    const it = { data: data, pora: pora, pozycja: p.id, status: status };
    if (status === 'wzięte' || status === 'doraźnie') it.ilosc = p.dawkaN;
    if (data === dzis()) it.godz = teraz();                  // za miniony dzień: po prostu zrobione albo nie, bez dopisków
    return Object.assign(it, extra || {});
  }
  /** Odhaczenie przez kolejkę: widać je od razu, wysyła się w tle. */
  function zapisz(items, komunikat) {
    const cid = Rdzen.outbox.add('logDose', { items: items }, komunikat);
    const ids = items.map((_, i) => idWpisu(cid, i));
    const t = Date.now();
    items.forEach(it => { if (it.status === 'wzięte') swieze[L.kluczSlotu(it.data, it.pora, it.pozycja)] = t; });
    brr(items.length > 1 ? [18, 60, 18] : 18);
    render();
    toast(esc(komunikat), () => cofnij(ids));
  }
  function cofnij(ids) {
    Rdzen.outbox.add('undoDose', { ids: ids }, 'Cofnięcie');
    brr(10);
    render();
    toast('Cofnięte.');
  }
  /** Rzadkie operacje wprost do skryptu (wymagają internetu). Błąd: w polu errEl (formularz) albo w toaście. */
  async function wyslij(fn, arg, btn, okMsg, errEl) {
    if (btn) btn.disabled = true;
    if (errEl) errEl.textContent = '';
    try {
      const r = await Rdzen.api(fn, arg);
      if (!r || !r.ok) throw new Error((r && r.error) || 'Nie udało się.');
      if (r.model) ustawModel(r.model);
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      if (errEl && errEl.isConnected) errEl.textContent = e.message || String(e);
      else toast('Nie udało się: ' + esc(e.message || e));
      return null;
    } finally { if (btn && btn.isConnected) btn.disabled = false; }
  }
  /** Potwierdzanie drugim dotknięciem: pierwsze uzbraja przycisk na 4 sekundy. */
  function uzbrojony(btn, tekst) {
    if (btn.dataset.armed) return true;
    const stary = btn.innerHTML;
    btn.dataset.armed = '1'; btn.textContent = tekst;
    setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.innerHTML = stary; } }, 4000);
    return false;
  }

  /* ================= ekran Dziś ================= */
  function alerty(S) {
    const li = [];
    Rdzen.outbox.list().filter(x => x.error).forEach(x => {
      li.push(`<li><span class="ico critical" aria-hidden="true">!</span><span><b>Nie zapisało się:</b> ${esc(x.label || 'wpis')}. ${esc(x.error)} <button type="button" class="linkish" data-drop="${esc(x.cid)}">Usuń</button></span></li>`);
    });
    S.zapasy.filter(z => z.alert).forEach(z => {
      const n = `<b>${esc(z.p.nazwa)}</b>`, kon = L.dataPl(z.koniec, S.dzis), co = z.p.rodzaj === 'lek' ? ' Czas na receptę.' : ' Czas kupić nowe.';
      let t;
      if (z.powod === 'waznosc') t = z.dniDoKonca < 0 ? `${n}: opakowanie straciło ważność ${kon}.` : `${n}: opakowanie traci ważność ${z.dniDoKonca === 0 ? 'dziś' : kon}.` + co;
      else if (z.powod === 'prognoza') t = z.dniDoKonca < 0 ? `${n}: poprzednie opakowania starczały na około ${dni(z.sredniaDni)}, to powinno się już kończyć.` + co : `${n}: poprzednie opakowania starczały na około ${dni(z.sredniaDni)}, to skończy się około ${kon}.` + co;
      else if (z.zostalo <= 0) t = `${n}: według odhaczeń opakowanie jest już puste.`;
      else if (z.dniDoKonca < 0) t = `${n}: zostało ${dawkaTxt(z.p, z.zostalo)}, to za mało na dziś.` + co;
      else t = `${n} wystarczy do ${z.dniDoKonca === 0 ? 'dziś' : kon} (zostało ${dawkaTxt(z.p, z.zostalo)}).` + co;
      li.push(`<li><span class="ico ${z.dniDoKonca <= 3 ? 'critical' : 'warning'}" aria-hidden="true">!</span><span>${t} <button type="button" class="linkish" data-finish="${esc(z.opak.id)}">Skończyło się</button></span></li>`);
    });
    if ((D.warnings || []).length) li.push(`<li><span class="ico warning" aria-hidden="true">i</span><span>Arkusz wymaga poprawek (${D.warnings.length}). <button type="button" class="linkish" data-tab="ustawienia">Zobacz w Ustawieniach</button></span></li>`);
    return li.length ? `<ul class="alerts">${li.join('')}</ul>` : '';
  }
  /** Przycisk z prawej: „⋯” (więcej) dla nieodhaczonych, „↶” (cofnij, dwa dotknięcia) dla odhaczonych. */
  const przyciskBoczny = (x, s, nazwa) => (x.wpis
    ? `<button type="button" class="it-more undo" data-undo="${esc(x.wpis.id)}" aria-label="Cofnij: ${esc(nazwa)}">↶</button>`
    : `<button type="button" class="it-more" data-more="${s}" aria-label="Więcej: ${esc(nazwa)}">⋯</button>`);
  function wiersz(x, data) {
    const p = x.p, opis = opisWpisu(p, x.wpis), sub = podpis(p), s = slot(data, x.pora, p);
    const lab = x.stan === 'do' ? `${p.nazwa}${sub ? ', ' + sub : ''}: oznacz jako ${slowo(p)}` : `${p.nazwa}: ${opis}. Szczegóły`;
    const just = swieze[L.kluczSlotu(data, x.pora, p.id)] > Date.now() - 1500 ? ' just' : '';
    return `<li class="item st-${x.stan}${x.wpis && x.wpis.czeka ? ' pending' : ''}${just}" style="--tc:${kolor(p)}">
      <button type="button" class="it-main" data-take="${s}" aria-label="${esc(lab)}">
        <span class="chk" aria-hidden="true">${x.stan === 'pominiete' ? '–' : x.stan === 'niewiem' ? '?' : CHECK}</span>
        <span class="it-txt"><b>${ikona(p)}${esc(p.nazwa)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${opis ? `<em>${esc(opis)}</em>` : ''}</span>
      </button>${przyciskBoczny(x, s, p.nazwa)}</li>`;
  }
  function kartaPory(k, S) {
    const razem = k.pozycje.length, zrobione = razem - k.doZrobienia, id = 'pora-' + k.klucz;
    const fl = blysk.pora === k.klucz && blysk.do > Date.now() ? ' flash' : '';
    const lista = `<ul class="items">${k.pozycje.map(x => wiersz(x, S.dzis)).join('')}</ul>`;
    if (!k.doZrobienia) {
      return `<details class="panel card pora done${fl}" data-key="${esc(id)}" data-pora="${esc(k.klucz)}"${opened[id] ? ' open' : ''}><summary><span class="okmark">${CHECK}</span><h2>${esc(cap(k.nazwa))}</h2><span class="cnt">odhaczone</span></summary>${lista}</details>`;
    }
    return `<section class="panel card pora${fl}" data-pora="${esc(k.klucz)}"><header class="card-head"><h2>${esc(cap(k.nazwa))}</h2>${k.godzina ? `<span class="when num">${esc(k.godzina)}</span>` : ''}<span class="cnt num">${zrobione} z ${razem}</span></header>
      ${lista}${k.doZrobienia >= 2 ? `<button type="button" class="pay-btn ghost all" data-all="${esc(k.klucz)}">Cała pora wzięta</button>` : ''}</section>`;
  }
  function kartaZalegle(S) {
    if (!S.zalegle.length) return '';
    const grupa = g => {
      const dzien = g.dniTemu === 1 ? 'Wczoraj' : g.dniTemu === 2 ? 'Przedwczoraj' : cap(L.DNI[L.dzienTyg(g.data)]) + ', ' + L.dataPl(g.data, S.dzis);
      return `<div class="late-g"><h3>${esc(dzien)} · ${esc(g.nazwa)}</h3>${g.pozycje.map(x => {
        const s = slot(g.data, x.pora, x.p), d = dawkaTxt(x.p);
        return `<div class="late-i" style="--tc:${kolor(x.p)}"><div class="q"><b>${esc(x.p.nazwa)}</b>${d ? `<small>${esc(d)}</small>` : ''}</div>
          <div class="ans" role="group" aria-label="${esc(x.p.nazwa)}: ${esc(dzien.toLowerCase())}, ${esc(g.nazwa)}"><button type="button" class="pay-btn yes" data-late="tak|${s}">Tak</button><button type="button" class="pay-btn ghost" data-late="nie|${s}">Nie</button><button type="button" class="pay-btn ghost" data-late="nw|${s}">Nie pamiętam</button></div></div>`;
      }).join('')}${g.pozycje.length > 1 ? `<button type="button" class="btn-sm late-all" data-late-all="${esc(g.data + '|' + g.klucz)}">Wszystko wzięte</button>` : ''}</div>`;
    };
    // wczoraj od razu na wierzchu; wcześniejsze dni zwinięte, żeby karta nie zasłaniała dzisiejszego planu
    const wczoraj = S.zalegle.filter(g => g.dniTemu === 1), starsze = S.zalegle.filter(g => g.dniTemu > 1);
    const ile = starsze.reduce((a, g) => a + g.pozycje.length, 0);
    const reszta = !starsze.length ? '' : !wczoraj.length ? starsze.map(grupa).join('')
      : `<details class="more" data-key="starsze"${opened.starsze ? ' open' : ''}><summary>Wcześniejsze dni (${ile})</summary>${starsze.map(grupa).join('')}</details>`;
    return `<section class="panel card late sub-ask" aria-labelledby="h-late"><header class="card-head"><h2 id="h-late">Wziąłeś?</h2></header>
      <p class="desc">Te podania zostały bez odpowiedzi. Bez niej w raporcie będzie „brak danych”.</p>${wczoraj.map(grupa).join('')}${reszta}</section>`;
  }
  function kartaTydzien(S) {
    if (!S.tydzien.length) return '';
    const wiersze = S.tydzien.map(t => {
      const p = t.p, gotowe = t.zostalo === 0;
      let info = `${t.wziete} z ${t.n} w tym tygodniu`;
      if (t.pominiete) info += `, pominięte ${t.pominiete}`;
      if (!gotowe) info += t.wpisDzis ? '' : t.prefDzis ? ' · najlepiej dziś' : t.prefMinal ? ' · czeka do niedzieli' : p.h.pref.length ? ' · najlepiej ' + p.h.pref.map(d => L.DNI_W[d]).join(' i ') : t.dniDoKonca === 0 ? ' · dziś ostatni dzień' : '';
      const st = gotowe || t.wpisDzis ? (t.wpisDzis ? L.stanWpisu(t.wpisDzis) : 'wziete') : 'do';
      const sub = podpis(p);
      const bok = t.wpisDzis ? `<button type="button" class="it-more undo" data-undo="${esc(t.wpisDzis.id)}" aria-label="Cofnij: ${esc(p.nazwa)}">↶</button>`
        : `<button type="button" class="it-more" data-week-more="${esc(p.id)}" aria-label="Więcej: ${esc(p.nazwa)}">⋯</button>`;
      const just = swieze[L.kluczSlotu(S.dzis, t.pora, p.id)] > Date.now() - 1500 ? ' just' : '';
      return `<li class="item st-${st}${just}" style="--tc:${kolor(p)}">
        <button type="button" class="it-main" data-week="${esc(p.id)}" aria-label="${esc(p.nazwa)}: ${esc(info)}">
          <span class="chk" aria-hidden="true">${st === 'pominiete' ? '–' : CHECK}</span>
          <span class="it-txt"><b>${ikona(p)}${esc(p.nazwa)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}<em>${esc(info)}</em></span>
        </button>${bok}</li>`;
    }).join('');
    return `<section class="panel card week" aria-labelledby="h-week"><header class="card-head"><h2 id="h-week">W tym tygodniu</h2></header><ul class="items">${wiersze}</ul></section>`;
  }
  function kartaDorazne(S) {
    if (!S.dorazne.length) return '';
    return `<section class="panel card adhoc" aria-labelledby="h-adhoc"><header class="card-head"><h2 id="h-adhoc">Doraźnie</h2></header>${S.dorazne.map(d =>
      `<div class="row"><div><b>${ikona(d.p)}${esc(d.p.nazwa)}</b><small>dziś ${d.dzis.length}×, w tym tygodniu ${d.tydzien}×</small></div><button type="button" class="pay-btn ghost btn-add" data-adhoc="${esc(d.p.id)}">+ Użyłem</button></div>`).join('')}</section>`;
  }
  const moznaZaczac = p => p.h.typ !== 'blad' && (p.h.typ !== 'brak' || p.dorazne);
  function kartaPlanowane() {
    const lista = ctx.pozycje.filter(p => p.status === 'planowana');
    if (!lista.length) return '';
    return `<details class="panel card planned" data-key="planowane"${opened.planowane ? ' open' : ''}><summary><h2>Planowane</h2><span class="cnt num">${lista.length}</span></summary>${lista.map(p => {
      const ok = moznaZaczac(p), opis = ok ? [L.opisHarmonogramu(p.h), p.poryN.join(' i '), dawkaTxt(p)].filter(Boolean).join(' · ') : '';
      return `<div class="row"><div><b>${ikona(p)}${esc(p.nazwa)}</b>${opis ? `<small>${esc(opis)}</small>` : ''}${p.uwagi ? `<small>${esc(p.uwagi)}</small>` : ''}${ok ? '' : '<small class="warn-line">Najpierw uzupełnij harmonogram i dawkę.</small>'}</div>
        ${ok ? `<button type="button" class="btn-sm" data-start="${esc(p.id)}">Zaczynam od dziś</button>` : `<button type="button" class="btn-sm" data-edit-p="${esc(p.id)}">Uzupełnij</button>`}</div>`;
    }).join('')}</details>`;
  }
  /** Ostatnie 7 dni w kratkach i seria dni bez pominięcia. Dotknięcie otwiera Historię. */
  function pasekTygodnia(S) {
    const kratki = [];
    for (let k = 6; k >= 0; k--) {
      const d = L.plus(S.dzis, -k), st = L.stanDnia(ctx, S.idx, d, S.dzis).st;
      kratki.push(`<span class="d7 st-${st}${k === 0 ? ' today' : ''}"><i>${L.DNI_SKROT[L.dzienTyg(d)]}</i></span>`);
    }
    const s = L.seria(ctx, S.idx, S.dzis, D.dziennik && D.dziennik.od);
    const txt = s.dni >= 2 ? `<b>${s.wiecej ? 'ponad ' : ''}${dni(s.dni)}</b> z rzędu bez pominięcia` : 'Ostatnie 7 dni';
    return `<button type="button" class="week7" data-tab="historia" aria-label="Ostatnie 7 dni. ${esc(txt.replace(/<[^>]+>/g, ''))}. Otwórz historię">
      <span class="d7s">${kratki.join('')}</span><span class="w7t">${txt} ›</span></button>`;
  }
  function viewDzis(S) {
    let razem = 0, zostalo = 0;
    S.karty.forEach(k => { razem += k.pozycje.length; zostalo += k.doZrobienia; });
    S.tydzien.forEach(t => { if (t.prefDzis || t.wpisDzis) { razem++; if (!t.wpisDzis && t.zostalo > 0) zostalo++; } });
    const maCos = razem || S.tydzien.length || S.dorazne.length || S.zalegle.length || ctx.pozycje.some(p => p.status === 'planowana');
    if (!maCos) {
      return alerty(S) + `<div class="empty"><b>Nie ma jeszcze nic do odhaczania</b>Dodaj terapię i pozycje w zakładce Terapie.<div class="dev-acts center"><button type="button" class="btn-sm primary-sm" data-tab="terapie">Przejdź do Terapii</button></div></div>`;
    }
    /* górna karta zbudowana jak „Listopad” w Finansach (.month, .m-head, .m-label, .m-big, .meter), żeby skórki działały bez przeróbek */
    const nast = S.karty.find(k => k.doZrobienia);
    const glowa = !razem ? 'nic w planie' : !zostalo ? 'wszystko odhaczone' : nast ? 'teraz: ' + nast.nazwa + (nast.godzina ? ' ' + nast.godzina : '') : 'zostało ' + zostalo;
    const zrob = razem - zostalo, pct = razem ? (100 * zrob / razem).toFixed(2) : 0;
    const meter = razem ? `<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${razem}" aria-valuenow="${zrob}" aria-label="Odhaczone dziś: ${zrob} z ${razem}">${zrob ? `<span class="lf" style="flex:0 1 ${pct}%"></span>` : ''}${zostalo ? `<span class="rs" style="flex:1 1 ${(100 - pct).toFixed(2)}%"></span>` : ''}</div>` : '';
    const big = !razem ? '' : !zostalo ? `<p class="m-label">Na dziś wszystko odhaczone</p><p class="m-big num done">${razem} z ${razem}</p>` : `<p class="m-label">Zostało do odhaczenia</p><p class="m-big num">${zostalo} z ${razem}</p>`;
    return alerty(S) + `<section class="month hero-d" aria-labelledby="h-dzis"><div class="m-head"><h1 id="h-dzis">Dziś</h1><span>${esc(glowa)}</span></div>${big}${meter}${pasekTygodnia(S)}</section>` + kartaZalegle(S) + S.karty.map(k => kartaPory(k, S)).join('') + kartaTydzien(S) + kartaDorazne(S) + kartaPlanowane();
  }

  /* ================= ekran Terapie ================= */
  function zapasHtml(z, S) {
    if (!z) return '';
    const o = z.opak;
    let txt, pct = null;
    if (z.znane) {
      if (z.razem) {
        pct = Math.max(0, Math.min(100, Math.round(100 * z.zostalo / Math.max(z.razem, z.korekta ? z.korekta.ilosc : 0))));
        txt = `Zostało <b>${esc(L.liczba(Math.max(0, z.zostalo)))} z ${esc(L.ilosc(z.razem, z.p.jednostka))}</b>`;
      } else txt = `Zostało <b>${esc(dawkaTxt(z.p, Math.max(0, z.zostalo)))}</b>`;
      if (z.koniecDawek) txt += z.zostalo <= 0 ? ' · według odhaczeń puste' : ` · wystarczy do ${esc(z.dniDoKonca === 0 && z.powod === 'dawki' ? 'dziś' : L.dataPl(z.koniecDawek, S.dzis))}`;
      if (z.korekta) txt += ` · stan poprawiony ${esc(kiedy(z.korekta.data, S.dzis))}`;
    } else {
      txt = `Otwarte <b>${z.otwarteDni === 0 ? 'dziś' : dni(z.otwarteDni) + ' temu'}</b>, ilość nieznana`;
      if (z.powod === 'prognoza') txt += ` · poprzednie starczały na około ${dni(z.sredniaDni)}, czyli do około ${esc(L.dataPl(z.koniec, S.dzis))}`;
    }
    if (o.wazneDo) txt += ` · ${z.poTerminie ? 'po terminie od' : 'ważne do'} ${esc(L.dataPl(o.wazneDo, S.dzis))}`;
    return `<div class="stock${z.alert ? ' low' : ''}">${pct === null ? '' : `<div class="track" aria-hidden="true"><span style="width:${pct}%"></span></div>`}
      <div class="stock-txt">${txt}</div><div class="acts"><button type="button" class="edit" data-fix="${esc(o.id)}">Popraw stan</button><button type="button" class="edit" data-finish="${esc(o.id)}">Skończyło się</button></div></div>`;
  }
  function pozycjaHtml(p, S, zap, dor) {
    const opis = [dawkaTxt(p), p.h.typ === 'brak' && p.dorazne ? 'tylko doraźnie' : L.opisHarmonogramu(p.h), p.poryN.map(nazwaPory).join(' i '), opisPrzyp(p)].filter(Boolean).join(' · ');
    const badge = p.status === 'planowana' ? '<span class="badge plan">planowana</span>' : p.status !== 'aktywna' ? '<span class="badge end">zakończona</span>' : '';
    const okres = p.status === 'aktywna' ? (p.od ? 'od ' + L.dataPl(p.od, S.dzis) : '') : [p.od ? L.dataPl(p.od, S.dzis) : '', p.do ? L.dataPl(p.do, S.dzis) : ''].filter(Boolean).join(' – ');
    const d = dor[p.id], z = zap[p.id];
    const brakOpak = p.status === 'aktywna' && !z ? `<div class="acts"><button type="button" class="edit" data-add-pack="${esc(p.id)}">+ Opakowanie</button></div>` : '';
    return `<div class="pos"><div class="nm"><b>${ikona(p)}${esc(p.nazwa)}</b>${badge}${p.status !== 'zakończona' ? `<button type="button" class="edit pos-edit" data-edit-p="${esc(p.id)}">Edytuj</button>` : ''}</div>
      ${p.status === 'zakończona' ? '' : `<p>${esc(opis)}</p>`}
      ${p.warunki && p.status !== 'zakończona' ? `<p>${esc(p.warunki)}</p>` : ''}
      ${okres ? `<p class="note">${esc(okres)}</p>` : ''}
      ${d ? `<p>Doraźnie: dziś ${d.dzis.length}×, w tym tygodniu ${d.tydzien}×</p>` : ''}
      ${p.uwagi ? `<p class="note">${esc(p.uwagi)}</p>` : ''}
      ${zapasHtml(z, S)}${brakOpak}</div>`;
  }
  function viewTerapie(S) {
    const zap = {}, dor = {};
    S.zapasy.forEach(z => { zap[z.p.id] = z; });
    S.dorazne.forEach(d => { dor[d.p.id] = d; });
    const grupy = (D.terapie || []).map(t => ({ t: t, poz: ctx.pozycje.filter(p => p.terapia === t.id) }));
    const bez = ctx.pozycje.filter(p => !ctx.terapie[p.terapia]);
    if (bez.length) grupy.push({ t: { id: '', nazwa: 'Bez terapii', kolor: '' }, poz: bez });
    const nowa = `<div class="dev-acts center"><button type="button" class="btn-sm primary-sm" data-new-t>+ Nowa terapia</button></div>`;
    if (!grupy.length) return `<div class="empty"><b>Nie ma jeszcze terapii</b>Terapia to lekarz albo obszar leczenia, np. „Pulmonologia”. Do niej dodasz leki i zabiegi.${nowa}</div>`;
    return grupy.map(g => {
      const t = g.t, akt = g.poz.filter(p => p.status !== 'zakończona'), zak = g.poz.filter(p => p.status === 'zakończona');
      const sub = [t.lekarz, t.specjalizacja, t.uwagi].filter(Boolean).join(' · '), key = 'zak-' + t.id;
      return `<section class="panel card" style="--tc:${t.kolor ? skinKolor(t.kolor) : 'var(--muted)'}"><div class="th-head"><i aria-hidden="true"></i><h2>${esc(t.nazwa)}</h2>${t.id ? `<button type="button" class="edit" data-edit-t="${esc(t.id)}">Edytuj</button>` : ''}</div>
        ${sub ? `<p class="th-sub">${esc(sub)}</p>` : ''}
        ${akt.map(p => pozycjaHtml(p, S, zap, dor)).join('') || '<div class="pos"><p>Brak aktywnych pozycji.</p></div>'}
        ${t.id ? `<div class="th-add"><button type="button" class="btn-sm" data-new-p="${esc(t.id)}">+ Lek, suplement albo zabieg</button></div>` : ''}
        ${zak.length ? `<details class="more" data-key="${esc(key)}"${opened[key] ? ' open' : ''}><summary>Zakończone (${zak.length})</summary>${zak.map(p => pozycjaHtml(p, S, zap, dor)).join('')}</details>` : ''}</section>`;
    }).join('') + nowa;
  }

  /* ================= ekran Ustawienia ================= */
  const SKORKI = [['klasyczny', 'Klasyczny', 'ciemny, spokojny', '<s></s><i></i><i></i><i></i><em></em>'], ['jasny', 'Jasny', 'na dzień', '<s></s><i></i><i></i><i></i><em></em>'],
    ['neon', 'Neon', 'cyberpunk', '<s></s><i></i><i></i><i></i><em></em>'], ['synthwave', 'Synthwave', 'zachód słońca, lata 80.', '<b></b><s></s><i></i><em></em>'],
    ['racer', 'Racer', 'jasny, retro wyścig', '<s></s><i></i><em></em>']];
  function viewUstawienia() {
    const r = (D.prefs && D.prefs.reminders) || {};
    const kiedySync = r.lastSync ? (() => { const d = new Date(r.lastSync); return two(d.getHours()) + ':' + two(d.getMinutes()); })() : '';
    const pory = ctx.pory.map(p => `<div class="pora-row"><b>${esc(cap(p.nazwa))}</b>
      <label><span>w tygodniu</span><input type="time" data-pora-g="${esc(p.nazwa)}" value="${esc(p.godzina || '')}"></label>
      <label><span>w weekend</span><input type="time" data-pora-w="${esc(p.nazwa)}" value="${esc(p.weekend || '')}"></label></div>`).join('');
    const drugie = isFinite(r.drugie) ? +r.drugie : 60;
    const czeka = Rdzen.outbox.list().length, skin = window.SKIN || 'klasyczny';
    return `<section class="panel" aria-labelledby="h-rem"><div class="panel-head"><div><h2 id="h-rem">Przypomnienia</h2>
        <p class="desc">Kalendarz Google „${esc(r.calendar || 'Zdrowie – przypomnienia')}”: wydarzenie o godzinie pory, z linkiem do aplikacji. Znika, gdy wszystko z pory jest odhaczone. Własną godzinę albo „bez przypomnienia” ustawiasz w edycji pozycji.</p></div>
        <button type="button" class="btn-sm${r.enabled ? '' : ' primary-sm'}" data-rem="${r.enabled ? '0' : '1'}">${r.enabled ? 'Wyłącz' : 'Włącz'}</button></div>
      <p class="line">${r.enabled ? `Włączone. Wydarzeń w kalendarzu: ${r.count || 0}${kiedySync ? ', ostatnia zmiana ' + kiedySync : ''}.` : 'Wyłączone.'}</p>
      ${r.error ? `<p class="err">${esc(r.error)}</p>` : ''}
      <h3 class="sh-h">Przypomnij jeszcze raz, jeśli nie odhaczę</h3>
      <div class="chips" role="group" aria-label="Drugie przypomnienie">${[[0, 'nie'], [30, 'po 30 min'], [60, 'po godzinie'], [120, 'po 2 godz.']].map(x => `<button type="button" data-drugie="${x[0]}" aria-pressed="${drugie === x[0]}">${x[1]}</button>`).join('')}</div>
      <h3 class="sh-h">Pory dnia</h3>${pory}
      <p class="err" id="poryErr"></p>
      <div class="dev-acts"><button type="button" class="btn-sm" data-pory-save>Zapisz godziny</button></div>
      <p class="hint-avg">Puste „w weekend” = jak w tygodniu. Pierwsze włączenie przypomnień: w Apps Script uruchom raz funkcję wlaczPrzypomnienia (zgoda na Kalendarz).</p></section>
    <section class="panel" aria-labelledby="h-skin"><h2 id="h-skin">Wygląd</h2><p class="desc">Zapamiętany osobno na każdym urządzeniu.</p>
      <div class="skin-list">${SKORKI.map(s => `<button type="button" class="skin" data-skin-set="${s[0]}" aria-pressed="${skin === s[0]}"><span class="pv pv-${s[0]}" aria-hidden="true">${s[3]}</span><b>${s[1]}</b><small>${s[2]}</small></button>`).join('')}</div></section>
    ${devPanel.html()}
    <section class="panel" aria-labelledby="h-ark"><h2 id="h-ark">Arkusz</h2>
      <p class="desc">Wszystko z aplikacji trafia do arkusza Google. Możesz tam też poprawiać dane ręcznie: aplikacja odczyta je po odświeżeniu.</p>
      ${(D.warnings || []).length ? `<p class="line"><b>Do poprawienia:</b></p><ul class="plain">${D.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="line">Arkusz nie ma uwag.</p>'}
      ${D.sheetUrl ? `<div class="dev-acts"><a class="btn-sm" href="${esc(D.sheetUrl)}" target="_blank" rel="noopener">Otwórz arkusz</a></div>` : ''}</section>
    <section class="panel" aria-labelledby="h-app"><h2 id="h-app">Aplikacja</h2>
      <p class="line">Strona v${esc(window.CLIENT_VERSION)}, skrypt v${esc(D.version || '?')}.${czeka ? ` Czeka na wysłanie: ${czeka}.` : ' Wszystko wysłane.'}</p>
      <div class="dev-acts"><button type="button" class="btn-sm" data-refresh>Odśwież dane</button></div></section>`;
  }

  /* ================= rysowanie ================= */
  function render() {
    if (!D || !ctx) return;
    const S = stan(), app = $('app');
    lastDay = S.dzis;
    $('abSub').textContent = L.DNI[L.dzienTyg(S.dzis)] + ', ' + L.dataPl(S.dzis);
    const para = $('pairBox'), zachowaj = para && !para.hidden ? para : null;      // kod parowania przeżywa odświeżenie ekranu
    const aktywny = document.activeElement && app.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (aktywny) return;                                                           // nie kasujemy tego, co ktoś właśnie wpisuje
    app.innerHTML = Z.widoki[tab] ? Z.widoki[tab](S) : tab === 'terapie' ? viewTerapie(S) : tab === 'ustawienia' ? viewUstawienia() : viewDzis(S);
    if (zachowaj && $('pairBox')) $('pairBox').replaceWith(zachowaj);
    document.querySelectorAll('[data-tab]').forEach(b => { if (b.closest('#tabbar') || b.classList.contains('ib')) { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); } });
    $('gearDot').classList.toggle('on', devPanel.newOnes().length > 0);
    const a = $('abSheet');
    if (D.sheetUrl) { a.href = D.sheetUrl; a.hidden = false; } else a.hidden = true;
    Z.poRenderze.forEach(f => { try { f(S); } catch (e) { /* moduł nie psuje ekranu */ } });
  }
  function idz(t) {
    if (TABS.indexOf(t) < 0) return;
    tab = t; lsSet('tab', t); render(); window.scrollTo(0, 0);
  }

  /* ================= okno od dołu i toast ================= */
  let sheetOn = false, sheetCtx = null, wrocDo = null;
  function otworz(tytul, html, c) {
    $('sheetTitle').textContent = tytul; $('sheetBody').innerHTML = html; sheetCtx = c || {};
    $('toast').classList.remove('on');
    if (sheetOn) { $('sheet').scrollTop = 0; return; }
    sheetOn = true; wrocDo = document.activeElement;
    const s = $('sheet'), bg = $('sheetBg');
    s.hidden = false; bg.hidden = false; s.scrollTop = 0;
    requestAnimationFrame(() => { s.classList.add('open'); bg.classList.add('open'); });
    try { history.pushState({ okno: 1 }, ''); } catch (e) { /* bez historii */ }
    s.focus({ preventScroll: true });
  }
  function zamknij(zHistorii) {
    if (!sheetOn) return;
    sheetOn = false; sheetCtx = null;
    const s = $('sheet'), bg = $('sheetBg');
    s.classList.remove('open'); bg.classList.remove('open');
    setTimeout(() => { if (!sheetOn) { s.hidden = true; bg.hidden = true; } }, 300);
    if (!zHistorii) { try { if (history.state && history.state.okno) history.back(); } catch (e) { /* bez historii */ } }
    if (wrocDo && wrocDo.isConnected) wrocDo.focus({ preventScroll: true });
  }
  let toastTimer = null, toastUndo = null;
  function toast(html, undo) {
    const t = $('toast');
    toastUndo = undo || null;
    t.innerHTML = `<span>${html}</span>${undo ? '<button type="button" data-toast-undo>Cofnij</button>' : ''}`;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), undo ? 6000 : 3500);
  }

  /* ---------------- okna: podanie, tydzień, doraźne, opakowanie, korekta ---------------- */
  const POWODY = p => ['zapomniałem', lekowe(p) ? 'brak leku' : 'skończyło się', 'zalecenie lekarza', 'inne'];
  const krok = p => (p.dawkaN % 1 ? 0.5 : 1);
  function poleIlosci(p, wartosc, etykieta) {
    const v = wartosc === undefined ? p.dawkaN : wartosc;
    return `<div class="qty"><button type="button" data-q="-1" aria-label="Mniej">−</button>
      <label><span class="sr">${esc(etykieta || 'Ilość')}</span><input id="shQty" inputmode="decimal" autocomplete="off" value="${esc(String(v).replace('.', ','))}"><em>${esc(L.jednostka(5, p.jednostka))}</em></label>
      <button type="button" data-q="1" aria-label="Więcej">+</button></div>`;
  }
  const czytajIlosc = p => { const n = Number(String($('shQty') ? $('shQty').value : '').replace(',', '.')); return n >= 0 && n <= 100000 && isFinite(n) && String($('shQty').value).trim() !== '' ? n : p.dawkaN; };
  const notatka = () => ($('shNote') ? $('shNote').value.trim().slice(0, 200) : '');

  /** Okno jednego podania: do odhaczenia (ilość, notatka, pominięcie z powodem) albo już odhaczonego (cofnięcie). */
  function oknoPodania(s, tryb, idx) {
    const t = dzis(), p = s.p;
    if (!p) return;
    const w = (idx || stan().idx).sloty[L.kluczSlotu(s.data, s.pora, p.id)] || null;
    const gdzie = `${nazwaPory(s.pora)}, ${kiedy(s.data, t)}`;
    const sub = `<p class="sh-sub">${esc([podpis(p), gdzie].filter(Boolean).join(' · '))}</p>`;
    if (w) {
      otworz(p.nazwa, `${sub}<div class="sh-state">${esc(cap(opisWpisu(p, w)))}${w.notatka ? `<small>${esc(w.notatka)}</small>` : ''}${w.czeka ? '<small>Czeka na wysłanie do arkusza.</small>' : ''}</div>
        <button type="button" class="danger" data-sh-undo="${esc(w.id)}">Cofnij odhaczenie</button>`, s);
      return;
    }
    const pomin = `<h3 class="sh-h">${tryb === 'pomin' ? 'Dlaczego?' : 'Pominąłem, bo…'}</h3><div class="chips">${POWODY(p).map(x => `<button type="button" data-sh-skip="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
    const pole = `<label class="field"><span>Notatka (nieobowiązkowa)</span><input id="shNote" maxlength="200" autocomplete="off"></label>`;
    otworz(p.nazwa, tryb === 'pomin' ? `${sub}${pomin}${pole}` : `${sub}${poleIlosci(p)}${pole}<button type="button" class="save" data-sh-take>${cap(slowo(p))}</button>${pomin}`, s);
  }
  function oknoTygodnia(p) {
    const S = stan(), t = S.tydzien.filter(x => x.p.id === p.id)[0];
    if (!t) return;
    const pon = L.poczatekTyg(S.dzis);
    const lista = S.idx.lista.filter(w => w.pozycja === p.id && w.data >= pon && w.data <= L.plus(pon, 6));
    const wpisyHtml = lista.length ? `<h3 class="sh-h">W tym tygodniu</h3><ul class="uses">${lista.map(w =>
      `<li><span>${esc(cap(kiedy(w.data, S.dzis)))}: ${esc(opisWpisu(p, w))}</span><button type="button" class="edit warn-txt" data-sh-undo="${esc(w.id)}">Cofnij</button></li>`).join('')}</ul>` : '';
    const s = { data: S.dzis, pora: t.pora, p: p };
    const mozna = t.zostalo > 0 && !t.wpisDzis;
    otworz(p.nazwa, `<p class="sh-sub">${esc([dawkaTxt(p), L.opisHarmonogramu(p.h)].filter(Boolean).join(' · '))}</p>
      ${mozna ? `${poleIlosci(p)}<label class="field"><span>Notatka (nieobowiązkowa)</span><input id="shNote" maxlength="200" autocomplete="off"></label>
        <button type="button" class="save" data-sh-take>${cap(slowo(p))} dziś</button>
        <h3 class="sh-h">W tym tygodniu pomijam, bo…</h3><div class="chips">${POWODY(p).map(x => `<button type="button" data-sh-skip="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
      ${wpisyHtml}`, s);
  }
  function oknoDorazne(p) {
    const S = stan(), d = S.dorazne.filter(x => x.p.id === p.id)[0];
    const lista = d && d.dzis.length ? `<h3 class="sh-h">Dziś</h3><ul class="uses">${d.dzis.map(w =>
      `<li><span>${esc(w.godz || '')} · ${esc(dawkaTxt(p, w.ilosc))}${w.notatka ? ' · ' + esc(w.notatka) : ''}</span><button type="button" class="edit warn-txt" data-sh-undo="${esc(w.id)}">Cofnij</button></li>`).join('')}</ul>` : '';
    otworz(p.nazwa + ': doraźnie', `<p class="sh-sub">Użycie poza planem. Liczy się do zapasu.</p>${poleIlosci(p)}
      <label class="field"><span>Godzina</span><input id="shTime" type="time" value="${teraz()}"></label>
      <label class="field"><span>Notatka (nieobowiązkowa)</span><input id="shNote" maxlength="200" autocomplete="off" placeholder="np. co się działo"></label>
      <button type="button" class="save" data-sh-adhoc>Zapisz użycie</button>${lista}`, { p: p });
  }
  /** Wybór pozycji doraźnej (skrót z ikony aplikacji, gdy jest ich kilka). */
  function oknoWyboruDoraznej() {
    const lista = stan().dorazne;
    if (!lista.length) { toast('Nie masz pozycji z użyciem doraźnym. Zaznaczysz to w edycji pozycji.'); return; }
    if (lista.length === 1) { oknoDorazne(lista[0].p); return; }
    otworz('Użycie doraźne', `<div class="chips col">${lista.map(d => `<button type="button" data-adhoc="${esc(d.p.id)}">${esc(d.p.nazwa)}</button>`).join('')}</div>`, {});
  }
  function oknoOpakowania(id) {
    const S = stan(), z = S.zapasy.filter(x => x.opak.id === id)[0];
    if (!z) return;
    const p = z.p, o = z.opak;
    otworz(p.nazwa + ': skończyło się', `<p class="sh-sub">Opakowanie otwarte ${esc(o.otwarto ? L.dataPl(o.otwarto, S.dzis) : 'nie wiadomo kiedy')}. Zapisuję, że skończyło się dziś.</p>
      <h3 class="sh-h">Nowe opakowanie</h3>
      <label class="field"><span>Ile jest w nowym opakowaniu${p.jednostka ? ' (' + esc(L.jednostka(5, p.jednostka)) + ')' : ''}? Puste = nie wiem</span><input id="shPack" inputmode="decimal" autocomplete="off" value="${z.razem ? esc(String(z.razem).replace('.', ',')) : ''}"></label>
      <label class="field"><span>Ważne do (jeśli jest termin po otwarciu)</span><input id="shExp" type="date"></label>
      <p class="err" id="shErr"></p>
      <button type="button" class="save" data-sh-finish="nowe">Skończyło się, otwieram nowe</button>
      <button type="button" class="second" data-sh-finish="bez">Skończyło się, nowego jeszcze nie mam</button>`, { opak: id, p: p });
  }
  /** Korekta zapasu: „licznik pokazuje 92”. Zapis przez kolejkę (działa też bez internetu). */
  function oknoKorekty(id) {
    const S = stan(), z = S.zapasy.filter(x => x.opak.id === id)[0];
    if (!z) return;
    const p = z.p, teraz0 = z.znane ? Math.max(0, z.zostalo) : '';
    otworz(p.nazwa + ': popraw stan', `<p class="sh-sub">Ile zostało w opakowaniu teraz? Np. licznik na inhalatorze albo policzone tabletki. Od tej chwili aplikacja liczy od tej liczby.</p>
      ${poleIlosci(p, teraz0, 'Zostało')}
      <p class="hint-avg">${z.znane ? 'Według odhaczeń zostało ' + esc(dawkaTxt(p, Math.max(0, z.zostalo))) + '.' : 'Ilość w tym opakowaniu była nieznana.'}</p>
      <button type="button" class="save" data-sh-fix>Zapisz stan</button>`, { p: p, opak: id, korekta: true });
  }
  function oknoNowegoOpakowania(p) {
    otworz(p.nazwa + ': nowe opakowanie', `<p class="sh-sub">Otwarte dziś.</p>
      <label class="field"><span>Ile jest w opakowaniu${p.jednostka ? ' (' + esc(L.jednostka(5, p.jednostka)) + ')' : ''}? Puste = nie wiem</span><input id="shPack" inputmode="decimal" autocomplete="off"></label>
      <label class="field"><span>Ważne do (jeśli jest termin po otwarciu)</span><input id="shExp" type="date"></label>
      <label class="field"><span>Przypomnij o zakupie tyle dni przed końcem</span><input id="shAlert" inputmode="numeric" value="7"></label>
      <p class="err" id="shErr"></p>
      <button type="button" class="save" data-sh-pack>Dodaj opakowanie</button>`, { p: p });
  }

  /* ================= zdarzenia ================= */
  let ostatnie = { s: '', t: 0 };
  function init() {
    inited = true;
    devPanel = Rdzen.devices({ getModel: () => D, setDevices: d => { if (d) D.devices = d; Rdzen.saveCache(D); render(); }, toast: toast });

    document.addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (b) { idz(b.dataset.tab); return; }
      if (e.target.closest('[data-toast-undo]')) { const f = toastUndo; toastUndo = null; $('toast').classList.remove('on'); if (f) f(); return; }
      if (e.target.closest('#sheetClose') || e.target.id === 'sheetBg') zamknij();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOn) zamknij(); });
    window.addEventListener('popstate', () => zamknij(true));

    const app = $('app');
    app.addEventListener('toggle', e => { const k = e.target.dataset && e.target.dataset.key; if (k) opened[k] = e.target.open; }, true);
    app.addEventListener('contextmenu', e => { const b = e.target.closest('[data-take]'); if (b) { e.preventDefault(); oknoPodania(zeSlotu(b.dataset.take)); } });
    app.addEventListener('click', e => {
      let b;
      for (const h of Z.klik) { if (h(e)) return; }
      if ((b = e.target.closest('[data-take]'))) {
        const s = zeSlotu(b.dataset.take), S = stan();
        if (!s.p) return;
        if (S.idx.sloty[L.kluczSlotu(s.data, s.pora, s.p.id)]) {
          if (ostatnie.s === b.dataset.take && Date.now() - ostatnie.t < 700) return;      // drugie dotknięcie tuż po odhaczeniu
          oknoPodania(s); return;
        }
        ostatnie = { s: b.dataset.take, t: Date.now() };
        zapisz([nowyWpis(s.p, s.pora, s.data, 'wzięte')], `${s.p.nazwa}: ${slowo(s.p)}`);
        return;
      }
      if ((b = e.target.closest('[data-undo]'))) {
        if (!uzbrojony(b, 'Cofnąć?')) return;
        cofnij([b.dataset.undo]);
        return;
      }
      if ((b = e.target.closest('[data-more]'))) { oknoPodania(zeSlotu(b.dataset.more)); return; }
      if ((b = e.target.closest('[data-all]'))) {
        const S = stan(), k = S.karty.filter(x => x.klucz === b.dataset.all)[0];
        const items = k ? k.pozycje.filter(x => x.stan === 'do').map(x => nowyWpis(x.p, x.pora, S.dzis, 'wzięte')) : [];
        if (items.length) zapisz(items, `${cap(k.nazwa)}: wszystko wzięte (${items.length})`);
        return;
      }
      if ((b = e.target.closest('[data-late]'))) {
        const i = b.dataset.late.indexOf('|'), odp = b.dataset.late.slice(0, i), s = zeSlotu(b.dataset.late.slice(i + 1));
        if (!s.p) return;
        if (odp === 'tak') zapisz([nowyWpis(s.p, s.pora, s.data, 'wzięte')], `${s.p.nazwa}: ${slowo(s.p)} (${kiedy(s.data, dzis())})`);
        else if (odp === 'nw') zapisz([nowyWpis(s.p, s.pora, s.data, 'nie pamiętam')], `${s.p.nazwa}: zostaje brak danych`);
        else oknoPodania(s, 'pomin');
        return;
      }
      if ((b = e.target.closest('[data-late-all]'))) {
        const a = b.dataset.lateAll.split('|'), S = stan(), g = S.zalegle.filter(x => x.data === a[0] && x.klucz === a[1])[0];
        if (g) zapisz(g.pozycje.map(x => nowyWpis(x.p, x.pora, g.data, 'wzięte')), `${cap(kiedy(g.data, S.dzis))}, ${g.nazwa}: wszystko wzięte (${g.pozycje.length})`);
        return;
      }
      if ((b = e.target.closest('[data-week]'))) {
        const S = stan(), t = S.tydzien.filter(x => x.p.id === b.dataset.week)[0];
        if (!t) return;
        if (t.zostalo > 0 && !t.wpisDzis) zapisz([nowyWpis(t.p, t.pora, S.dzis, 'wzięte')], `${t.p.nazwa}: ${slowo(t.p)}`);
        else oknoTygodnia(t.p);
        return;
      }
      if ((b = e.target.closest('[data-week-more]'))) { const p = ctx.pozMap[b.dataset.weekMore]; if (p) oknoTygodnia(p); return; }
      if ((b = e.target.closest('[data-adhoc]'))) { const p = ctx.pozMap[b.dataset.adhoc]; if (p) oknoDorazne(p); return; }
      if ((b = e.target.closest('[data-finish]'))) { oknoOpakowania(b.dataset.finish); return; }
      if ((b = e.target.closest('[data-fix]'))) { oknoKorekty(b.dataset.fix); return; }
      if ((b = e.target.closest('[data-add-pack]'))) { const p = ctx.pozMap[b.dataset.addPack]; if (p) oknoNowegoOpakowania(p); return; }
      if ((b = e.target.closest('[data-drop]'))) { Rdzen.outbox.remove(b.dataset.drop); render(); return; }
      if ((b = e.target.closest('[data-start]'))) {
        const p = ctx.pozMap[b.dataset.start];
        if (!p || !uzbrojony(b, 'Na pewno od dziś?')) return;
        wyslij('startPosition', { id: p.id }, b, `${esc(p.nazwa)}: zaczynasz od dziś.`);
        return;
      }
      if ((b = e.target.closest('[data-rem]'))) {
        const on = b.dataset.rem === '1';
        wyslij('saveReminders', { enabled: on }, b).then(r => { if (r) toast(on ? (r.model.prefs.reminders.error ? 'Włączone, ale kalendarz wymaga zgody. Szczegóły poniżej.' : 'Przypomnienia włączone.') : 'Przypomnienia wyłączone.'); });
        return;
      }
      if ((b = e.target.closest('[data-drugie]'))) {
        const v = Number(b.dataset.drugie);
        wyslij('saveReminders', { drugie: v }, b, v ? 'Drugie przypomnienie ustawione.' : 'Bez drugiego przypomnienia.');
        return;
      }
      if ((b = e.target.closest('[data-pory-save]'))) {
        const pory = ctx.pory.map(p => ({ nazwa: p.nazwa,
          godzina: (app.querySelector(`[data-pora-g="${CSS.escape(p.nazwa)}"]`) || {}).value || '',
          weekend: (app.querySelector(`[data-pora-w="${CSS.escape(p.nazwa)}"]`) || {}).value || '' }));
        document.activeElement && document.activeElement.blur && document.activeElement.blur();
        wyslij('savePory', { pory: pory }, b, 'Godziny pór zapisane. Przypomnienia się przestawią.', $('poryErr'));
        return;
      }
      if ((b = e.target.closest('[data-skin-set]'))) {                // nie [data-skin]: ten atrybut ma też <html>
        if (window.setSkin) window.setSkin(b.dataset.skinSet);
        render();
      }
    });

    $('sheet').addEventListener('click', e => {
      const c = sheetCtx;
      let b;
      if (!c) return;
      for (const h of Z.klikOkno) { if (h(e, c)) return; }
      if ((b = e.target.closest('[data-q]'))) {
        const inp = $('shQty'), k = c.p ? krok(c.p) : 1, n = Math.max(0, Math.round((czytajIlosc(c.p || { dawkaN: 0 }) + k * Number(b.dataset.q)) * 100) / 100);
        inp.value = String(n).replace('.', ',');
        return;
      }
      if (e.target.closest('[data-sh-take]')) {
        const it = nowyWpis(c.p, c.pora, c.data, 'wzięte', { ilosc: czytajIlosc(c.p) }), n = notatka();
        if (n) it.notatka = n;
        zamknij(); zapisz([it], `${c.p.nazwa}: ${slowo(c.p)}`);
        return;
      }
      if ((b = e.target.closest('[data-sh-skip]'))) {
        const it = nowyWpis(c.p, c.pora, c.data, 'pominięte', { powod: b.dataset.shSkip }), n = notatka();
        if (n) it.notatka = n;
        zamknij(); zapisz([it], `${c.p.nazwa}: pominięte (${b.dataset.shSkip})`);
        return;
      }
      if ((b = e.target.closest('[data-sh-undo]'))) {
        if (!uzbrojony(b, 'Na pewno cofnąć?')) return;
        const id = b.dataset.shUndo;
        zamknij(); cofnij([id]);
        return;
      }
      if (e.target.closest('[data-sh-adhoc]')) {
        const t = $('shTime').value, n = notatka();
        const it = { data: dzis(), pora: '', pozycja: c.p.id, status: 'doraźnie', ilosc: czytajIlosc(c.p), godz: /^\d\d:\d\d/.test(t) ? t.slice(0, 5) : teraz() };
        if (n) it.notatka = n;
        zamknij(); zapisz([it], `${c.p.nazwa}: użycie doraźne zapisane`);
        return;
      }
      if (e.target.closest('[data-sh-fix]')) {
        const v = String($('shQty').value).trim(), n = Number(v.replace(',', '.'));
        if (!v || !(n >= 0)) { $('shQty').focus(); return; }
        zamknij(); zapisz([{ data: dzis(), pora: '', pozycja: c.p.id, status: 'korekta', ilosc: n, godz: teraz() }], `${c.p.nazwa}: stan poprawiony (zostało ${dawkaTxt(c.p, n)})`);
        return;
      }
      if ((b = e.target.closest('[data-sh-finish]'))) {
        const il = Number(String($('shPack').value).replace(',', '.')), exp = $('shExp').value;
        const arg = { id: c.opak, data: dzis(), nowe: b.dataset.shFinish === 'nowe' ? { ilosc: il > 0 ? il : null, wazneDo: exp || null } : null };
        const nazwa = c.p.nazwa, nowe = !!arg.nowe;
        wyslij('finishPackage', arg, b, null, $('shErr')).then(r => { if (r) { zamknij(); toast(esc(nazwa) + (nowe ? ': nowe opakowanie otwarte.' : ': opakowanie zamknięte. Nowe dodasz w Terapiach („+ Opakowanie”).')); } });
        return;
      }
      if (e.target.closest('[data-sh-pack]')) {
        const nazwa = c.p.nazwa;
        wyslij('addPackage', { pozycja: c.p.id, ilosc: String($('shPack').value).replace(',', '.'), wazneDo: $('shExp').value || null, alertDni: $('shAlert').value }, e.target.closest('[data-sh-pack]'), null, $('shErr'))
          .then(r => { if (r) { zamknij(); toast(esc(nazwa) + ': opakowanie dodane.'); } });
      }
    });

    Rdzen.outbox.onChange(x => {
      const now = Date.now();
      x.sent.forEach(s => recent.push(Object.assign({}, s.item, { sentAt: now })));
      if (x.sent.length && Z.poWyslaniu) Z.poWyslaniu(x.sent);
      if (x.model) ustawModel(x.model); else render();
      if (x.failed.length) toast('Nie udało się zapisać: ' + esc(x.failed[0].error || 'spróbuj ponownie'));
    });
    // zmiana dnia przy otwartej aplikacji
    setInterval(() => { if (D && dzis() !== lastDay && !sheetOn) render(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && D && dzis() !== lastDay && !sheetOn) render(); });
  }

  /** Link z przypomnienia albo skrótu na ikonie: ?pora=rano&d=2026-11-15, ?akcja=dorazne, ?tab=historia. */
  function zAdresu() {
    let q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (!q.toString()) return;
    try { history.replaceState(history.state, '', location.pathname); } catch (e) { /* zostaje adres z parametrami */ }
    const pora = L.klucz(q.get('pora') || ''), d = q.get('d') || dzis(), t = q.get('tab'), akcja = q.get('akcja');
    if (t && TABS.indexOf(t) >= 0) { idz(t); return; }
    if (akcja === 'dorazne') { idz('dzis'); oknoWyboruDoraznej(); return; }
    if (!pora) return;
    if (d < dzis() && Z.pokazDzien) { Z.pokazDzien(d); idz('historia'); return; }
    blysk = { pora: pora, do: Date.now() + 1600 };
    opened['pora-' + pora] = true;
    idz('dzis');
    const karta = document.querySelector(`.card.pora[data-pora="${CSS.escape(pora)}"]`);
    if (karta) karta.scrollIntoView({ block: 'start' });
  }

  window.startApp = model => {
    D = model; ctx = L.przygotuj(D);
    const pierwszy = !inited;
    if (!inited) init();
    render();
    if (pierwszy) zAdresu();
    return { apply(m) { D = m; ctx = L.przygotuj(D); przytnijRecent(); render(); } };
  };

  Object.assign(Z, {
    L: L, esc: esc, $: $, two: two, cap: cap, dni: dni, kiedy: kiedy, dzis: dzis, teraz: teraz, lsGet: lsGet, lsSet: lsSet, brr: brr,
    model: () => D, ctx: () => ctx, stan: stan, wpisy: wpisy, render: render, idz: idz, tab: () => tab,
    otworz: otworz, zamknij: zamknij, toast: toast, wyslij: wyslij, uzbrojony: uzbrojony, zapisz: zapisz, cofnij: cofnij, nowyWpis: nowyWpis,
    oknoPodania: oknoPodania, opisWpisu: opisWpisu, dawkaTxt: dawkaTxt, podpis: podpis, ikona: ikona, kolor: kolor, nazwaPory: nazwaPory,
    slowo: slowo, slot: slot, zeSlotu: zeSlotu, CHECK: CHECK, opened: opened, kolorTerapii: t => (t && t.kolor ? skinKolor(t.kolor) : 'var(--muted)')
  });
  // start po wczytaniu wszystkich plików (moduly.js dokłada ekrany Historia i Raport oraz edycję)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Rdzen.boot());
  else setTimeout(() => Rdzen.boot(), 0);
})();
