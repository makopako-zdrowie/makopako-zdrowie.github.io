/****************************************************************
 * ZDROWIE – wspólna logika (v1.1)
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
  /** Kolumna „Przypomnienie”: puste = o godzinie pory, „nie” = bez przypomnienia, „22:00” = własna godzina. */
  function przypomnienie(t) {
    const s = String(t == null ? '' : t).trim().toLowerCase();
    if (!s) return '';
    if (/^(nie|bez|brak|-|–)/.test(s)) return 'nie';
    const m = s.match(/^(\d{1,2})[:.](\d{2})$/);
    return m && +m[1] < 24 && +m[2] < 60 ? two(+m[1]) + ':' + m[2] : '';
  }
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
      dawkaN: p.dawka > 0 ? p.dawka : 1,
      przyp: przypomnienie(p.przypomnienie)
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
  /**
   * Na każdy z najbliższych dni: co zostało bez odpowiedzi, zgrupowane po godzinie przypomnienia
   * (godzina pory albo własna godzina pozycji; pozycje z „nie” pomijamy). [{ data, klucz, nazwa, godzina, nazwy }]
   */
  function przypomnienia(ctx, idx, dzis, ileDni) {
    const out = [];
    for (let k = 0; k < (ileDni || 7); k++) {
      const d = plus(dzis, k), grupy = {}, kolej = [];
      const dodaj = (p, kl) => {
        if (p.przyp === 'nie') return;
        const pora = ctx.poryMap[kl], godz = p.przyp || godzinaPory(pora, d) || '12:00', g = godz + '|' + kl;
        if (!grupy[g]) { grupy[g] = { data: d, klucz: kl, nazwa: pora ? pora.nazwa : kl, godzina: godz, nazwy: [] }; kolej.push(g); }
        grupy[g].nazwy.push(p.nazwa);
      };
      dzien(ctx, idx, d).forEach(karta => karta.pozycje.forEach(x => { if (x.stan === 'do') dodaj(x.p, karta.klucz); }));
      ctx.pozycje.forEach(p => { if (p.h.typ === 'tydz' && wZakresie(p, d) && tygodniowaDzis(p, idx, d)) dodaj(p, poryPozycji(p)[0]); });
      kolej.sort().forEach(g => out.push(grupy[g]));
    }
    return out;
  }

  return { num: num, str: str, plus: plus, dzienTyg: dzienTyg, poczatekTyg: poczatekTyg, poprawnaData: poprawnaData, dataPl: dataPl,
    DNI: DNI, DNI_W: DNI_W, DNI_SKROT: DNI_SKROT, harmonogram: harmonogram, opisHarmonogramu: opisHarmonogramu,
    liczba: liczba, jednostka: jednostka, ilosc: ilosc, klucz: klucz, przypomnienie: przypomnienie, przygotuj: przygotuj, poryPozycji: poryPozycji,
    kluczSlotu: kluczSlotu, indeks: indeks, stanWpisu: stanWpisu, wZakresie: wZakresie, wypada: wypada, godzinaPory: godzinaPory,
    dzien: dzien, zalegle: zalegle, tydzien: tydzien, tygodniowaDzis: tygodniowaDzis, dorazne: dorazne,
    zuzycie: zuzycie, zapasy: zapasy, przypomnienia: przypomnienia };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Logika;
