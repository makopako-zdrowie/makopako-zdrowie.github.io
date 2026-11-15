/****************************************************************
 * ZDROWIE – ekrany (v1.0): Dziś, Terapie, Ustawienia.
 *
 * Dane przychodzą ze skryptu jako surowy model (terapie, pozycje, pory, opakowania, dziennik z ostatnich tygodni).
 * Plan dnia, tydzień i zapasy liczy tu Logika (logika.js), więc odhaczenie widać od razu, także bez internetu:
 * widok = dziennik z modelu + wpisy czekające w kolejce (Rdzen.outbox) + wpisy wysłane przed chwilą.
 ****************************************************************/
window.CLIENT_VERSION = '1.1';
(function () {
  'use strict';
  const L = Logika, esc = Rdzen.esc;
  const $ = id => document.getElementById(id);
  const two = n => String(n).padStart(2, '0');
  const lsGet = k => { try { return localStorage.getItem('zdrowie.' + k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem('zdrowie.' + k, v); } catch (e) { /* bez pamięci przeglądarki */ } };
  const TABS = ['dzis', 'terapie', 'ustawienia'];
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4.2 4.2 8.8-9.4"/></svg>';

  let D = null, ctx = null;                 // model ze skryptu i jego przygotowana postać
  let tab = TABS.indexOf(lsGet('tab')) >= 0 ? lsGet('tab') : 'dzis';
  let recent = [];                          // operacje wysłane przed chwilą (na wypadek starszego modelu w drodze)
  let lastDay = '';
  const opened = {};                        // rozwinięte sekcje (pamiętane do zamknięcia strony)
  let devPanel = null, inited = false;

  /* ---------------- czas urządzenia ---------------- */
  const dzis = () => { const d = new Date(); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); };
  const teraz = () => { const d = new Date(); return two(d.getHours()) + ':' + two(d.getMinutes()); };
  const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const dni = n => n + (Math.abs(n) === 1 ? ' dzień' : ' dni');
  const kiedy = (data, ref) => { const k = L.num(ref) - L.num(data); return k === 0 ? 'dziś' : k === 1 ? 'wczoraj' : k === 2 ? 'przedwczoraj' : L.dataPl(data, ref); };

  /* ---------------- dziennik widoczny na ekranie ---------------- */
  const idWpisu = (cid, i) => 'K' + cid + '-' + i;
  function wpisy() {
    const base = (D.dziennik && D.dziennik.wpisy) || [];
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

  /* ---------------- słowa ---------------- */
  const lekowe = p => p.rodzaj === 'lek' || p.rodzaj === 'suplement' || !p.rodzaj;
  const slowo = p => (lekowe(p) ? 'wzięte' : 'zrobione');
  const dawkaTxt = (p, n) => (p.dawka > 0 || n > 0 ? L.ilosc(n > 0 || n === 0 ? n : p.dawka, p.jednostka) : '');
  const podpis = p => [dawkaTxt(p), p.warunki, p.przyp && p.przyp !== 'nie' ? '⏰ ' + p.przyp : ''].filter(Boolean).join(' · ');
  const opisPrzyp = p => (p.przyp === 'nie' ? 'bez przypomnienia' : p.przyp ? 'przypomnienie o ' + p.przyp : '');
  const kolor = p => { const t = ctx.terapie[p.terapia]; return t && t.kolor ? t.kolor : 'var(--line)'; };
  const nazwaPory = k => { const p = ctx.poryMap[k]; return p ? p.nazwa : k; };
  const slot = (data, pora, p) => esc(data + '|' + pora + '|' + p.id);
  const zeSlotu = s => { const a = String(s).split('|'); return { data: a[0], pora: a[1], p: ctx.pozMap[a[2]] }; };
  function opisWpisu(p, w, ref) {
    if (!w) return '';
    const st = L.stanWpisu(w);
    if (st === 'wziete') return slowo(p) + (w.godz ? ' o ' + w.godz : '') + (w.ilosc > 0 && w.ilosc !== p.dawkaN ? ' · ' + dawkaTxt(p, w.ilosc) : '') + (w.pozniej ? ' · wpisane po fakcie' : '');
    if (st === 'pominiete') return 'pominięte' + (w.powod ? ': ' + w.powod : '');
    return 'brak danych (nie pamiętam)';
  }

  /* ---------------- zapisy ---------------- */
  function nowyWpis(p, pora, data, status, extra) {
    const it = { data: data, pora: pora, pozycja: p.id, status: status };
    if (status === 'wzięte' || status === 'doraźnie') it.ilosc = p.dawkaN;
    if (data === dzis()) it.godz = teraz(); else it.pozniej = true;
    return Object.assign(it, extra || {});
  }
  /** Odhaczenie przez kolejkę: widać je od razu, wysyła się w tle. */
  function zapisz(items, komunikat) {
    const cid = Rdzen.outbox.add('logDose', { items: items }, komunikat);
    const ids = items.map((_, i) => idWpisu(cid, i));
    render();
    toast(esc(komunikat), () => cofnij(ids));
  }
  function cofnij(ids) {
    Rdzen.outbox.add('undoDose', { ids: ids }, 'Cofnięcie');
    render();
    toast('Cofnięte.');
  }
  /** Rzadkie operacje wprost do skryptu (wymagają internetu). */
  async function wyslij(fn, arg, btn, okMsg) {
    if (btn) btn.disabled = true;
    try {
      const r = await Rdzen.api(fn, arg);
      if (!r || !r.ok) throw new Error((r && r.error) || 'Nie udało się.');
      if (r.model) ustawModel(r.model);
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      toast('Nie udało się: ' + esc(e.message || e));
      return null;
    } finally { if (btn && btn.isConnected) btn.disabled = false; }
  }
  /** Potwierdzanie drugim dotknięciem: pierwsze uzbraja przycisk na 4 sekundy. */
  function uzbrojony(btn, tekst) {
    if (btn.dataset.armed) return true;
    const stary = btn.textContent;
    btn.dataset.armed = '1'; btn.textContent = tekst;
    setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = stary; } }, 4000);
    return false;
  }

  /* ================= ekran Dziś ================= */
  function alerty(S) {
    const li = [];
    Rdzen.outbox.list().filter(x => x.error).forEach(x => {
      li.push(`<li><span class="ico crit" aria-hidden="true">!</span><span><b>Nie zapisało się:</b> ${esc(x.label || 'wpis')}. ${esc(x.error)} <button type="button" class="linkish" data-drop="${esc(x.cid)}">Usuń</button></span></li>`);
    });
    S.zapasy.filter(z => z.alert).forEach(z => {
      const n = `<b>${esc(z.p.nazwa)}</b>`, kon = L.dataPl(z.koniec, S.dzis), co = z.p.rodzaj === 'lek' ? ' Czas na receptę.' : ' Czas kupić nowe.';
      let t;
      if (z.powod === 'waznosc') t = z.dniDoKonca < 0 ? `${n}: opakowanie straciło ważność ${kon}.` : `${n}: opakowanie traci ważność ${z.dniDoKonca === 0 ? 'dziś' : kon}.` + co;
      else if (z.powod === 'prognoza') t = z.dniDoKonca < 0 ? `${n}: poprzednie opakowania starczały na około ${dni(z.sredniaDni)}, to powinno się już kończyć.` + co : `${n}: poprzednie opakowania starczały na około ${dni(z.sredniaDni)}, to skończy się około ${kon}.` + co;
      else if (z.zostalo <= 0) t = `${n}: według odhaczeń opakowanie jest już puste.`;
      else if (z.dniDoKonca < 0) t = `${n}: zostało ${dawkaTxt(z.p, z.zostalo)}, to za mało na dziś.` + co;
      else t = `${n} wystarczy do ${z.dniDoKonca === 0 ? 'dziś' : kon} (zostało ${dawkaTxt(z.p, z.zostalo)}).` + co;
      li.push(`<li><span class="ico${z.dniDoKonca <= 3 ? ' crit' : ''}" aria-hidden="true">!</span><span>${t} <button type="button" class="linkish" data-finish="${esc(z.opak.id)}">Skończyło się</button></span></li>`);
    });
    if ((D.warnings || []).length) li.push(`<li><span class="ico" aria-hidden="true">i</span><span>Arkusz wymaga poprawek (${D.warnings.length}). <button type="button" class="linkish" data-tab="ustawienia">Zobacz w Ustawieniach</button></span></li>`);
    return li.length ? `<ul class="alerts">${li.join('')}</ul>` : '';
  }
  function wiersz(x, data) {
    const p = x.p, opis = opisWpisu(p, x.wpis, data), sub = podpis(p);
    const lab = x.stan === 'do' ? `${p.nazwa}${sub ? ', ' + sub : ''}: oznacz jako ${slowo(p)}` : `${p.nazwa}: ${opis}. Szczegóły`;
    return `<li class="item st-${x.stan}${x.wpis && x.wpis.czeka ? ' pending' : ''}" style="--c:${kolor(p)}">
      <button type="button" class="it-main" data-take="${slot(data, x.pora, p)}" aria-label="${esc(lab)}">
        <span class="chk" aria-hidden="true">${x.stan === 'pominiete' ? '–' : x.stan === 'niewiem' ? '?' : CHECK}</span>
        <span class="it-txt"><b>${esc(p.nazwa)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${opis ? `<em>${esc(opis)}</em>` : ''}</span>
      </button>
      <button type="button" class="it-more" data-more="${slot(data, x.pora, p)}" aria-label="Więcej: ${esc(p.nazwa)}">⋯</button></li>`;
  }
  function kartaPory(k, S) {
    const razem = k.pozycje.length, zrobione = razem - k.doZrobienia, id = 'pora-' + k.klucz;
    const lista = `<ul class="items">${k.pozycje.map(x => wiersz(x, S.dzis)).join('')}</ul>`;
    if (!k.doZrobienia) {
      return `<details class="card pora done" data-key="${esc(id)}"${opened[id] ? ' open' : ''}><summary><span class="okmark">${CHECK}</span><h2>${esc(cap(k.nazwa))}</h2><span class="cnt">odhaczone</span></summary>${lista}</details>`;
    }
    return `<section class="card pora"><header class="card-head"><h2>${esc(cap(k.nazwa))}</h2>${k.godzina ? `<span class="when num">${esc(k.godzina)}</span>` : ''}<span class="cnt num">${zrobione} z ${razem}</span></header>
      ${lista}${k.doZrobienia >= 2 ? `<button type="button" class="all" data-all="${esc(k.klucz)}">Cała pora wzięta</button>` : ''}</section>`;
  }
  function kartaZalegle(S) {
    if (!S.zalegle.length) return '';
    const grupa = g => {
      const dzien = g.dniTemu === 1 ? 'Wczoraj' : g.dniTemu === 2 ? 'Przedwczoraj' : cap(L.DNI[L.dzienTyg(g.data)]) + ', ' + L.dataPl(g.data, S.dzis);
      return `<div class="late-g"><h3>${esc(dzien)} · ${esc(g.nazwa)}</h3>${g.pozycje.map(x => {
        const s = slot(g.data, x.pora, x.p), d = dawkaTxt(x.p);
        return `<div class="late-i" style="--c:${kolor(x.p)}"><div class="q"><b>${esc(x.p.nazwa)}</b>${d ? `<small>${esc(d)}</small>` : ''}</div>
          <div class="ans" role="group" aria-label="${esc(x.p.nazwa)}: ${esc(dzien.toLowerCase())}, ${esc(g.nazwa)}"><button type="button" class="yes" data-late="tak|${s}">Tak</button><button type="button" data-late="nie|${s}">Nie</button><button type="button" data-late="nw|${s}">Nie pamiętam</button></div></div>`;
      }).join('')}${g.pozycje.length > 1 ? `<button type="button" class="btn-sm late-all" data-late-all="${esc(g.data + '|' + g.klucz)}">Wszystko wzięte</button>` : ''}</div>`;
    };
    // wczoraj od razu na wierzchu; wcześniejsze dni zwinięte, żeby karta nie zasłaniała dzisiejszego planu
    const wczoraj = S.zalegle.filter(g => g.dniTemu === 1), starsze = S.zalegle.filter(g => g.dniTemu > 1);
    const ile = starsze.reduce((a, g) => a + g.pozycje.length, 0);
    const reszta = !starsze.length ? '' : !wczoraj.length ? starsze.map(grupa).join('')
      : `<details class="more" data-key="starsze"${opened.starsze ? ' open' : ''}><summary>Wcześniejsze dni (${ile})</summary>${starsze.map(grupa).join('')}</details>`;
    return `<section class="card late" aria-labelledby="h-late"><header class="card-head"><h2 id="h-late">Wziąłeś?</h2></header>
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
      return `<li class="item st-${st}" style="--c:${kolor(p)}">
        <button type="button" class="it-main" data-week="${esc(p.id)}" aria-label="${esc(p.nazwa)}: ${esc(info)}">
          <span class="chk" aria-hidden="true">${st === 'pominiete' ? '–' : CHECK}</span>
          <span class="it-txt"><b>${esc(p.nazwa)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}<em>${esc(info)}</em></span>
        </button>
        <button type="button" class="it-more" data-week-more="${esc(p.id)}" aria-label="Więcej: ${esc(p.nazwa)}">⋯</button></li>`;
    }).join('');
    return `<section class="card week" aria-labelledby="h-week"><header class="card-head"><h2 id="h-week">W tym tygodniu</h2></header><ul class="items">${wiersze}</ul></section>`;
  }
  function kartaDorazne(S) {
    if (!S.dorazne.length) return '';
    return `<section class="card adhoc" aria-labelledby="h-adhoc"><header class="card-head"><h2 id="h-adhoc">Doraźnie</h2></header>${S.dorazne.map(d =>
      `<div class="row"><div><b>${esc(d.p.nazwa)}</b><small>dziś ${d.dzis.length}×, w tym tygodniu ${d.tydzien}×</small></div><button type="button" class="btn-add" data-adhoc="${esc(d.p.id)}">+ Użyłem</button></div>`).join('')}</section>`;
  }
  const moznaZaczac = p => p.h.typ !== 'blad' && (p.h.typ !== 'brak' || p.dorazne);
  function kartaPlanowane() {
    const lista = ctx.pozycje.filter(p => p.status === 'planowana');
    if (!lista.length) return '';
    return `<details class="card planned" data-key="planowane"${opened.planowane ? ' open' : ''}><summary><h2>Planowane</h2><span class="cnt num">${lista.length}</span></summary>${lista.map(p => {
      const ok = moznaZaczac(p), opis = ok ? [L.opisHarmonogramu(p.h), p.poryN.join(' i '), dawkaTxt(p)].filter(Boolean).join(' · ') : '';
      return `<div class="row"><div><b>${esc(p.nazwa)}</b>${opis ? `<small>${esc(opis)}</small>` : ''}${p.uwagi ? `<small>${esc(p.uwagi)}</small>` : ''}${ok ? '' : '<small class="warn-line">Najpierw uzupełnij w arkuszu harmonogram i dawkę.</small>'}</div>
        ${ok ? `<button type="button" class="btn-sm" data-start="${esc(p.id)}">Zaczynam od dziś</button>` : ''}</div>`;
    }).join('')}</details>`;
  }
  function viewDzis(S) {
    let razem = 0, zostalo = 0;
    S.karty.forEach(k => { razem += k.pozycje.length; zostalo += k.doZrobienia; });
    S.tydzien.forEach(t => { if (t.prefDzis || t.wpisDzis) { razem++; if (!t.wpisDzis && t.zostalo > 0) zostalo++; } });
    const maCos = razem || S.tydzien.length || S.dorazne.length || S.zalegle.length || ctx.pozycje.some(p => p.status === 'planowana');
    if (!maCos) {
      return alerty(S) + `<div class="empty"><b>Nie ma jeszcze nic do odhaczania</b>Dodaj terapie i pozycje w arkuszu (zakładki Terapie i Pozycje), a potem odśwież.</div>`;
    }
    const lead = !razem ? 'Na dziś nic nie ma w planie.' : !zostalo ? '<strong>Na dziś wszystko odhaczone.</strong>' : `Dziś zostało <strong>${zostalo} z ${razem}</strong>.`;
    const prog = razem ? `<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="${razem}" aria-valuenow="${razem - zostalo}" aria-label="Odhaczone dziś"><span style="width:${Math.round(100 * (razem - zostalo) / razem)}%"></span></div>` : '';
    return alerty(S) + `<p class="lead">${lead}</p>${prog}` + kartaZalegle(S) + S.karty.map(k => kartaPory(k, S)).join('') + kartaTydzien(S) + kartaDorazne(S) + kartaPlanowane();
  }

  /* ================= ekran Terapie ================= */
  function zapasHtml(z, S) {
    if (!z) return '';
    const o = z.opak;
    let txt, pct = null;
    if (z.znane) {
      pct = Math.max(0, Math.min(100, Math.round(100 * z.zostalo / z.razem)));
      txt = `Zostało <b>${esc(L.liczba(Math.max(0, z.zostalo)))} z ${esc(L.ilosc(z.razem, z.p.jednostka))}</b>`;
      if (z.koniecDawek) txt += z.zostalo <= 0 ? ' · według odhaczeń puste' : ` · wystarczy do ${esc(z.dniDoKonca === 0 && z.powod === 'dawki' ? 'dziś' : L.dataPl(z.koniecDawek, S.dzis))}`;
    } else {
      txt = `Otwarte <b>${z.otwarteDni === 0 ? 'dziś' : dni(z.otwarteDni) + ' temu'}</b>, ilość nieznana`;
      if (z.powod === 'prognoza') txt += ` · poprzednie starczały na około ${dni(z.sredniaDni)}, czyli do około ${esc(L.dataPl(z.koniec, S.dzis))}`;
    }
    if (o.wazneDo) txt += ` · ${z.poTerminie ? 'po terminie od' : 'ważne do'} ${esc(L.dataPl(o.wazneDo, S.dzis))}`;
    return `<div class="stock${z.alert ? ' low' : ''}">${pct === null ? '' : `<div class="track" aria-hidden="true"><span style="width:${pct}%"></span></div>`}
      <div class="stock-txt">${txt}</div><div class="acts"><button type="button" class="edit" data-finish="${esc(o.id)}">Skończyło się</button></div></div>`;
  }
  function pozycjaHtml(p, S, zap, dor) {
    const opis = [dawkaTxt(p), p.h.typ === 'brak' && p.dorazne ? 'tylko doraźnie' : L.opisHarmonogramu(p.h), p.poryN.map(nazwaPory).join(' i '), opisPrzyp(p)].filter(Boolean).join(' · ');
    const badge = p.status === 'planowana' ? '<span class="badge plan">planowana</span>' : p.status !== 'aktywna' ? '<span class="badge end">zakończona</span>' : '';
    const okres = p.status === 'aktywna' ? (p.od ? 'od ' + L.dataPl(p.od, S.dzis) : '') : [p.od ? L.dataPl(p.od, S.dzis) : '', p.do ? L.dataPl(p.do, S.dzis) : ''].filter(Boolean).join(' – ');
    const d = dor[p.id];
    return `<div class="pos"><div class="nm"><b>${esc(p.nazwa)}</b>${badge}</div>
      ${p.status === 'zakończona' ? '' : `<p>${esc(opis)}</p>`}
      ${p.warunki && p.status !== 'zakończona' ? `<p>${esc(p.warunki)}</p>` : ''}
      ${okres ? `<p class="note">${esc(okres)}</p>` : ''}
      ${d ? `<p>Doraźnie: dziś ${d.dzis.length}×, w tym tygodniu ${d.tydzien}×</p>` : ''}
      ${p.uwagi ? `<p class="note">${esc(p.uwagi)}</p>` : ''}
      ${zapasHtml(zap[p.id], S)}</div>`;
  }
  function viewTerapie(S) {
    const zap = {}, dor = {};
    S.zapasy.forEach(z => { zap[z.p.id] = z; });
    S.dorazne.forEach(d => { dor[d.p.id] = d; });
    const grupy = (D.terapie || []).map(t => ({ t: t, poz: ctx.pozycje.filter(p => p.terapia === t.id) }));
    const bez = ctx.pozycje.filter(p => !ctx.terapie[p.terapia]);
    if (bez.length) grupy.push({ t: { id: '', nazwa: 'Bez terapii', kolor: '' }, poz: bez });
    if (!grupy.length) return `<div class="empty"><b>Nie ma jeszcze terapii</b>Dodaj je w arkuszu, w zakładce Terapie.</div>`;
    return grupy.map(g => {
      const t = g.t, akt = g.poz.filter(p => p.status !== 'zakończona'), zak = g.poz.filter(p => p.status === 'zakończona');
      const sub = [t.lekarz, t.specjalizacja, t.uwagi].filter(Boolean).join(' · '), key = 'zak-' + t.id;
      return `<section class="card" style="--c:${t.kolor || 'var(--muted)'}"><div class="th-head"><i aria-hidden="true"></i><h2>${esc(t.nazwa)}</h2></div>
        ${sub ? `<p class="th-sub">${esc(sub)}</p>` : ''}
        ${akt.map(p => pozycjaHtml(p, S, zap, dor)).join('') || '<div class="pos"><p>Brak aktywnych pozycji.</p></div>'}
        ${zak.length ? `<details class="more" data-key="${esc(key)}"${opened[key] ? ' open' : ''}><summary>Zakończone (${zak.length})</summary>${zak.map(p => pozycjaHtml(p, S, zap, dor)).join('')}</details>` : ''}</section>`;
    }).join('');
  }

  /* ================= ekran Ustawienia ================= */
  function viewUstawienia() {
    const r = (D.prefs && D.prefs.reminders) || {};
    const kiedySync = r.lastSync ? (() => { const d = new Date(r.lastSync); return two(d.getHours()) + ':' + two(d.getMinutes()); })() : '';
    const pory = ctx.pory.map(p => `<li>${esc(cap(p.nazwa))}: <span class="num">${esc(p.godzina || 'bez godziny')}</span>${p.weekend && p.weekend !== p.godzina ? `, w weekend <span class="num">${esc(p.weekend)}</span>` : ''}</li>`).join('');
    const czeka = Rdzen.outbox.list().length;
    return `<section class="panel" aria-labelledby="h-rem"><div class="panel-head"><div><h2 id="h-rem">Przypomnienia</h2>
        <p class="desc">Kalendarz Google „${esc(r.calendar || 'Zdrowie – przypomnienia')}”: jedno wydarzenie na porę dnia z powiadomieniem. Znika, gdy wszystko z pory jest odhaczone. Inną godzinę albo „nie” dla pojedynczej pozycji wpisujesz w arkuszu, w kolumnie „Przypomnienie”.</p></div>
        <button type="button" class="btn-sm${r.enabled ? '' : ' primary'}" data-rem="${r.enabled ? '0' : '1'}">${r.enabled ? 'Wyłącz' : 'Włącz'}</button></div>
      <p class="line">${r.enabled ? `Włączone. Wydarzeń w kalendarzu: ${r.count || 0}${kiedySync ? ', ostatnia zmiana ' + kiedySync : ''}.` : 'Wyłączone.'}</p>
      ${r.error ? `<p class="err">${esc(r.error)}</p>` : ''}
      <ul class="plain">${pory}</ul>
      <p class="hint-avg">Godziny pór zmieniasz w arkuszu, w zakładce Pory dnia. Pierwsze włączenie: w Apps Script uruchom raz funkcję wlaczPrzypomnienia (zgoda na Kalendarz).</p></section>
    ${devPanel.html()}
    <section class="panel" aria-labelledby="h-ark"><h2 id="h-ark">W arkuszu</h2>
      <p class="desc">Na razie tylko w arkuszu zmieniasz: terapie, pozycje (dawka, harmonogram, pory), pory dnia i opakowania. Zmiana dawki albo leku: starej pozycji wpisz datę „Do” i status „zakończona”, a nową dodaj w nowym wierszu.</p>
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
    app.innerHTML = tab === 'terapie' ? viewTerapie(S) : tab === 'ustawienia' ? viewUstawienia() : viewDzis(S);
    if (zachowaj && $('pairBox')) $('pairBox').replaceWith(zachowaj);
    document.querySelectorAll('[data-tab]').forEach(b => { if (b.closest('#tabbar') || b.classList.contains('ib')) { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); } });
    $('gearDot').classList.toggle('on', devPanel.newOnes().length > 0);
    const a = $('abSheet');
    if (D.sheetUrl) { a.href = D.sheetUrl; a.hidden = false; } else a.hidden = true;
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
    if (sheetOn) return;
    sheetOn = true; wrocDo = document.activeElement;
    const s = $('sheet'), bg = $('sheetBg');
    s.hidden = false; bg.hidden = false;
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

  /* ---------------- okna: podanie, tydzień, doraźne, opakowanie ---------------- */
  const POWODY = p => ['zapomniałem', lekowe(p) ? 'brak leku' : 'skończyło się', 'zalecenie lekarza', 'inne'];
  const krok = p => (p.dawkaN % 1 ? 0.5 : 1);
  function poleIlosci(p) {
    return `<div class="qty"><button type="button" data-q="-1" aria-label="Mniej">−</button>
      <label><span class="sr">Ilość</span><input id="shQty" inputmode="decimal" autocomplete="off" value="${esc(String(p.dawkaN).replace('.', ','))}"><em>${esc(L.jednostka(p.dawkaN, p.jednostka))}</em></label>
      <button type="button" data-q="1" aria-label="Więcej">+</button></div>`;
  }
  const czytajIlosc = p => { const n = Number(String($('shQty') ? $('shQty').value : '').replace(',', '.')); return n >= 0 && n <= 100000 && isFinite(n) && String($('shQty').value).trim() !== '' ? n : p.dawkaN; };
  const notatka = () => ($('shNote') ? $('shNote').value.trim().slice(0, 200) : '');

  /** Okno jednego podania: do odhaczenia (ilość, notatka, pominięcie z powodem) albo już odhaczonego (cofnięcie). */
  function oknoPodania(s, tryb) {
    const S = stan(), p = s.p;
    if (!p) return;
    const w = S.idx.sloty[L.kluczSlotu(s.data, s.pora, p.id)] || null;
    const gdzie = `${nazwaPory(s.pora)}, ${kiedy(s.data, S.dzis)}`;
    const sub = `<p class="sh-sub">${esc([podpis(p), gdzie].filter(Boolean).join(' · '))}</p>`;
    if (w) {
      otworz(p.nazwa, `${sub}<div class="sh-state">${esc(cap(opisWpisu(p, w, S.dzis)))}${w.notatka ? `<small>${esc(w.notatka)}</small>` : ''}${w.czeka ? '<small>Czeka na wysłanie do arkusza.</small>' : ''}</div>
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
      `<li><span>${esc(cap(kiedy(w.data, S.dzis)))}: ${esc(opisWpisu(p, w, S.dzis))}</span><button type="button" class="edit warn-txt" data-sh-undo="${esc(w.id)}">Cofnij</button></li>`).join('')}</ul>` : '';
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
  function oknoOpakowania(id) {
    const S = stan(), z = S.zapasy.filter(x => x.opak.id === id)[0];
    if (!z) return;
    const p = z.p, o = z.opak;
    otworz(p.nazwa + ': skończyło się', `<p class="sh-sub">Opakowanie otwarte ${esc(o.otwarto ? L.dataPl(o.otwarto, S.dzis) : 'nie wiadomo kiedy')}. Zapisuję, że skończyło się dziś.</p>
      <h3 class="sh-h">Nowe opakowanie</h3>
      <label class="field"><span>Ile jest w nowym opakowaniu${p.jednostka ? ' (' + esc(L.jednostka(5, p.jednostka)) + ')' : ''}? Puste = nie wiem</span><input id="shPack" inputmode="decimal" autocomplete="off" value="${z.znane ? esc(String(z.razem).replace('.', ',')) : ''}"></label>
      <label class="field"><span>Ważne do (jeśli jest termin po otwarciu)</span><input id="shExp" type="date"></label>
      <button type="button" class="save" data-sh-finish="nowe">Skończyło się, otwieram nowe</button>
      <button type="button" class="second" data-sh-finish="bez">Skończyło się, nowego jeszcze nie mam</button>`, { opak: id, p: p });
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
      }
    });

    $('sheet').addEventListener('click', e => {
      const c = sheetCtx;
      let b;
      if (!c) return;
      if ((b = e.target.closest('[data-q]'))) {
        const inp = $('shQty'), k = krok(c.p), n = Math.max(0, Math.round((czytajIlosc(c.p) + k * Number(b.dataset.q)) * 100) / 100);
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
      if ((b = e.target.closest('[data-sh-finish]'))) {
        const il = Number(String($('shPack').value).replace(',', '.')), exp = $('shExp').value;
        const arg = { id: c.opak, data: dzis(), nowe: b.dataset.shFinish === 'nowe' ? { ilosc: il > 0 ? il : null, wazneDo: exp || null } : null };
        const nazwa = c.p.nazwa, nowe = !!arg.nowe;
        wyslij('finishPackage', arg, b).then(r => { if (r) { zamknij(); toast(esc(nazwa) + (nowe ? ': nowe opakowanie otwarte.' : ': opakowanie zamknięte. Nowe dodasz w arkuszu, w zakładce Opakowania.')); } });
      }
    });

    Rdzen.outbox.onChange(x => {
      const now = Date.now();
      x.sent.forEach(s => recent.push(Object.assign({}, s.item, { sentAt: now })));
      if (x.model) ustawModel(x.model); else render();
      if (x.failed.length) toast('Nie udało się zapisać: ' + esc(x.failed[0].error || 'spróbuj ponownie'));
    });
    // zmiana dnia przy otwartej aplikacji
    setInterval(() => { if (D && dzis() !== lastDay && !sheetOn) render(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && D && dzis() !== lastDay && !sheetOn) render(); });
  }

  window.startApp = model => {
    D = model; ctx = L.przygotuj(D);
    if (!inited) init();
    render();
    return { apply(m) { D = m; ctx = L.przygotuj(D); przytnijRecent(); render(); } };
  };
  Rdzen.boot();
})();
