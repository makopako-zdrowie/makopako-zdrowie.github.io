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
