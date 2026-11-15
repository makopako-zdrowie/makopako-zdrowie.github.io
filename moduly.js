/****************************************************************
 * ZDROWIE – moduły (v2.0): Historia (kalendarz, poprawianie, ostatnie wpisy), Raport dla lekarza, edycja w aplikacji.
 * Korzysta ze wspólnych narzędzi z app.js (window.Zdrowie).
 ****************************************************************/
(function () {
  'use strict';
  const Z = window.Zdrowie, L = Z.L, esc = Z.esc, $ = Z.$;
  const MIESIACE = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
  const MIES_MSC = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu'];

  /* ================= starsze wpisy (sprzed okna modelu) przez getLog ================= */
  const cache = {}, laduje = {}, bledy = {};
  /** Wpisy z [od, do] starsze niż dziennik w modelu: [] gdy niepotrzebne, null gdy się wczytują (potem render). */
  function starsze(od, do_) {
    const D = Z.model(), oknoOd = D.dziennik && D.dziennik.od;
    if (!oknoOd || od >= oknoOd) return [];
    const kon = do_ < oknoOd ? do_ : L.plus(oknoOd, -1), k = od + '|' + kon;
    if (cache[k]) return cache[k];
    if (!laduje[k] && !bledy[k]) {
      laduje[k] = true;
      Rdzen.api('getLog', { od: od, do: kon }).then(r => { if (r && r.ok) cache[k] = r.wpisy; else bledy[k] = (r && r.error) || 'Nie udało się wczytać.'; })
        .catch(e => { bledy[k] = e.message || String(e); })
        .finally(() => { delete laduje[k]; Z.render(); });
    }
    return null;
  }
  const bladStarszych = () => Object.keys(bledy).map(k => bledy[k])[0] || '';
  // po zapisie starszych wpisów albo cofnięciu wpisu z pamięci: wczytujemy je od nowa przy następnym oglądaniu
  Z.poWyslaniu = sent => {
    const oknoOd = (Z.model().dziennik || {}).od || '';
    const stare = sent.some(s => (s.item.fn === 'logDose' && (s.item.arg.items || []).some(it => it.data < oknoOd)) ||
      (s.item.fn === 'undoDose' && (s.item.arg.ids || []).some(id => Object.keys(cache).some(k => cache[k].some(w => w.id === id)))));
    if (stare) Object.keys(cache).forEach(k => { delete cache[k]; });
  };
  Z.klik.push(e => { if (e.target.closest('[data-h-retry]')) { Object.keys(bledy).forEach(k => { delete bledy[k]; }); Z.render(); return true; } return false; });

  /* ================= HISTORIA ================= */
  const H = { widok: Z.lsGet('hist.widok') === 'lista' ? 'lista' : 'kal', mies: '', dzien: '', filtr: '' };
  const zakresMies = m => { const p = m.split('-').map(Number), nast = p[1] === 12 ? (p[0] + 1) + '-01' : p[0] + '-' + Z.two(p[1] + 1); return { od: m + '-01', do: L.plus(nast + '-01', -1) }; };
  const plusMies = (m, k) => { const p = m.split('-').map(Number); let y = p[0], mm = p[1] + k; while (mm < 1) { mm += 12; y--; } while (mm > 12) { mm -= 12; y++; } return y + '-' + Z.two(mm); };
  const ST_OPIS = { ok: 'wszystko wzięte', czesc: 'część bez odpowiedzi', pom: 'coś pominięte', brak: 'bez odpowiedzi', dzis: 'dziś, w trakcie', none: 'nic w planie', inne: 'tylko poza planem', fut: 'jeszcze przed Tobą' };
  Z.pokazDzien = d => { H.widok = 'kal'; H.mies = d.slice(0, 7); H.dzien = d; };

  function viewHistoria(S) {
    const t = S.dzis, ctx = Z.ctx();
    if (!H.mies) H.mies = t.slice(0, 7);
    if (!H.dzien) H.dzien = t;
    const seg = `<div class="seg" role="group" aria-label="Widok historii"><button type="button" data-h-widok="kal" aria-pressed="${H.widok === 'kal'}">Kalendarz</button><button type="button" data-h-widok="lista" aria-pressed="${H.widok === 'lista'}">Ostatnie wpisy</button></div>`;
    if (H.widok === 'lista') return seg + listaOstatnich(S);
    const terapie = (Z.model().terapie || []).filter(x => ctx.pozycje.some(p => p.terapia === x.id && p.status !== 'planowana'));
    const filtrHtml = terapie.length > 1 ? `<div class="chips filtr" role="group" aria-label="Terapia"><button type="button" data-h-filtr="" aria-pressed="${!H.filtr}">Wszystko</button>${terapie.map(x =>
      `<button type="button" data-h-filtr="${esc(x.id)}" aria-pressed="${H.filtr === x.id}"><i class="dot" style="background:${esc(Z.kolorTerapii(x))}"></i>${esc(x.nazwa)}</button>`).join('')}</div>` : '';
    const filtr = H.filtr ? (p => p.terapia === H.filtr) : null;
    const z = zakresMies(H.mies), stare = starsze(z.od, z.do);
    const dzienStare = H.dzien.slice(0, 7) === H.mies ? stare : starsze(H.dzien, H.dzien);
    const idx = L.indeks(Z.wpisy(stare || []));
    // kalendarz miesiąca
    const p0 = z.od, off = L.dzienTyg(p0), kom = [];
    for (let i = 0; i < off; i++) kom.push('<span class="cal-x"></span>');
    let plan = 0, wz = 0;
    for (let d = p0; d <= z.do; d = L.plus(d, 1)) {
      const s = stare === null && d < (Z.model().dziennik || {}).od ? { st: 'load' } : L.stanDnia(ctx, idx, d, t, filtr);
      if (s.plan && d <= t) { plan += d === t ? s.wz : s.plan; wz += s.wz; }
      kom.push(`<button type="button" class="cal-d st-${s.st}${d === t ? ' today' : ''}" data-h-day="${d}" aria-pressed="${d === H.dzien}" aria-label="${esc(L.dataPl(d, t))}: ${esc(ST_OPIS[s.st] || 'wczytuję')}"><span>${+d.slice(8)}</span></button>`);
    }
    const p = H.mies.split('-').map(Number), mozeDalej = H.mies < t.slice(0, 7);
    const naglowek = `<div class="cal-nav"><button type="button" class="ib" data-h-mies="-1" aria-label="Poprzedni miesiąc">‹</button><b>${MIESIACE[p[1] - 1]} ${p[0]}</b><button type="button" class="ib" data-h-mies="1" aria-label="Następny miesiąc"${mozeDalej ? '' : ' disabled'}>›</button></div>`;
    const blad = stare === null && bladStarszych() ? `<p class="err">Nie udało się wczytać starszych wpisów: ${esc(bladStarszych())} <button type="button" class="linkish" data-h-retry>Spróbuj ponownie</button></p>` : '';
    const podsum = plan ? `<p class="cal-sum">W ${MIES_MSC[p[1] - 1]}: wzięte <b>${wz} z ${plan}</b> (${Math.round(100 * wz / plan)}%)${stare === null ? ', wczytuję starsze…' : ''}</p>` : (stare === null ? '<p class="cal-sum">Wczytuję starsze wpisy…</p>' : '');
    const legenda = `<div class="cal-leg"><span><i class="st-ok"></i>wszystko</span><span><i class="st-czesc"></i>część</span><span><i class="st-pom"></i>pominięte</span><span><i class="st-brak"></i>bez odpowiedzi</span></div>`;
    const idxDnia = dzienStare === stare ? idx : L.indeks(Z.wpisy(dzienStare || []));
    return seg + filtrHtml + `<section class="panel card cal">${naglowek}<div class="cal-g">${L.DNI_SKROT.map(x => `<span class="cal-h">${x}</span>`).join('')}${kom.join('')}</div>${podsum}${legenda}${blad}</section>`
      + panelDnia(H.dzien, idxDnia, dzienStare === null && H.dzien < (Z.model().dziennik || {}).od, filtr, t);
  }

  function panelDnia(d, idx, laduje1, filtr, t) {
    const ctx = Z.ctx(), tyt = Z.cap(L.DNI[L.dzienTyg(d)]) + ', ' + L.dataPl(d, t);
    if (laduje1) return `<section class="panel card day"><header class="card-head"><h2>${esc(tyt)}</h2></header><p class="desc">Wczytuję wpisy z tego dnia…</p></section>`;
    const ok = p => !filtr || filtr(p);
    const przyszly = d > t;
    const karty = L.dzien(ctx, idx, d).map(k => Object.assign({}, k, { pozycje: k.pozycje.filter(x => ok(x.p)) })).filter(k => k.pozycje.length);
    const wiersz = (p, opis, st, akcje) => `<div class="hrow st-${st}" style="--tc:${Z.kolor(p)}"><div><b>${Z.ikona(p)}${esc(p.nazwa)}</b><small>${esc(opis)}</small></div><div class="hacts">${akcje}</div></div>`;
    const cofnijBtn = w => `<button type="button" class="btn-sm" data-h-undo="${esc(w.id)}">Cofnij</button>`;
    const plan = karty.map(k => `<h3 class="sh-h">${esc(Z.cap(k.nazwa))}${k.godzina ? ` <span class="muted num">${esc(k.godzina)}</span>` : ''}</h3>` + k.pozycje.map(x => {
      const s = Z.slot(d, x.pora, x.p);
      if (x.wpis) return wiersz(x.p, Z.opisWpisu(x.p, x.wpis) + (x.wpis.czeka ? ' · czeka na wysłanie' : ''), x.stan, cofnijBtn(x.wpis));
      if (przyszly) return wiersz(x.p, 'w planie' + (Z.dawkaTxt(x.p) ? ': ' + Z.dawkaTxt(x.p) : ''), 'fut', '');
      return wiersz(x.p, d === t ? 'jeszcze bez odpowiedzi' : 'bez odpowiedzi', 'do',
        `<button type="button" class="btn-sm yes" data-h-take="${s}">${Z.cap(Z.slowo(x.p))}</button><button type="button" class="btn-sm" data-h-skip="${s}">Pominięte</button><button type="button" class="btn-sm" data-h-nw="${s}">Nie pamiętam</button>`);
    }).join('')).join('');
    // poza planem dnia: pozycje „N razy w tygodniu”, doraźne i korekty zapasu
    const inne = idx.wszystkie.filter(w => {
      if (w.data !== d) return false;
      const p = ctx.pozMap[w.pozycja];
      if (!p || !ok(p)) return false;
      if (w.status === 'doraźnie' || w.status === 'korekta') return true;
      return p.h.typ === 'tydz' && idx.sloty[L.kluczSlotu(w.data, w.pora, w.pozycja)] === w;
    }).map(w => { const p = ctx.pozMap[w.pozycja]; return wiersz(p, Z.opisWpisu(p, w) + (w.czeka ? ' · czeka na wysłanie' : ''), w.status === 'korekta' ? 'none' : L.stanWpisu(w), cofnijBtn(w)); });
    const tygodniowe = przyszly ? [] : ctx.pozycje.filter(p => p.h.typ === 'tydz' && ok(p) && L.wZakresie(p, d) && !idx.sloty[L.kluczSlotu(d, L.poryPozycji(p)[0], p.id)])
      .map(p => wiersz(p, L.opisHarmonogramu(p.h), 'none', `<button type="button" class="btn-sm" data-h-week="${esc(d + '|' + p.id)}">${Z.cap(Z.slowo(p))} tego dnia</button>`));
    const pusto = !plan && !inne.length && !tygodniowe.length;
    return `<section class="panel card day" aria-label="${esc(tyt)}"><header class="card-head"><h2>${esc(tyt)}</h2></header>
      ${pusto ? '<p class="desc">Tego dnia nic nie było w planie.</p>' : ''}${plan}
      ${inne.length ? `<h3 class="sh-h">Poza planem</h3>${inne.join('')}` : ''}${tygodniowe.length ? `<h3 class="sh-h">Raz albo kilka razy w tygodniu</h3>${tygodniowe.join('')}` : ''}
    </section>`;
  }

  function listaOstatnich(S) {
    const ctx = Z.ctx(), lista = Z.wpisy().slice(-50).reverse();
    if (!lista.length) return '<div class="empty"><b>Jeszcze nic nie zapisano</b>Tu zobaczysz każde odhaczenie i cofniesz pomyłkę.</div>';
    return `<section class="panel card"><p class="desc">Ostatnie zapisy, najnowsze na górze. Pomyłkę cofniesz przyciskiem „Cofnij”.</p>${lista.map(w => {
      const p = ctx.pozMap[w.pozycja] || { nazwa: w.pozycja, dawkaN: 1, jednostka: '', h: {}, poryN: [] };
      const gdzie = [w.pora ? Z.nazwaPory(Logika.klucz(w.pora)) : '', Z.kiedy(w.data, S.dzis)].filter(Boolean).join(', ');
      return `<div class="hrow st-${w.status === 'korekta' || w.status === 'doraźnie' ? 'none' : L.stanWpisu(w)}" style="--tc:${ctx.pozMap[w.pozycja] ? Z.kolor(p) : 'var(--line)'}"><div><b>${ctx.pozMap[w.pozycja] ? Z.ikona(p) : ''}${esc(p.nazwa)}</b><small>${esc(gdzie)} · ${esc(Z.opisWpisu(p, w))}${w.czeka ? ' · czeka na wysłanie' : ''}</small></div>
        <div class="hacts"><button type="button" class="btn-sm" data-h-undo="${esc(w.id)}">Cofnij</button></div></div>`;
    }).join('')}</section>`;
  }

  Z.widoki.historia = viewHistoria;
  Z.klik.push(e => {
    let b;
    if ((b = e.target.closest('[data-h-widok]'))) { H.widok = b.dataset.hWidok; Z.lsSet('hist.widok', H.widok); Z.render(); return true; }
    if ((b = e.target.closest('[data-h-mies]'))) {
      if (b.disabled) return true;
      H.mies = plusMies(H.mies, Number(b.dataset.hMies));
      const t = Z.dzis();
      H.dzien = H.mies === t.slice(0, 7) ? t : zakresMies(H.mies).do > t ? t : zakresMies(H.mies).do;
      Z.render(); return true;
    }
    if ((b = e.target.closest('[data-h-day]'))) {
      H.dzien = b.dataset.hDay; Z.render();
      const panel = document.querySelector('.card.day');
      if (panel && panel.getBoundingClientRect().top > innerHeight * 0.7) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return true;
    }
    if ((b = e.target.closest('[data-h-filtr]'))) { H.filtr = b.dataset.hFiltr; Z.render(); return true; }
    if ((b = e.target.closest('[data-h-undo]'))) { if (Z.uzbrojony(b, 'Na pewno?')) Z.cofnij([b.dataset.hUndo]); return true; }
    if ((b = e.target.closest('[data-h-take]')) || (b = e.target.closest('[data-h-nw]')) || (b = e.target.closest('[data-h-skip]'))) {
      const s = Z.zeSlotu(b.dataset.hTake || b.dataset.hNw || b.dataset.hSkip);
      if (!s.p) return true;
      if (b.dataset.hSkip) { Z.oknoPodania(s, 'pomin', L.indeks(Z.wpisy(starsze(s.data, s.data) || []))); return true; }
      const nw = !!b.dataset.hNw;
      Z.zapisz([Z.nowyWpis(s.p, s.pora, s.data, nw ? 'nie pamiętam' : 'wzięte')], `${s.p.nazwa}, ${Z.kiedy(s.data, Z.dzis())}: ${nw ? 'brak danych' : Z.slowo(s.p)}`);
      return true;
    }
    if ((b = e.target.closest('[data-h-week]'))) {
      const a = b.dataset.hWeek.split('|'), p = Z.ctx().pozMap[a[1]];
      if (p) Z.zapisz([Z.nowyWpis(p, L.poryPozycji(p)[0], a[0], 'wzięte')], `${p.nazwa}, ${Z.kiedy(a[0], Z.dzis())}: ${Z.slowo(p)}`);
      return true;
    }
    return false;
  });

  /* ================= RAPORT ================= */
  const R = { terapia: '', okres: '30', od: '', do: '', pokaz: false };
  const MIES_KR = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const krotka = d => +d.slice(8) + ' ' + MIES_KR[+d.slice(5, 7) - 1];
  const pelna = d => L.dataPl(d) + ' ' + d.slice(0, 4);
  const jak = p => [Z.dawkaTxt(p), p.poryN.map(Z.nazwaPory).join(' i '), p.h.typ === 'brak' && p.dorazne ? 'tylko doraźnie' : L.opisHarmonogramu(p.h)].filter(Boolean).join(' · ');
  const nazwaBloku = b => b.wersje[b.wersje.length - 1].nazwa;
  function zakresRaportu(t) {
    const ctx = Z.ctx();
    if (R.okres === 'wlasny') return { od: R.od || L.plus(t, -29), do: R.do || t };
    if (R.okres === 'start') {
      const ter = ctx.terapie[R.terapia] || {}, ody = ctx.pozycje.filter(p => p.terapia === R.terapia && p.od).map(p => p.od).concat(ter.od ? [ter.od] : []).sort();
      return { od: ody[0] && ody[0] < t ? ody[0] : L.plus(t, -29), do: t };
    }
    return { od: L.plus(t, -(Number(R.okres) - 1)), do: t };
  }
  /** Kolejne dni z tą samą pozycją i tym samym powodem w jednym wierszu („13–15 lis”). */
  function scal(xs) {
    const grupy = {}, out = [];
    xs.forEach(x => { const k = x.co + '|' + x.powod + '|' + x.notatka; (grupy[k] = grupy[k] || []).push(x); });
    Object.keys(grupy).forEach(k => {
      let run = null;
      grupy[k].sort((a, b) => a.data.localeCompare(b.data)).forEach(x => {
        if (run && (x.data === run.do || x.data === L.plus(run.do, 1))) { run.do = x.data; if (run.pory.indexOf(x.pora) < 0) run.pory.push(x.pora); }
        else { run = { od: x.data, do: x.data, pory: [x.pora], co: x.co, powod: x.powod, notatka: x.notatka, wielePor: x.wielePor }; out.push(run); }
      });
    });
    return out.sort((a, b) => a.od.localeCompare(b.od));
  }
  const dniTxt = r => (r.od === r.do ? krotka(r.od) : (r.od.slice(0, 7) === r.do.slice(0, 7) ? +r.od.slice(8) : krotka(r.od)) + '–' + krotka(r.do));
  /** Kalendarz: miesiące z numerami dni, wiersz na każdą pozycję. */
  function kalendarzRaportu(r) {
    // od pierwszego dnia, w którym coś z tej terapii było w planie (bez pustych miesięcy wcześniej)
    const start = r.bloki.reduce((m, b) => b.wersjeStat.reduce((m2, v) => (v.od < m2 ? v.od : m2), m), r.koniec);
    const pocz = start > r.od ? start : r.od;
    let html = '';
    for (let m = pocz.slice(0, 7); m <= r.koniec.slice(0, 7); m = plusMies(m, 1)) {
      const z = zakresMies(m), od = z.od < pocz ? pocz : z.od, do_ = z.do > r.koniec ? r.koniec : z.do, dni = [];
      for (let d = od; d <= do_; d = L.plus(d, 1)) dni.push(d);
      html += `<div class="kal-wrap"><table class="kal"><caption>${MIESIACE[+m.slice(5) - 1]} ${m.slice(0, 4)}</caption>
        <thead><tr><th></th>${dni.map(d => `<th${L.dzienTyg(d) === 6 ? ' class="nd"' : ''}>${+d.slice(8)}</th>`).join('')}</tr></thead>
        <tbody>${r.bloki.map(b => { const mapa = {}; b.dni.forEach(x => { mapa[x.data] = x.st; }); return `<tr><th>${esc(nazwaBloku(b))}</th>${dni.map(d => `<td><i class="k-${mapa[d] || 'none'}"></i></td>`).join('')}</tr>`; }).join('')}</tbody></table></div>`;
    }
    return html;
  }
  function viewRaport(S) {
    const t = S.dzis, ctx = Z.ctx(), D = Z.model();
    const terapie = (D.terapie || []).filter(x => ctx.pozycje.some(p => p.terapia === x.id));
    if (!terapie.length) return '<div class="empty"><b>Nie ma jeszcze terapii z pozycjami</b>Raport powstaje dla jednej terapii, z odhaczeń w dzienniku.</div>';
    if (!R.terapia || !ctx.terapie[R.terapia]) R.terapia = terapie[0].id;
    const okresy = [['30', '30 dni'], ['90', '90 dni'], ['start', 'od początku terapii'], ['wlasny', 'własny']];
    const z = zakresRaportu(t);
    const form = `<section class="panel card rep-form"><h2 class="rep-h">Raport dla lekarza</h2><p class="desc">Jedna strona na wizytę: co i kiedy brałeś, czego nie wziąłeś i dlaczego.</p>
      <label class="field"><span>Pacjent (na raporcie; zapamiętane tylko na tym urządzeniu)</span><input id="rPacjent" maxlength="60" autocomplete="name" value="${esc(Z.lsGet('pacjent') || '')}" placeholder="imię i nazwisko"></label>
      <h3 class="sh-h">Terapia</h3><div class="chips" role="group" aria-label="Terapia">${terapie.map(x => `<button type="button" data-r-ter="${esc(x.id)}" aria-pressed="${R.terapia === x.id}"><i class="dot" style="background:${esc(Z.kolorTerapii(x))}"></i>${esc(x.nazwa)}</button>`).join('')}</div>
      <h3 class="sh-h">Okres</h3><div class="chips" role="group" aria-label="Okres">${okresy.map(o => `<button type="button" data-r-okres="${o[0]}" aria-pressed="${R.okres === o[0]}">${o[1]}</button>`).join('')}</div>
      ${R.okres === 'wlasny' ? `<div class="two-col"><label class="field"><span>Od</span><input type="date" id="rOd" value="${esc(z.od)}" max="${t}"></label><label class="field"><span>Do</span><input type="date" id="rDo" value="${esc(z.do)}" max="${t}"></label></div>` : `<p class="hint-avg">${esc(L.dataPl(z.od, t))} – ${esc(L.dataPl(z.do, t))}</p>`}
      <p class="err" id="rErr"></p>
      <button type="button" class="save" data-r-show>${R.pokaz ? 'Odśwież raport' : 'Pokaż raport'}</button></section>`;
    if (!R.pokaz) return form;
    if (L.num(z.do) - L.num(z.od) > 400) return form + '<p class="err">Raport obejmuje najwyżej 400 dni. Skróć okres.</p>';
    const stare = starsze(z.od, z.do);
    if (stare === null) return form + (bladStarszych() ? `<p class="err">Nie udało się wczytać dziennika: ${esc(bladStarszych())} <button type="button" class="linkish" data-h-retry>Spróbuj ponownie</button></p>` : '<div class="panel card"><p class="desc">Wczytuję dziennik z tego okresu…</p></div>');
    const r = L.raport(ctx, Z.wpisy(stare), R.terapia, z.od, z.do, t), ter = ctx.terapie[R.terapia], pacjent = (Z.lsGet('pacjent') || '').trim();
    let plan = 0, wz = 0;
    r.bloki.forEach(b => { plan += b.plan; wz += b.wz; });
    // co i kiedy: wiersz na każdą wersję (zmiana dawki = nowy wiersz)
    const coKiedy = r.bloki.map(b => b.wersjeStat.map(v => `<tr><td><b>${esc(v.p.nazwa)}</b></td><td>${esc(jak(v.p))}</td>
      <td class="num">${esc(krotka(v.od))} – ${v.do ? esc(krotka(v.do)) : 'nadal'}</td>
      <td class="num">${v.plan ? `${v.wz} z ${v.plan} <b>(${Math.round(100 * v.wz / v.plan)}%)</b>` : '–'}</td></tr>`).join('')).join('');
    // czego nie wziąłem
    const braki = scal([].concat.apply([], r.bloki.map(b => {
      const wiele = b.wersje.some(p => p.poryN.length > 1);
      return b.pominiete.map(x => ({ data: x.data, pora: x.pora, co: nazwaBloku(b), powod: x.powod || 'pominięte', notatka: x.notatka || '', wielePor: wiele }))
        .concat(b.braki.map(x => ({ data: x.data, pora: x.pora, co: nazwaBloku(b), powod: 'brak danych', notatka: '', wielePor: wiele })));
    })));
    r.bloki.forEach(b => b.brakiTyg.forEach(x => braki.push({ od: x.od, do: x.do, pory: [], co: nazwaBloku(b), powod: 'brak danych' + (x.n > 1 ? ' (' + x.n + '×)' : ''), notatka: '', tydz: true })));
    braki.sort((a, b) => a.od.localeCompare(b.od));
    const nieWziete = braki.length ? `<table class="rt"><thead><tr><th>Kiedy</th><th>Co</th><th>Dlaczego</th></tr></thead><tbody>${braki.map(x =>
      `<tr><td class="num">${x.tydz ? 'tydzień ' : ''}${esc(dniTxt(x))}${x.wielePor ? ' <span class="pora">' + esc(x.pory.map(Z.nazwaPory).join(', ')) + '</span>' : ''}</td><td>${esc(x.co)}</td><td>${esc(x.powod)}${x.notatka ? ' – ' + esc(x.notatka) : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p>Wszystko według planu.</p>';
    // doraźne
    const dor = r.bloki.filter(b => b.dor).map(b => `<p><b>${esc(nazwaBloku(b))}:</b> ${b.dor} ${b.dor === 1 ? 'raz' : 'razy'}, średnio ${String(b.dorNaTydz).replace('.', ',')} w tygodniu.</p>
      <p class="rep-dor">${b.dorWpisy.map(w => esc(krotka(w.data) + (w.godz ? ' ' + w.godz : '') + (w.ilosc > 1 ? ' (' + Z.dawkaTxt(w.p || b.wersje[0], w.ilosc) + ')' : '') + (w.notatka ? ' – ' + w.notatka : ''))).join('; ')}</p>`).join('');
    const rep = `<article class="report" aria-label="Raport">
      <header class="rep-head"><h2>Raport: ${esc(ter.nazwa)}</h2>
        ${pacjent ? `<p>Pacjent: <b>${esc(pacjent)}</b></p>` : ''}
        <p>Okres: ${esc(pelna(r.od))} – ${esc(pelna(r.koniec))} (${Z.dni(r.dniOkresu)})${plan ? ` · wzięte łącznie <b>${wz} z ${plan} (${Math.round(100 * wz / plan)}%)</b>` : ''}</p></header>
      <section class="rs"><h3>Co i kiedy</h3>${coKiedy ? `<table class="rt"><thead><tr><th>Co</th><th>Jak</th><th>Kiedy</th><th>Wzięte</th></tr></thead><tbody>${coKiedy}</tbody></table>` : '<p>W tym okresie nic nie było w planie.</p>'}</section>
      ${r.bloki.length ? `<section class="rs"><h3>Kalendarz</h3>${kalendarzRaportu(r)}
        <p class="rep-leg"><span><i class="k-ok"></i>wzięte</span><span><i class="k-czesc"></i>część</span><span><i class="k-pom"></i>niewzięte</span><span><i class="k-brak"></i>brak danych</span><span><i class="k-dor"></i>doraźnie</span></p></section>` : ''}
      <section class="rs"><h3>Czego nie wziąłem</h3>${nieWziete}</section>
      ${dor ? `<section class="rs"><h3>Doraźnie</h3>${dor}</section>` : ''}
      <p class="rep-foot">Przygotowano ${esc(pelna(t))} w aplikacji Zdrowie, z codziennych odhaczeń.</p>
    </article>
    <div class="dev-acts center rep-acts"><button type="button" class="btn-sm primary-sm" data-print>Drukuj albo zapisz PDF</button></div>`;
    return form + rep;
  }
  document.addEventListener('input', e => { if (e.target && e.target.id === 'rPacjent') Z.lsSet('pacjent', e.target.value.trim().slice(0, 60)); });
  Z.widoki.raport = viewRaport;
  Z.klik.push(e => {
    let b;
    if ((b = e.target.closest('[data-r-ter]'))) { R.terapia = b.dataset.rTer; Z.render(); return true; }
    if ((b = e.target.closest('[data-r-okres]'))) {
      if (b.dataset.rOkres === 'wlasny' && R.okres !== 'wlasny') { const z = zakresRaportu(Z.dzis()); R.od = z.od; R.do = z.do; }
      R.okres = b.dataset.rOkres; Z.render(); return true;
    }
    if (e.target.closest('[data-r-show]')) {
      if (R.okres === 'wlasny') {
        const od = ($('rOd') || {}).value, do_ = ($('rDo') || {}).value;
        if (!L.poprawnaData(od) || !L.poprawnaData(do_) || od > do_) { $('rErr').textContent = 'Wybierz poprawny okres: „od” nie później niż „do”.'; return true; }
        R.od = od; R.do = do_;
      }
      R.pokaz = true; Z.render();
      const rep = document.querySelector('.report');
      if (rep) rep.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return true;
    }
    if (e.target.closest('[data-print]')) { window.print(); return true; }
    return false;
  });

  /* ================= EDYCJA: terapia ================= */
  const KOLORY = ['#4fa3e0', '#2fbf93', '#e0b84c', '#c0567a', '#9b7be0', '#e0894c', '#5cc8d6', '#a3b84f'];
  function oknoTerapii(t) {
    t = t || {};
    const kol = t.kolor || KOLORY[(Z.model().terapie || []).length % KOLORY.length];
    Z.otworz(t.id ? 'Terapia: ' + t.nazwa : 'Nowa terapia', `<p class="sh-sub">Lekarz albo obszar leczenia. Raport powstaje dla jednej terapii.</p>
      <label class="field"><span>Nazwa</span><input id="fTNazwa" maxlength="60" autocomplete="off" value="${esc(t.nazwa || '')}" placeholder="np. Pulmonologia"></label>
      <label class="field"><span>Lekarz (nieobowiązkowo)</span><input id="fTLek" maxlength="60" autocomplete="off" value="${esc(t.lekarz || '')}"></label>
      <label class="field"><span>Specjalizacja (nieobowiązkowo)</span><input id="fTSpec" maxlength="40" autocomplete="off" value="${esc(t.specjalizacja || '')}"></label>
      <label class="field"><span>Uwagi (nieobowiązkowo)</span><input id="fTUw" maxlength="200" autocomplete="off" value="${esc(t.uwagi || '')}"></label>
      <h3 class="sh-h">Kolor</h3><div class="chips kolory" role="group" aria-label="Kolor">${KOLORY.map(k => `<button type="button" data-f-kolor="${k}" aria-pressed="${k === kol}" aria-label="Kolor ${k}"><i style="background:${k}"></i></button>`).join('')}</div>
      <p class="err" id="fErr"></p>
      <button type="button" class="save" data-f-save-t>${t.id ? 'Zapisz' : 'Dodaj terapię'}</button>`, { forma: 'terapia', t: t, kolor: kol });
  }

  /* ================= EDYCJA: pozycja ================= */
  const HT = [['codziennie', 'codziennie'], ['coDni', 'co kilka dni'], ['dniTyg', 'wybrane dni'], ['tydz', 'kilka razy w tygodniu'], ['coTyg', 'co kilka tygodni'], ['cykl', 'cykl z przerwą'], ['raz', 'jednorazowo'], ['brak', 'tylko doraźnie']];
  const RODZAJE = ['lek', 'suplement', 'kosmetyk', 'zabieg'];
  const POSTACIE = ['inhalator', 'krople', 'tabletka', 'kapsułka', 'saszetka', 'syrop', 'ampułka', 'zastrzyk', 'szampon', 'peeling', 'maść', 'krem', 'plaster'];
  const JEDNOSTKI = ['wdech', 'kropla', 'tabletka', 'kapsułka', 'saszetka', 'ampułki', 'łyżeczka', 'ml', 'mg', 'IU', 'psiknięcie', 'mycie', 'zabieg', 'porcja'];
  let F = null;                                  // stan formularza pozycji
  function harmZPozycji(h) {
    const f = { typ: 'codziennie', n: 2, dni: [], pref: [], a: 21, b: 7 };
    if (!h || h.typ === 'blad') return f;
    f.typ = h.typ;
    if (h.typ === 'coDni' || h.typ === 'coTyg' || h.typ === 'tydz') f.n = h.n;
    if (h.typ === 'dniTyg') f.dni = h.dni.slice();
    if (h.typ === 'tydz') f.pref = h.pref.slice();
    if (h.typ === 'cykl') { f.a = h.a; f.b = h.b; }
    return f;
  }
  function harmTekst(f) {
    const n = Math.max(1, Math.round(Number(f.n) || 1)), dni = x => x.slice().sort((a, b) => a - b).map(d => L.DNI_SKROT[d]).join(',');
    switch (f.typ) {
      case 'coDni': return n === 1 ? 'codziennie' : 'co ' + n + ' dni';
      case 'dniTyg': return f.dni.length ? dni(f.dni) : '';
      case 'tydz': return Math.min(7, n) + 'x/tydz' + (f.pref.length ? ' ' + dni(f.pref) : '');
      case 'coTyg': return 'co ' + n + ' tyg';
      case 'cykl': return 'cykl ' + Math.max(1, Math.round(Number(f.a) || 1)) + '/' + Math.max(0, Math.round(Number(f.b) || 0));
      case 'raz': return 'jednorazowo';
      case 'brak': return '';
      default: return 'codziennie';
    }
  }
  const dniChips = (attr, wybrane) => `<div class="chips dni" role="group">${L.DNI_SKROT.map((x, i) => `<button type="button" ${attr}="${i}" aria-pressed="${wybrane.indexOf(i) >= 0}">${x}</button>`).join('')}</div>`;
  function harmExtra() {
    const f = F.harm;
    const liczba = (lab, id, v, min, max) => `<label class="field inline"><span>${lab}</span><input id="${id}" class="num-in" type="number" inputmode="numeric" min="${min}" max="${max}" value="${esc(String(v))}"></label>`;
    switch (f.typ) {
      case 'coDni': return liczba('Co ile dni', 'fHN', f.n, 2, 60);
      case 'coTyg': return liczba('Co ile tygodni', 'fHN', f.n, 1, 52);
      case 'dniTyg': return `<p class="hint-avg">W które dni:</p>${dniChips('data-f-dzien', f.dni)}`;
      case 'tydz': return liczba('Ile razy w tygodniu', 'fHN', f.n, 1, 7) + `<p class="hint-avg">Najlepiej w (nieobowiązkowo):</p>${dniChips('data-f-pref', f.pref)}`;
      case 'cykl': return `<div class="two-col">${liczba('Dni brania', 'fHA', f.a, 1, 365)}${liczba('Dni przerwy', 'fHB', f.b, 0, 365)}</div>`;
      default: return '';
    }
  }
  function oknoPozycji(p, terapiaId) {
    const ctx = Z.ctx(), D = Z.model(), t = Z.dzis(), nowa = !p;
    p = p || { terapia: terapiaId || ((D.terapie || [])[0] || {}).id || '', nazwa: '', rodzaj: 'lek', postac: '', dawka: null, jednostka: '', h: { typ: 'codziennie' }, poryN: [], dorazne: false, warunki: '', przyp: '', uwagi: '', status: 'nowa' };
    F = { p: p, nowa: nowa, harm: harmZPozycji(p.h), pory: p.poryN.slice(), rodzaj: p.rodzaj || 'lek', przyp: p.przyp === 'nie' ? 'nie' : p.przyp ? 'godz' : 'pora', start: 'dzis', od: t };
    if (!F.pory.length && nowa && ctx.pory.length) F.pory = [ctx.pory[0].klucz];
    const lista = (id, xs) => `<datalist id="${id}">${xs.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>`;
    Z.otworz(nowa ? 'Nowa pozycja' : p.nazwa, `
      <label class="field"><span>Nazwa</span><input id="fNazwa" maxlength="60" autocomplete="off" value="${esc(p.nazwa)}" placeholder="np. nazwa leku albo zabiegu"></label>
      <label class="field"><span>Terapia</span><select id="fTer">${(D.terapie || []).map(x => `<option value="${esc(x.id)}"${x.id === p.terapia ? ' selected' : ''}>${esc(x.nazwa)}</option>`).join('')}</select></label>
      <h3 class="sh-h">Rodzaj</h3><div class="chips" role="group" aria-label="Rodzaj">${RODZAJE.map(r => `<button type="button" data-f-rodzaj="${r}" aria-pressed="${F.rodzaj === r}">${r}</button>`).join('')}</div>
      <label class="field"><span>Postać (nieobowiązkowo)</span><input id="fPostac" list="dlPostac" maxlength="40" autocomplete="off" value="${esc(p.postac || '')}" placeholder="np. inhalator, krople, tabletka"></label>${lista('dlPostac', POSTACIE)}
      <div class="two-col"><label class="field"><span>Dawka na raz</span><input id="fDawka" inputmode="decimal" autocomplete="off" value="${p.dawka > 0 ? esc(String(p.dawka).replace('.', ',')) : ''}" placeholder="np. 1 albo 0,5"></label>
        <label class="field"><span>Jednostka</span><input id="fJedn" list="dlJedn" maxlength="40" autocomplete="off" value="${esc(p.jednostka || '')}" placeholder="np. tabletka"></label></div>${lista('dlJedn', JEDNOSTKI)}
      <p class="hint-avg">Wpisujesz to, co zalecił lekarz. Aplikacja niczego nie podpowiada w sprawie dawek.</p>
      <h3 class="sh-h">Jak często</h3><div class="chips" role="group" aria-label="Jak często" id="fHt">${HT.map(h => `<button type="button" data-f-ht="${h[0]}" aria-pressed="${F.harm.typ === h[0]}">${h[1]}</button>`).join('')}</div>
      <div id="fHtExtra">${harmExtra()}</div>
      <div id="fPoryBox"${F.harm.typ === 'brak' ? ' hidden' : ''}><h3 class="sh-h">Pora dnia</h3><div class="chips" role="group" aria-label="Pora dnia">${ctx.pory.map(x => `<button type="button" data-f-pora="${esc(x.klucz)}" aria-pressed="${F.pory.indexOf(x.klucz) >= 0}">${esc(x.nazwa)}${x.godzina ? ' <span class="muted">' + esc(x.godzina) + '</span>' : ''}</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" id="fDor"${p.dorazne || F.harm.typ === 'brak' ? ' checked' : ''}><span>Także doraźnie (przycisk „+ Użyłem”)</span></label>
      <label class="field"><span>Warunki (nieobowiązkowo)</span><input id="fWar" maxlength="200" autocomplete="off" value="${esc(p.warunki || '')}" placeholder="np. po posiłku, nie z kawą"></label>
      <div id="fPrzypBox"${F.harm.typ === 'brak' ? ' hidden' : ''}><h3 class="sh-h">Przypomnienie</h3><div class="chips" role="group" aria-label="Przypomnienie">
        <button type="button" data-f-przyp="pora" aria-pressed="${F.przyp === 'pora'}">o godzinie pory</button><button type="button" data-f-przyp="godz" aria-pressed="${F.przyp === 'godz'}">o własnej godzinie</button><button type="button" data-f-przyp="nie" aria-pressed="${F.przyp === 'nie'}">bez przypomnienia</button></div>
        <label class="field inline" id="fPrzypGBox"${F.przyp === 'godz' ? '' : ' hidden'}><span>Godzina</span><input id="fPrzypG" type="time" value="${esc(p.przyp && p.przyp !== 'nie' ? p.przyp : '')}"></label></div>
      <label class="field"><span>Uwagi (nieobowiązkowo)</span><input id="fUw" maxlength="200" autocomplete="off" value="${esc(p.uwagi || '')}"></label>
      ${nowa ? `<h3 class="sh-h">Kiedy zaczynasz</h3><div class="chips" role="group" aria-label="Kiedy zaczynasz"><button type="button" data-f-start="dzis" aria-pressed="true">od dziś</button><button type="button" data-f-start="planowana" aria-pressed="false">później (planowana)</button></div>
        <div id="fOpBox"><h3 class="sh-h">Opakowanie (nieobowiązkowo)</h3><div class="two-col"><label class="field"><span>Ile w opakowaniu</span><input id="fOpIl" inputmode="decimal" autocomplete="off" placeholder="np. 120"></label>
          <label class="field"><span>Ważne do</span><input id="fOpW" type="date"></label></div><p class="hint-avg">Wtedy aplikacja policzy, kiedy się skończy.</p></div>` : ''}
      <div id="fOdBox" class="edit-note" hidden><b>Zmieniasz dawkę albo plan.</b> Dotychczasowe odhaczenia zostają przy starej wersji, zapas liczy się dalej.
        <div class="chips" role="group" aria-label="Od kiedy"><button type="button" data-f-od="${t}" aria-pressed="true">od dziś</button><button type="button" data-f-od="${L.plus(t, 1)}" aria-pressed="false">od jutra</button></div></div>
      <p class="err" id="fErr"></p>
      <button type="button" class="save" data-f-save-p>${nowa ? 'Dodaj' : 'Zapisz'}</button>
      ${p.status === 'aktywna' ? '<button type="button" class="danger" data-f-end>Kończę branie (od jutra nie ma w planie)</button>' : ''}
      ${p.status === 'planowana' ? '<button type="button" class="danger" data-f-del>Usuń tę planowaną pozycję</button>' : ''}`, { forma: 'pozycja', p: p });
  }
  /** Odczyt formularza pozycji → pola dla savePosition. */
  function czytajPozycje() {
    const v = id => ($(id) ? $(id).value.trim() : '');
    const h = F.harm;
    if ($('fHN')) h.n = Number($('fHN').value);
    if ($('fHA')) h.a = Number($('fHA').value);
    if ($('fHB')) h.b = Number($('fHB').value);
    const dawka = v('fDawka').replace(',', '.');
    return { terapia: v('fTer'), nazwa: v('fNazwa'), rodzaj: F.rodzaj, postac: v('fPostac'), dawka: dawka, jednostka: v('fJedn'), harmonogram: harmTekst(h),
      pory: h.typ === 'brak' ? '' : F.pory.join('+'), dorazne: !!($('fDor') && $('fDor').checked), warunki: v('fWar'), uwagi: v('fUw'),
      przypomnienie: F.przyp === 'nie' ? 'nie' : F.przyp === 'godz' ? v('fPrzypG') : '' };
  }
  /** Czy zmienia się dawka albo plan pozycji, którą już bierzesz (wtedy „od kiedy”). */
  function zmianaPlanu() {
    const p = F.p;
    if (F.nowa || p.status !== 'aktywna' || !p.od || p.od >= Z.dzis()) return false;
    const f = czytajPozycje(), dawka = Number(f.dawka) || null;
    return dawka !== (p.dawka > 0 ? p.dawka : null) || f.jednostka !== (p.jednostka || '') ||
      JSON.stringify(L.harmonogram(f.harmonogram)) !== JSON.stringify(L.harmonogram(p.harmonogram)) || f.pory !== p.poryN.join('+');
  }
  const odswiezOd = () => { const box = $('fOdBox'); if (box && F) box.hidden = !zmianaPlanu(); };
  const zaznacz = (b, grupa) => { b.closest('[role="group"]').querySelectorAll(grupa).forEach(x => x.setAttribute('aria-pressed', String(x === b))); };

  Z.klik.push(e => {
    let b;
    if ((b = e.target.closest('[data-edit-p]'))) { const p = Z.ctx().pozMap[b.dataset.editP]; if (p) oknoPozycji(p); return true; }
    if ((b = e.target.closest('[data-new-p]'))) { oknoPozycji(null, b.dataset.newP); return true; }
    if ((b = e.target.closest('[data-edit-t]'))) { const t = Z.ctx().terapie[b.dataset.editT]; if (t) oknoTerapii(t); return true; }
    if (e.target.closest('[data-new-t]')) { oknoTerapii(null); return true; }
    return false;
  });
  Z.klikOkno.push((e, c) => {
    let b;
    if (c.forma === 'terapia') {
      if ((b = e.target.closest('[data-f-kolor]'))) { c.kolor = b.dataset.fKolor; zaznacz(b, '[data-f-kolor]'); return true; }
      if ((b = e.target.closest('[data-f-save-t]'))) {
        const arg = { id: c.t.id || null, nazwa: $('fTNazwa').value, lekarz: $('fTLek').value, specjalizacja: $('fTSpec').value, uwagi: $('fTUw').value, kolor: c.kolor };
        if (!arg.nazwa.trim()) { $('fErr').textContent = 'Podaj nazwę terapii.'; return true; }
        Z.wyslij('saveTherapy', arg, b, null, $('fErr')).then(r => { if (r) { Z.zamknij(); Z.toast(c.t.id ? 'Zapisane.' : 'Terapia dodana. Teraz dodaj do niej leki albo zabiegi.'); } });
        return true;
      }
      return false;
    }
    if (c.forma !== 'pozycja') return false;
    if ((b = e.target.closest('[data-f-rodzaj]'))) { F.rodzaj = b.dataset.fRodzaj; zaznacz(b, '[data-f-rodzaj]'); return true; }
    if ((b = e.target.closest('[data-f-ht]'))) {
      czytajPozycje();                                                     // zapamiętaj wpisane liczby
      F.harm.typ = b.dataset.fHt; zaznacz(b, '[data-f-ht]');
      $('fHtExtra').innerHTML = harmExtra();
      $('fPoryBox').hidden = $('fPrzypBox').hidden = F.harm.typ === 'brak';
      if (F.harm.typ === 'brak') $('fDor').checked = true;
      odswiezOd(); return true;
    }
    if ((b = e.target.closest('[data-f-dzien]')) || (b = e.target.closest('[data-f-pref]'))) {
      const lista = b.dataset.fDzien !== undefined ? F.harm.dni : F.harm.pref, d = Number(b.dataset.fDzien !== undefined ? b.dataset.fDzien : b.dataset.fPref), i = lista.indexOf(d);
      if (i >= 0) lista.splice(i, 1); else lista.push(d);
      b.setAttribute('aria-pressed', String(i < 0)); odswiezOd(); return true;
    }
    if ((b = e.target.closest('[data-f-pora]'))) {
      const k = b.dataset.fPora, i = F.pory.indexOf(k);
      if (i >= 0) F.pory.splice(i, 1); else F.pory.push(k);
      const kolej = Z.ctx().pory.map(x => x.klucz);
      F.pory.sort((a, b2) => kolej.indexOf(a) - kolej.indexOf(b2));
      b.setAttribute('aria-pressed', String(i < 0)); odswiezOd(); return true;
    }
    if ((b = e.target.closest('[data-f-przyp]'))) { F.przyp = b.dataset.fPrzyp; zaznacz(b, '[data-f-przyp]'); $('fPrzypGBox').hidden = F.przyp !== 'godz'; if (F.przyp === 'godz') $('fPrzypG').focus(); return true; }
    if ((b = e.target.closest('[data-f-start]'))) { F.start = b.dataset.fStart; zaznacz(b, '[data-f-start]'); $('fOpBox').hidden = F.start !== 'dzis'; return true; }
    if ((b = e.target.closest('[data-f-od]'))) { F.od = b.dataset.fOd; zaznacz(b, '[data-f-od]'); return true; }
    if ((b = e.target.closest('[data-f-save-p]'))) {
      const pola = czytajPozycje(), err = $('fErr');
      err.textContent = '';
      if (!pola.nazwa) { err.textContent = 'Podaj nazwę.'; return true; }
      if (pola.harmonogram === '' && F.harm.typ === 'dniTyg') { err.textContent = 'Wybierz dni tygodnia.'; return true; }
      if (F.harm.typ !== 'brak' && !F.pory.length) { err.textContent = 'Wybierz porę dnia.'; return true; }
      if (F.przyp === 'godz' && !/^\d\d:\d\d/.test(pola.przypomnienie)) { err.textContent = 'Wpisz godzinę przypomnienia.'; return true; }
      if (pola.dawka && !(Number(pola.dawka) > 0)) { err.textContent = 'Dawka musi być liczbą większą od zera (np. 1 albo 0,5).'; return true; }
      const arg = { id: F.nowa ? null : F.p.id, pola: pola };
      if (F.nowa) { arg.start = F.start; if (F.start === 'dzis' && $('fOpIl')) arg.opak = { ilosc: $('fOpIl').value.replace(',', '.'), wazneDo: $('fOpW').value || null }; }
      else if (zmianaPlanu()) arg.od = F.od;
      const nazwa = pola.nazwa;
      Z.wyslij('savePosition', arg, b, null, err).then(r => {
        if (!r) return;
        Z.zamknij();
        Z.toast(esc(nazwa) + (F.nowa ? (F.start === 'dzis' ? ': dodane, od dziś w planie.' : ': dodane do planowanych.') : r.nowaWersja ? ': nowa dawka albo plan od ' + esc(Z.kiedy(arg.od, Z.dzis())) + '.' : ': zapisane.'));
      });
      return true;
    }
    if ((b = e.target.closest('[data-f-end]'))) {
      if (!Z.uzbrojony(b, 'Na pewno? Dziś to ostatni dzień')) return true;
      const p = F.p;
      Z.wyslij('endPosition', { id: p.id }, b, null, $('fErr')).then(r => { if (r) { Z.zamknij(); Z.toast(esc(p.nazwa) + ': zakończone. Historia zostaje w raporcie.'); } });
      return true;
    }
    if ((b = e.target.closest('[data-f-del]'))) {
      if (!Z.uzbrojony(b, 'Na pewno usunąć?')) return true;
      const p = F.p;
      Z.wyslij('deletePosition', { id: p.id }, b, null, $('fErr')).then(r => { if (r) { Z.zamknij(); Z.toast(esc(p.nazwa) + ': usunięte.'); } });
      return true;
    }
    return false;
  });
  $('sheet').addEventListener('input', e => { if (F && e.target.closest('#sheetBody') && /fDawka|fJedn|fHN|fHA|fHB/.test(e.target.id)) odswiezOd(); });
})();
