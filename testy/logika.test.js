/* Testy wspólnej logiki. Tylko dane fikcyjne.  Uruchom: node --test testy/ */
const test = require('node:test'), assert = require('node:assert');
const L = require('../logika.js');

const DZIS = '2026-11-15';                      // niedziela
const d = k => L.plus(DZIS, k);
const pory = [{ nazwa: 'rano', godzina: '07:30', weekend: '09:00', kolejnosc: 1 }, { nazwa: 'w ciągu dnia', godzina: '13:00', weekend: '13:00', kolejnosc: 2 }, { nazwa: 'wieczór', godzina: '21:30', weekend: '22:00', kolejnosc: 3 }];
const poz = (o) => Object.assign({ id: 'P1', terapia: 'T1', nazwa: 'Testolek', rodzaj: 'lek', dawka: 1, jednostka: 'wdech', harmonogram: 'codziennie', pory: 'rano+wieczór', dorazne: false, warunki: '', od: d(-4), do: '', status: 'aktywna' }, o);
const model = (pozycje, opakowania) => ({ terapie: [{ id: 'T1', nazwa: 'Testowa', kolor: '#4fa3e0' }], pory, pozycje, opakowania: opakowania || [] });
const wz = (data, pora, pozycja, extra) => Object.assign({ id: 'x' + Math.random(), data, pora, pozycja, status: 'wzięte', ilosc: 1 }, extra);

test('daty: dzień tygodnia, początek tygodnia, przejście przez zmianę czasu i rok', () => {
  assert.equal(L.dzienTyg('2026-11-15'), 6);
  assert.equal(L.dzienTyg('2026-11-16'), 0);
  assert.equal(L.poczatekTyg('2026-11-15'), '2026-11-09');
  assert.equal(L.plus('2026-10-24', 2), '2026-10-26');       // zmiana czasu 25.10
  assert.equal(L.plus('2026-12-31', 1), '2027-01-01');
  assert.equal(L.dataPl('2027-01-02', '2026-11-15'), '2 stycznia 2027');
  assert.equal(L.dataPl('2026-12-07', '2026-11-15'), '7 grudnia');
  assert.ok(L.poprawnaData('2026-02-28')); assert.ok(!L.poprawnaData('2026-02-30')); assert.ok(!L.poprawnaData('15.11.2026'));
});

test('harmonogram: wszystkie reguły z założeń', () => {
  assert.deepEqual(L.harmonogram('codziennie'), { typ: 'codziennie' });
  assert.deepEqual(L.harmonogram('co 2 dni'), { typ: 'coDni', n: 2 });
  assert.deepEqual(L.harmonogram('pn,śr,pt'), { typ: 'dniTyg', dni: [0, 2, 4] });
  assert.deepEqual(L.harmonogram('Pn, Sr, Pt'), { typ: 'dniTyg', dni: [0, 2, 4] });
  assert.deepEqual(L.harmonogram('2x/tydz'), { typ: 'tydz', n: 2, pref: [] });
  assert.deepEqual(L.harmonogram('1x/tydz nd'), { typ: 'tydz', n: 1, pref: [6] });
  assert.deepEqual(L.harmonogram('2×/tydz wt,pt'), { typ: 'tydz', n: 2, pref: [1, 4] });
  assert.deepEqual(L.harmonogram('cykl 21/7'), { typ: 'cykl', a: 21, b: 7 });
  assert.deepEqual(L.harmonogram('co 4 tyg'), { typ: 'coTyg', n: 4 });
  assert.deepEqual(L.harmonogram('jednorazowo'), { typ: 'raz' });
  assert.deepEqual(L.harmonogram(''), { typ: 'brak' });
  assert.deepEqual(L.harmonogram(null), { typ: 'brak' });
  assert.equal(L.harmonogram('kiedy chcę').typ, 'blad');
  assert.equal(L.harmonogram('1x/tydz xyz').typ, 'blad');
  assert.equal(L.opisHarmonogramu(L.harmonogram('1x/tydz nd')), 'raz w tygodniu, najlepiej w niedzielę');
});

test('ilości po polsku', () => {
  assert.equal(L.ilosc(1, 'wdech'), '1 wdech');
  assert.equal(L.ilosc(2, 'wdech'), '2 wdechy');
  assert.equal(L.ilosc(5, 'wdech'), '5 wdechów');
  assert.equal(L.ilosc(22, 'kropla'), '22 krople');
  assert.equal(L.ilosc(12, 'kropla'), '12 kropli');
  assert.equal(L.ilosc(0.5, 'ampułki'), '½ ampułki');
  assert.equal(L.ilosc(30, 'ampułki'), '30 ampułek');
  assert.equal(L.ilosc(1.5, 'tabletka'), '1½ tabletki');
  assert.equal(L.ilosc(4000, 'IU'), '4000 IU');
  assert.equal(L.ilosc(2.4, 'ml'), '2,4 ml');
});

test('plan dnia: pory w kolejności, stany z dziennika, ostatni wpis wygrywa', () => {
  const ctx = L.przygotuj(model([poz({}), poz({ id: 'P2', nazwa: 'Krople', pory: 'rano', od: d(-1) })]));
  const idx = L.indeks([wz(DZIS, 'rano', 'P1'), { id: 'a', data: DZIS, pora: 'rano', pozycja: 'P2', status: 'pominięte', powod: 'brak leku' }, wz(DZIS, 'Rano', 'P2')]);
  const karty = L.dzien(ctx, idx, DZIS);
  assert.deepEqual(karty.map(k => k.klucz), ['rano', 'wieczór']);
  assert.equal(karty[0].godzina, '09:00');                      // niedziela: godzina weekendowa
  assert.equal(L.dzien(ctx, idx, d(1))[0].godzina, '07:30');
  assert.deepEqual(karty[0].pozycje.map(x => x.stan), ['wziete', 'wziete']);
  assert.equal(karty[1].doZrobienia, 1);
});

test('plan dnia: zakres dat, planowane, zakończone, co N dni, dni tygodnia, cykl', () => {
  const ctx = L.przygotuj(model([
    poz({ id: 'A', od: d(1) }), poz({ id: 'B', status: 'planowana', od: '' }), poz({ id: 'C', status: 'zakończona', od: d(-30), do: d(-1) }),
    poz({ id: 'D', harmonogram: 'co 2 dni', pory: 'wieczór', od: d(-4) }), poz({ id: 'E', harmonogram: 'pn,śr', pory: 'rano', od: d(-30) }),
    poz({ id: 'F', harmonogram: 'cykl 3/2', pory: 'rano', od: d(-5) }), poz({ id: 'G', harmonogram: 'co 1 tyg', pory: '', od: d(-14) }),
    poz({ id: 'H', status: 'zakończona', od: d(-30), do: '' })
  ]));
  const jest = (id, data) => L.wypada(ctx.pozMap[id], data);
  assert.ok(!jest('A', DZIS)); assert.ok(jest('A', d(1)));
  assert.ok(!jest('B', DZIS));
  assert.ok(!jest('C', DZIS)); assert.ok(jest('C', d(-1))); assert.ok(jest('C', d(-30))); assert.ok(!jest('C', d(-31)));
  assert.ok(jest('D', DZIS)); assert.ok(!jest('D', d(-1))); assert.ok(jest('D', d(-2)));
  assert.ok(!jest('E', DZIS)); assert.ok(jest('E', d(1))); assert.ok(jest('E', d(3)));
  assert.deepEqual([-5, -4, -3, -2, -1, 0].map(k => jest('F', d(k))), [true, true, true, false, false, true]);
  assert.ok(jest('G', DZIS)); assert.ok(!jest('G', d(-1))); assert.ok(jest('G', d(7)));
  assert.ok(!jest('H', d(-3)));
  assert.equal(L.dzien(ctx, L.indeks([]), DZIS).filter(k => k.klucz === 'w ciągu dnia')[0].pozycje[0].p.id, 'G');   // bez pory → w ciągu dnia
});

test('„Wziąłeś?”: tylko 3 dni wstecz, tylko podania bez odpowiedzi; „nie pamiętam” kończy pytanie', () => {
  const ctx = L.przygotuj(model([poz({ od: d(-10) })]));
  const wpisy = [wz(d(-1), 'rano', 'P1'), { id: 'n', data: d(-2), pora: 'wieczór', pozycja: 'P1', status: 'nie pamiętam' }];
  const z = L.zalegle(ctx, L.indeks(wpisy), DZIS, 3);
  assert.deepEqual(z.map(g => g.data + ' ' + g.klucz), [d(-1) + ' wieczór', d(-2) + ' rano', d(-3) + ' rano', d(-3) + ' wieczór']);
  assert.equal(z[0].dniTemu, 1);
  const karta = L.dzien(ctx, L.indeks(wpisy), d(-2));
  assert.equal(karta[1].pozycje[0].stan, 'niewiem');
});

test('tydzień: licznik, dzień preferowany, przypominanie', () => {
  const peeling = poz({ id: 'W', nazwa: 'Peeling', rodzaj: 'kosmetyk', harmonogram: '1x/tydz nd', pory: 'w ciągu dnia', od: d(-20) });
  const ctx = L.przygotuj(model([peeling]));
  let t = L.tydzien(ctx, L.indeks([]), DZIS)[0];
  assert.equal(t.zostalo, 1); assert.ok(t.prefDzis); assert.equal(t.dniDoKonca, 0);
  assert.ok(L.tygodniowaDzis(ctx.pozMap.W, L.indeks([]), DZIS));
  assert.ok(!L.tygodniowaDzis(ctx.pozMap.W, L.indeks([]), d(-2)));            // piątek: jeszcze nie
  t = L.tydzien(ctx, L.indeks([wz(d(-3), 'w ciągu dnia', 'W')]), DZIS)[0];
  assert.equal(t.zostalo, 0); assert.equal(t.wziete, 1);
  assert.equal(L.tydzien(ctx, L.indeks([wz(d(-7), 'w ciągu dnia', 'W')]), DZIS)[0].zostalo, 1);   // zeszły tydzień się nie liczy
  // 2 razy w tygodniu bez dni: przypomnienie dopiero, gdy kończą się dni
  const ctx2 = L.przygotuj(model([poz({ id: 'S', harmonogram: '2x/tydz', pory: 'rano', od: d(-20) })]));
  assert.ok(!L.tygodniowaDzis(ctx2.pozMap.S, L.indeks([]), d(-2)));           // piątek: zostały 3 dni
  assert.ok(L.tygodniowaDzis(ctx2.pozMap.S, L.indeks([]), d(-1)));            // sobota: zostały 2 dni na 2 razy
  assert.ok(!L.tygodniowaDzis(ctx2.pozMap.S, L.indeks([wz(d(-4), 'rano', 'S')]), d(-1)));
  // preferowany dzień minął: przypomina do końca tygodnia
  const ctx3 = L.przygotuj(model([poz({ id: 'M', harmonogram: '1x/tydz śr', pory: 'rano', od: d(-20) })]));
  assert.ok(!L.tygodniowaDzis(ctx3.pozMap.M, L.indeks([]), d(-5)));           // wtorek
  assert.ok(L.tygodniowaDzis(ctx3.pozMap.M, L.indeks([]), d(-4)));            // środa
  assert.ok(L.tygodniowaDzis(ctx3.pozMap.M, L.indeks([]), d(-2)));            // piątek
  assert.ok(L.tydzien(ctx3, L.indeks([]), d(-2))[0].prefMinal);
});

test('zapas: przykład z założeń (106 dawek od 11.11, 2 dziennie → 2 stycznia) i dawkowanie 2+2', () => {
  const p = poz({ od: '2026-11-11', dorazne: true });
  const o = { id: 'O1', pozycja: 'P1', otwarto: '2026-11-11', ilosc: 106, wazneDo: '2027-02-10', alertDni: 14, skonczone: '' };
  const wpisy = [];
  for (let k = -4; k <= -1; k++) { wpisy.push(wz(d(k), 'rano', 'P1')); wpisy.push(wz(d(k), 'wieczór', 'P1')); }
  let z = L.zapasy(L.przygotuj(model([p], [o])), L.indeks(wpisy), DZIS)[0];
  assert.equal(z.zuzyte, 8); assert.equal(z.zostalo, 98);
  assert.equal(z.koniec, '2027-01-02'); assert.equal(z.powod, 'dawki'); assert.ok(!z.alert);
  // użycie doraźne przesuwa koniec; dwa doraźne = dzień wcześniej
  const dor = [0, 1].map(i => ({ id: 'd' + i, data: d(-1), pozycja: 'P1', status: 'doraźnie', ilosc: 1 }));
  z = L.zapasy(L.przygotuj(model([p], [o])), L.indeks(wpisy.concat(dor)), DZIS)[0];
  assert.equal(z.koniec, '2027-01-01');
  // 2 wdechy na porę
  const p2 = poz({ od: '2026-11-11', dawka: 2 });
  z = L.zapasy(L.przygotuj(model([p2], [o])), L.indeks(wpisy.map(w => Object.assign({}, w, { ilosc: 2 }))), DZIS)[0];
  assert.equal(z.zostalo, 90); assert.equal(z.koniec, '2026-12-06');
  // dzisiejsze odhaczenie nie zmienia daty końca (to samo zużycie, tylko już zapisane)
  z = L.zapasy(L.przygotuj(model([p], [o])), L.indeks(wpisy.concat([wz(DZIS, 'rano', 'P1')])), DZIS)[0];
  assert.equal(z.koniec, '2027-01-02');
  // pominięcie dziś zostawia dawkę na później
  z = L.zapasy(L.przygotuj(model([p], [o])), L.indeks(wpisy.concat([{ id: 's', data: DZIS, pora: 'rano', pozycja: 'P1', status: 'pominięte' }])), DZIS)[0];
  assert.equal(z.zostalo, 98); assert.equal(z.koniec, '2027-01-02');
});

test('zapas: termin ważności wygrywa, alert, zużycie sprzed okna, ułamki, nieznana ilość z prognozą', () => {
  const p = poz({ od: d(-4), pory: 'rano' });
  let z = L.zapasy(L.przygotuj(model([p], [{ id: 'O', pozycja: 'P1', otwarto: d(-4), ilosc: 100, wazneDo: d(10), alertDni: 14 }])), L.indeks([]), DZIS)[0];
  assert.equal(z.koniec, d(10)); assert.equal(z.powod, 'waznosc'); assert.ok(z.alert); assert.equal(z.dniDoKonca, 10);
  z = L.zapasy(L.przygotuj(model([p], [{ id: 'O', pozycja: 'P1', otwarto: d(-100), ilosc: 100, zuzytePrzed: 60, alertDni: 14 }])), L.indeks([wz(d(-1), 'rano', 'P1')]), DZIS)[0];
  assert.equal(z.zuzyte, 61); assert.equal(z.zostalo, 39); assert.equal(z.koniec, d(38));
  // ½ ampułki dziennie z 10 ampułek = 20 dni
  const amp = poz({ dawka: 0.5, jednostka: 'ampułki', pory: 'rano', od: DZIS });
  z = L.zapasy(L.przygotuj(model([amp], [{ id: 'O', pozycja: 'P1', otwarto: DZIS, ilosc: 10, alertDni: 10 }])), L.indeks([]), DZIS)[0];
  assert.equal(z.koniec, d(19));
  // nieznana ilość: bez historii brak prognozy, z historią średnia
  const nieznane = [{ id: 'O2', pozycja: 'P1', otwarto: d(-5), ilosc: null, alertDni: 7 }];
  z = L.zapasy(L.przygotuj(model([p], nieznane)), L.indeks([]), DZIS)[0];
  assert.equal(z.koniec, null); assert.equal(z.otwarteDni, 5); assert.ok(!z.alert);
  z = L.zapasy(L.przygotuj(model([p], nieznane.concat([{ id: 'O1', pozycja: 'P1', otwarto: d(-45), skonczone: d(-5), ilosc: null }]))), L.indeks([]), DZIS)[0];
  assert.equal(z.sredniaDni, 40); assert.equal(z.koniec, d(35)); assert.equal(z.powod, 'prognoza');
  // pusty zapas
  z = L.zapasy(L.przygotuj(model([p], [{ id: 'O', pozycja: 'P1', otwarto: d(-4), ilosc: 2, alertDni: 3 }])), L.indeks([wz(d(-1), 'rano', 'P1'), wz(d(-2), 'rano', 'P1')]), DZIS)[0];
  assert.equal(z.zostalo, 0); assert.ok(z.alert); assert.equal(z.dniDoKonca, -1);
});

test('przypomnienia: jedno na porę, tylko to, co zostało, pozycje tygodniowe w swoim dniu', () => {
  const ctx = L.przygotuj(model([poz({}), poz({ id: 'P2', nazwa: 'Krople', pory: 'rano' }), poz({ id: 'W', nazwa: 'Peeling', harmonogram: '1x/tydz nd', pory: 'w ciągu dnia', od: d(-20) })]));
  let r = L.przypomnienia(ctx, L.indeks([wz(DZIS, 'rano', 'P1')]), DZIS, 7);
  const dzis = r.filter(x => x.data === DZIS);
  assert.deepEqual(dzis.map(x => x.klucz + ' ' + x.godzina + ' ' + x.nazwy.join('+')), ['rano 09:00 Krople', 'w ciągu dnia 13:00 Peeling', 'wieczór 22:00 Testolek']);
  assert.equal(r.filter(x => x.data === d(1) && x.klucz === 'rano')[0].godzina, '07:30');
  assert.equal(r.filter(x => x.klucz === 'w ciągu dnia').length, 1);          // peeling tylko w niedzielę
  assert.equal(r.length, 1 + 2 * 7);
  r = L.przypomnienia(ctx, L.indeks([wz(DZIS, 'rano', 'P1'), wz(DZIS, 'rano', 'P2'), wz(DZIS, 'wieczór', 'P1'), wz(DZIS, 'w ciągu dnia', 'W')]), DZIS, 1);
  assert.equal(r.length, 0);
});

test('doraźne: liczba dziś i w tygodniu', () => {
  const ctx = L.przygotuj(model([poz({ dorazne: true, od: d(-30) })]));
  const u = (data) => ({ id: 'u' + Math.random(), data, pozycja: 'P1', status: 'doraźnie', ilosc: 1 });
  const r = L.dorazne(ctx, L.indeks([u(DZIS), u(d(-1)), u(d(-6)), u(d(-7))]), DZIS)[0];
  assert.equal(r.dzis.length, 1); assert.equal(r.tydzien, 3);
});

test('przypomnienie pozycji: własna godzina, „nie”, grupowanie po godzinie', () => {
  assert.equal(L.przypomnienie(''), ''); assert.equal(L.przypomnienie('NIE'), 'nie'); assert.equal(L.przypomnienie('bez przypomnienia'), 'nie');
  assert.equal(L.przypomnienie('7:15'), '07:15'); assert.equal(L.przypomnienie('22.00'), '22:00'); assert.equal(L.przypomnienie('25:00'), ''); assert.equal(L.przypomnienie('wieczorem'), '');
  const ctx = L.przygotuj(model([
    poz({ id: 'F', nazwa: 'Inhalator' }),
    poz({ id: 'V', nazwa: 'Witamina', pory: 'wieczór', przypomnienie: '22:00' }),
    poz({ id: 'S', nazwa: 'Szampon', pory: 'rano', przypomnienie: 'nie' }),
    poz({ id: 'W', nazwa: 'Peeling', harmonogram: '1x/tydz nd', pory: 'w ciągu dnia', od: d(-20), przypomnienie: '10:00' })
  ]));
  let r = L.przypomnienia(ctx, L.indeks([]), DZIS, 1);
  assert.deepEqual(r.map(x => x.godzina + ' ' + x.nazwy.join('+')), ['09:00 Inhalator', '10:00 Peeling', '22:00 Inhalator+Witamina']);
  r = L.przypomnienia(ctx, L.indeks([]), d(1), 1);                           // poniedziałek: wieczór 21:30, witamina osobno o 22:00
  assert.deepEqual(r.map(x => x.godzina + ' ' + x.nazwy.join('+')), ['07:30 Inhalator', '21:30 Inhalator', '22:00 Witamina']);
  // szampon nadal jest na liście dnia, tylko bez przypomnienia
  assert.ok(L.dzien(ctx, L.indeks([]), DZIS)[0].pozycje.some(x => x.p.id === 'S'));
});

test('korekta zapasu: licznik nadpisuje stan, liczą się tylko późniejsze użycia; wpis po fakcie sprzed korekty nie', () => {
  const p = poz({ od: d(-10), pory: 'rano' });
  const o = { id: 'O', pozycja: 'P1', otwarto: d(-10), ilosc: 100, alertDni: 7 };
  const wpisy = [wz(d(-3), 'rano', 'P1'), wz(d(-2), 'rano', 'P1'),
    { id: 'k', data: d(-1), pozycja: 'P1', status: 'korekta', ilosc: 80, godz: '12:00' },
    wz(d(-1), 'rano', 'P1'),                                                   // po korekcie, ten sam dzień: liczy się
    wz(d(-4), 'rano', 'P1'),                                                   // „Wziąłeś?” za dzień sprzed korekty, zapisane później: nie liczy się
    { id: 'u', data: DZIS, pozycja: 'P1', status: 'doraźnie', ilosc: 2 }];
  const z = L.zapasy(L.przygotuj(model([p], [o])), L.indeks(wpisy), DZIS)[0];
  assert.equal(z.zostalo, 77); assert.deepEqual(z.korekta, { ilosc: 80, data: d(-1) });
  // nieznana ilość + korekta = znany stan bez paska
  const z2 = L.zapasy(L.przygotuj(model([p], [Object.assign({}, o, { ilosc: null })])), L.indeks(wpisy), DZIS)[0];
  assert.ok(z2.znane); assert.equal(z2.razem, null); assert.equal(z2.zostalo, 77); assert.equal(z2.koniec, d(76));
  // stan sprzed okna z korektą (liczony przez skrypt)
  const z3 = L.zapasy(L.przygotuj(model([p], [Object.assign({}, o, { przed: { kor: 50, zuz: 5, korData: d(-60) } })])), L.indeks([wz(d(-1), 'rano', 'P1')]), DZIS)[0];
  assert.equal(z3.zostalo, 44);
});

test('wersje pozycji: zmiana dawki zachowuje zapas, historię opakowań i odpowiedzi', () => {
  const stara = poz({ id: 'A', od: d(-10), do: d(-1), status: 'zakończona', pory: 'rano', dawka: 1 });
  const nowa = poz({ id: 'B', od: DZIS, poprzednia: 'A', pory: 'rano', dawka: 2 });
  const ctx = L.przygotuj(model([stara, nowa], [{ id: 'O', pozycja: 'B', otwarto: d(-10), ilosc: 100 }, { id: 'O0', pozycja: 'A', otwarto: d(-40), skonczone: d(-11), ilosc: null }]));
  assert.deepEqual(ctx.rodzina.B, ['B', 'A']); assert.equal(ctx.korzen.B, 'A');
  const wpisy = []; for (let k = -10; k <= -1; k++) wpisy.push(wz(d(k), 'rano', 'A'));
  const z = L.zapasy(ctx, L.indeks(wpisy), DZIS)[0];
  assert.equal(z.p.id, 'B'); assert.equal(z.zostalo, 90); assert.equal(z.koniec, d(44));      // 90 / 2 dziennie = 45 dni
  assert.equal(L.dzien(ctx, L.indeks(wpisy), DZIS)[0].pozycje.length, 1);
  assert.ok(!L.przygotuj(model([poz({ status: 'usunięta' })])).pozycje.length);
});

test('stan dnia i seria', () => {
  const ctx = L.przygotuj(model([poz({ od: d(-6) })]));
  const pelny = k => [wz(d(k), 'rano', 'P1'), wz(d(k), 'wieczór', 'P1')];
  let wpisy = [].concat(pelny(-1), pelny(-2), pelny(-3), [wz(d(-4), 'rano', 'P1')], pelny(-5));
  let idx = L.indeks(wpisy);
  assert.equal(L.stanDnia(ctx, idx, d(-1), DZIS).st, 'ok');
  assert.equal(L.stanDnia(ctx, idx, d(-4), DZIS).st, 'czesc');
  assert.equal(L.stanDnia(ctx, idx, d(-6), DZIS).st, 'brak');
  assert.equal(L.stanDnia(ctx, idx, DZIS, DZIS).st, 'dzis');
  assert.equal(L.stanDnia(ctx, idx, d(1), DZIS).st, 'fut');
  assert.equal(L.stanDnia(ctx, idx, d(-7), DZIS).st, 'none');
  assert.deepEqual(L.seria(ctx, idx, DZIS), { dni: 3, wiecej: false });
  idx = L.indeks(wpisy.concat(pelny(0)));
  assert.equal(L.seria(ctx, idx, DZIS).dni, 4);
  wpisy = [].concat(pelny(-1), [{ id: 'p', data: d(-2), pora: 'rano', pozycja: 'P1', status: 'pominięte' }, wz(d(-2), 'wieczór', 'P1')]);
  assert.equal(L.stanDnia(ctx, L.indeks(wpisy), d(-2), DZIS).st, 'pom');
  assert.equal(L.seria(ctx, L.indeks(wpisy), DZIS).dni, 1);
  assert.deepEqual(L.seria(ctx, L.indeks(pelny(-1)), DZIS, d(-1)), { dni: 1, wiecej: true });
});

test('raport: regularność, pominięcia z powodem, brak danych, doraźne, tydzień, zmiany i notatki', () => {
  const pozycje = [
    poz({ id: 'A', nazwa: 'Stary', od: d(-30), do: d(-11), status: 'zakończona', pory: 'rano' }),
    poz({ id: 'B', nazwa: 'Nowy', od: d(-10), pory: 'rano+wieczór', dorazne: true }),
    poz({ id: 'C', nazwa: 'Nowy', od: d(-3), poprzednia: 'B', dawka: 2, pory: 'rano+wieczór', dorazne: true }),
    poz({ id: 'W', nazwa: 'Raz w tygodniu', harmonogram: '1x/tydz nd', pory: 'w ciągu dnia', od: d(-30) }),
    poz({ id: 'X', terapia: 'T2', nazwa: 'Inna terapia', od: d(-30) })
  ];
  pozycje[0].do = d(-11); pozycje[1].do = d(-4); pozycje[1].status = 'zakończona';
  const ctx = L.przygotuj(model(pozycje));
  const wpisy = [];
  for (let k = -14; k <= -11; k++) wpisy.push(wz(d(k), 'rano', 'A'));
  for (let k = -10; k <= -4; k++) { wpisy.push(wz(d(k), 'rano', 'B')); if (k !== -6) wpisy.push(wz(d(k), 'wieczór', 'B')); }
  wpisy.push({ id: 's', data: d(-6), pora: 'wieczór', pozycja: 'B', status: 'pominięte', powod: 'brak leku', notatka: 'apteka zamknięta' });
  for (let k = -3; k <= -1; k++) { wpisy.push(wz(d(k), 'rano', 'C')); wpisy.push(wz(d(k), 'wieczór', 'C')); }
  wpisy.push({ id: 'n', data: d(-2), pora: 'rano', pozycja: 'C', status: 'nie pamiętam' });  // nadpisuje wcześniejsze „wzięte”
  wpisy.push(wz(DZIS, 'rano', 'C'));                                                         // dziś: tylko rano odpowiedziane
  ['d1', 'd2', 'd3'].forEach((id, i) => wpisy.push({ id: id, data: d(-1 - i), pozycja: 'B', status: 'doraźnie', ilosc: 1 }));
  wpisy.push(wz(d(-7), 'w ciągu dnia', 'W'));                                               // poprzednia niedziela: zrobione
  const r = L.raport(ctx, wpisy, 'T1', d(-14), DZIS, DZIS);
  assert.equal(r.dniOkresu, 15);
  assert.deepEqual(r.bloki.map(b => b.wersje.map(p => p.id).join('+')), ['A', 'B+C', 'W']);
  const a = r.bloki[0], b = r.bloki[1], w = r.bloki[2];
  assert.deepEqual([a.plan, a.wz, a.pct], [4, 4, 100]);
  assert.deepEqual([b.plan, b.wz, b.pom, b.brak], [14 + 6 + 1, 13 + 5 + 1, 1, 1]);
  assert.equal(b.pct, 90);
  assert.deepEqual(b.pominiete, [{ data: d(-6), pora: 'wieczór', powod: 'brak leku', notatka: 'apteka zamknięta' }]);
  assert.deepEqual(b.braki, [{ data: d(-2), pora: 'rano', niewiem: true }]);
  assert.equal(b.dor, 3); assert.equal(b.dorNaTydz, 1.4);
  assert.equal(b.dni.find(x => x.data === d(-6)).st, 'pom'); assert.equal(b.dni.find(x => x.data === d(-2)).st, 'czesc');
  assert.equal(b.dni.find(x => x.data === d(-5)).st, 'ok'); assert.equal(b.dni.find(x => x.data === d(-12)).st, 'none');
  // tydzień: 2 pełne tygodnie w okresie (d-13…d-7 i jego część) – niedziela d-7 zrobiona, niedziela d-14 brak, bieżący tydzień bez braków
  assert.deepEqual([w.plan, w.wz, w.brak], [2, 1, 1]);                        // niedziela d-14: brak, niedziela d-7: zrobione, bieżący tydzień jeszcze trwa
  assert.deepEqual(r.zmiany.map(z => z.typ + ' ' + z.data + ' ' + z.na.id), ['koniec ' + d(-11) + ' A', 'start ' + d(-10) + ' B', 'zmiana ' + d(-3) + ' C']);
  assert.deepEqual(r.notatki.map(n => n.tekst), ['apteka zamknięta']);
  assert.ok(!r.bloki.some(x => x.wersje.some(p => p.id === 'X')));
});

test('doraźne: w dniu zmiany dawki (nowa wersja od jutra) przycisk zostaje', () => {
  const ctx = L.przygotuj(model([poz({ id: 'A', dorazne: true, od: d(-10), do: DZIS, status: 'zakończona' }), poz({ id: 'B', dorazne: true, od: d(1), poprzednia: 'A' })]));
  assert.deepEqual(L.dorazne(ctx, L.indeks([]), DZIS).map(x => x.p.id), ['A']);
  assert.deepEqual(L.dorazne(ctx, L.indeks([]), d(1)).map(x => x.p.id), ['B']);
});

test('raport: brak w tygodniu dla pozycji „raz w tygodniu” trafia do braków z zakresem tygodnia', () => {
  const ctx = L.przygotuj(model([poz({ id: 'W', harmonogram: '1x/tydz nd', pory: 'w ciągu dnia', od: d(-30) })]));
  const r = L.raport(ctx, [{ id: 'p', data: d(-7), pora: 'w ciągu dnia', pozycja: 'W', status: 'pominięte', powod: 'brak czasu' }], 'T1', d(-14), DZIS, DZIS);
  assert.deepEqual(r.bloki[0].brakiTyg, [{ od: d(-14), do: d(-14), n: 1 }]);
  assert.deepEqual(r.bloki[0].pominiete.map(x => x.powod), ['brak czasu']);
});
