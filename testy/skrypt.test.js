/* Testy Code.gs na symulowanym arkuszu (testy/symulacja.js). Tylko dane fikcyjne.  Uruchom: node --test testy/ */
process.env.TZ = 'Europe/Warsaw';
const test = require('node:test'), assert = require('node:assert');
const { execFileSync } = require('child_process'), path = require('path'), fs = require('fs');
const { utworzSrodowisko, fikcyjneDane } = require('./symulacja.js');
const L = require('../logika.js');

const DZIS = '2026-11-15', TERAZ = '2026-11-15T10:00:00+01:00';
const d = k => L.plus(DZIS, k);
const nowe = o => { const env = utworzSrodowisko(Object.assign({ teraz: TERAZ, daneStartowe: fikcyjneDane(DZIS) }, o)); env.api.utworzArkusz(); return env; };

test('Code.gs zawiera aktualną kopię logika.js i żadnych danych zdrowotnych', () => {
  execFileSync('node', [path.join(__dirname, '..', 'narzedzia', 'zbuduj.js'), '--sprawdz']);
  const kod = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  assert.ok(!/DANE_STARTOWE\s*=/.test(kod));
});

test('utworzArkusz: zakładki, nagłówki, dane startowe, powtórne uruchomienie niczego nie dubluje', () => {
  const env = nowe({ pustyArkusz1: true });
  assert.deepEqual(env.sheets.map(s => s.name).sort(), ['Dziennik', 'Opakowania', 'Pory dnia', 'Pozycje', 'Terapie', 'Urządzenia']);
  assert.equal(env.wiersze('Pozycje').length, 7);
  assert.equal(env.wiersze('Dziennik').length, 8 * 2 + 4 + 1);
  assert.equal(env.wiersze('Pozycje')[6]['Uwagi'], 'Do ustalenia: wszystko po wizycie');
  assert.equal(env.wiersze('Dziennik')[0]['Później'], ''); assert.equal(env.wiersze('Dziennik')[0]['Notatka'], '');
  env.api.utworzArkusz();
  assert.equal(env.wiersze('Pozycje').length, 7);
  assert.equal(env.wiersze('Dziennik').length, 21);
  const pusty = utworzSrodowisko({ teraz: TERAZ });
  pusty.api.utworzArkusz();
  assert.equal(pusty.wiersze('Pozycje').length, 0);
  assert.match(pusty.dziennik.join('\n'), /bez danych startowych/);
});

test('dostęp: bez klucza i z błędnym kluczem nic; klucz → przepustka; parowanie kodem', () => {
  const env = nowe();
  assert.equal(env.post({ fn: 'refreshData' }).ok, false);
  env.api.utworzKlucz();
  assert.equal(env.post({ key: 'zly-klucz', fn: 'refreshData' }).auth, true);
  const call = env.polacz('Telefon');
  const m = call('refreshData');
  assert.equal(m.version, '2.1'); assert.equal(m.dzis, DZIS);
  assert.equal(m.devices.list.length, 1); assert.ok(m.devices.list[0].current);
  assert.ok(!JSON.stringify(m).includes(env.props.API_KEY));
  const kod = call('pairStart').code;
  const r2 = env.post({ fn: 'pairFinish', arg: { code: kod, name: 'Komputer', desc: 'test' } });
  assert.ok(r2.ok && r2.token);
  assert.equal(env.post({ fn: 'pairFinish', arg: { code: kod, name: 'Obcy' } }).ok, false);     // kod działa raz
  assert.equal(env.post({ token: r2.token, fn: 'refreshData' }).devices.list.length, 2);
  assert.equal(env.post({ token: 'x'.repeat(64), fn: 'refreshData' }).revoked, true);
});

test('model: surowe dane, okno dziennika, brak ostrzeżeń przy dobrych danych', () => {
  const env = nowe(), call = env.polacz();
  const m = call('refreshData');
  assert.deepEqual(m.warnings, []);
  assert.equal(m.pozycje.length, 7); assert.equal(m.pozycje[3].dawka, 0.5);
  assert.equal(m.pozycje[0].od, d(-10));
  assert.equal(m.pory[0].godzina, '07:30');
  assert.equal(m.dziennik.wpisy.length, 21); assert.equal(m.dziennik.od, d(-40));
  assert.equal(m.opakowania[0].ilosc, 60); assert.equal(m.opakowania[1].ilosc, null);
  const ctx = L.przygotuj(m), idx = L.indeks(m.dziennik.wpisy);
  assert.deepEqual(L.dzien(ctx, idx, DZIS).map(k => k.klucz + ':' + k.pozycje.map(x => x.p.id + '=' + x.stan).join(',')), ['rano:P1=do,P3=do', 'wieczór:P1=do,P4=do']);
  assert.equal(L.zalegle(ctx, idx, DZIS, 3).length, 4);     // P1: wczoraj rano i wieczór, przedwczoraj rano i wieczór; P3: wczoraj rano; P4: przedwczoraj wieczór
});

test('model: ostrzeżenia przy błędach w arkuszu i zużycie zapasu sprzed okna', () => {
  const dane = fikcyjneDane(DZIS);
  dane.pozycje[2].harmonogram = 'jak popadnie';
  dane.pozycje[3].pory = 'o świcie';
  dane.pozycje[0].od = d(-100); dane.opakowania[0].otwarto = d(-100); dane.opakowania[0].ilosc = 500;
  dane.dziennikWstecz = [{ od: d(-100), do: d(-1), pozycja: 'P1', pory: ['rano', 'wieczór'], status: 'wzięte' }];
  const env = nowe({ daneStartowe: dane }), call = env.polacz();
  const m = call('refreshData');
  assert.equal(m.warnings.length, 2);
  assert.match(m.warnings.join(' '), /nie rozumiem harmonogramu „jak popadnie”/);
  assert.match(m.warnings.join(' '), /pory „o świcie” nie ma/);
  assert.equal(m.dziennik.wpisy.length, 40 * 2);
  assert.deepEqual(m.opakowania[0].przed, { zuz: 60 * 2 });
  const z = L.zapasy(L.przygotuj(m), L.indeks(m.dziennik.wpisy), DZIS).filter(x => x.p.id === 'P1')[0];
  assert.equal(z.zostalo, 500 - 200);
});

test('logDose: zapis, kolejka nie dubluje, cała pora naraz, cofnięcie', () => {
  const env = nowe(), call = env.polacz('Telefon');
  const arg = { clientId: 'abc12345xyz', items: [{ data: DZIS, pora: 'rano', pozycja: 'P1', status: 'wzięte', ilosc: 1, godz: '08:02' }, { data: DZIS, pora: 'rano', pozycja: 'P3', status: 'wzięte', ilosc: 2, godz: '08:02' }] };
  let r = call('logDose', arg);
  assert.ok(r.ok); assert.equal(r.saved, 2);
  assert.equal(env.wiersze('Dziennik').length, 23);
  const w = env.wiersze('Dziennik')[21];
  assert.equal(w['ID'], 'Kabc12345xyz-0'); assert.equal(w['Data'], DZIS); assert.equal(w['Godzina'], '08:02'); assert.equal(w['Nazwa'], 'Testolek');
  assert.equal(w['Urządzenie'], 'Telefon'); assert.equal(w['Zapisano'], '2026-11-15 10:00'); assert.equal(w['Ilość'], 1);
  r = call('logDose', arg);                                              // to samo jeszcze raz (ponowienie z kolejki)
  assert.ok(r.ok); assert.equal(r.saved, 0); assert.equal(r.duplicate, 2);
  assert.equal(env.wiersze('Dziennik').length, 23);
  assert.ok(r.model.dziennik.wpisy.some(x => x.id === 'Kabc12345xyz-1' && x.ilosc === 2));
  assert.ok(r.model.devices);
  r = call('undoDose', { clientId: 'undo0000001', ids: ['Kabc12345xyz-0', 'nie-ma-takiego'] });
  assert.ok(r.ok); assert.equal(r.undone, 1);
  assert.equal(env.wiersze('Dziennik')[21]['Stan'], 'cofnięty');
  assert.ok(!r.model.dziennik.wpisy.some(x => x.id === 'Kabc12345xyz-0'));
  assert.equal(call('undoDose', { ids: ['Kabc12345xyz-0'] }).undone, 0);
});

test('logDose: pominięcie z powodem, „nie pamiętam”, doraźne, wpis po fakcie; złe dane odrzucone w całości', () => {
  const env = nowe(), call = env.polacz();
  let r = call('logDose', { clientId: 'skip0000001', items: [
    { data: d(-1), pora: 'wieczór', pozycja: 'P1', status: 'pominięte', powod: 'brak leku', pozniej: true, notatka: '=HYPERLINK("x")' },
    { data: d(-2), pora: 'rano', pozycja: 'P1', status: 'nie pamiętam', pozniej: true },
    { data: DZIS, pora: 'rano', pozycja: 'P1', status: 'doraźnie', ilosc: 2, godz: '9:5x', notatka: 'po <b>biegu</b>' }] });
  assert.ok(r.ok);
  const w = env.wiersze('Dziennik').slice(-3);
  assert.equal(w[0]['Powód'], 'brak leku'); assert.equal(w[0]['Później'], 'TAK'); assert.equal(w[0]['Ilość'], '');
  assert.equal(w[0]['Notatka'], '=HYPERLINK("x")');                      // zapisane jako tekst (apostrof), nie formuła
  assert.equal(w[1]['Status'], 'nie pamiętam');
  assert.equal(w[2]['Pora'], ''); assert.equal(w[2]['Ilość'], 2); assert.equal(w[2]['Godzina'], ''); assert.equal(w[2]['Notatka'], 'po b biegu /b');
  const przed = env.wiersze('Dziennik').length;
  for (const zly of [{ pozycja: 'P999' }, { status: 'może' }, { data: '2026-13-01' }, { data: d(5) }, { data: d(-500) }]) {
    r = call('logDose', { clientId: 'bad00000001', items: [{ data: DZIS, pora: 'rano', pozycja: 'P3', status: 'wzięte' }, Object.assign({ data: DZIS, pora: 'rano', pozycja: 'P1', status: 'wzięte' }, zly)] });
    assert.equal(r.ok, false);
  }
  assert.equal(env.wiersze('Dziennik').length, przed);
  assert.equal(call('logDose', { items: [] }).ok, false);
  r = call('logDose', { clientId: 'dflt0000001', items: [{ data: DZIS, pora: 'rano', pozycja: 'P3', status: 'wzięte' }] });   // bez ilości → dawka z pozycji
  assert.equal(env.wiersze('Dziennik').slice(-1)[0]['Ilość'], 2);
});

test('logDose: arkusz pełny (brak wolnych wierszy) nie psuje zapisu', () => {
  const env = nowe(), call = env.polacz();
  env.arkusz('Dziennik').maxRows = env.arkusz('Dziennik').getLastRow();
  const r = call('logDose', { clientId: 'full0000001', items: [{ data: DZIS, pora: 'rano', pozycja: 'P1', status: 'wzięte' }, { data: DZIS, pora: 'wieczór', pozycja: 'P1', status: 'wzięte' }] });
  assert.ok(r.ok, r.error); assert.equal(r.saved, 2);
});

test('finishPackage i startPosition', () => {
  const env = nowe(), call = env.polacz();
  let r = call('finishPackage', { id: 'O1', data: DZIS, nowe: { ilosc: 120, wazneDo: d(90) } });
  assert.ok(r.ok); assert.equal(r.opened, 'O4');
  const o = env.wiersze('Opakowania');
  assert.equal(o[0]['Skończone'], DZIS);
  assert.deepEqual([o[3]['ID'], o[3]['Pozycja'], o[3]['Otwarto'], o[3]['Ilość w opakowaniu'], o[3]['Ważne do'], o[3]['Alert (dni przed)']], ['O4', 'P1', DZIS, 120, d(90), 14]);
  assert.equal(call('finishPackage', { id: 'O1', data: DZIS, nowe: { ilosc: 1 } }).already, true);
  assert.equal(env.wiersze('Opakowania').length, 4);
  assert.equal(call('finishPackage', { id: 'O3', data: DZIS, nowe: null }).ok, true);
  assert.equal(env.wiersze('Opakowania').length, 4);
  assert.equal(call('finishPackage', { id: 'O99' }).ok, false);
  r = call('startPosition', { id: 'P6' });
  assert.ok(r.ok);
  const p = env.wiersze('Pozycje')[5];
  assert.equal(p['Status'], 'aktywna'); assert.equal(p['Od'], DZIS);
  assert.ok(L.dzien(L.przygotuj(r.model), L.indeks(r.model.dziennik.wpisy), DZIS)[0].pozycje.some(x => x.p.id === 'P6'));
  assert.equal(call('startPosition', { id: 'P6' }).already, true);
  assert.equal(call('startPosition', { id: 'P7' }).ok, false);           // brak harmonogramu
  assert.match(call('startPosition', { id: 'P7' }).error, /uzupełnij/);
});

test('przypomnienia: wydarzenia na pory, znikają po odhaczeniu, wyzwalacz co 15 minut, zapas', () => {
  const dane = fikcyjneDane(DZIS);
  dane.opakowania[0].ilosc = 30;                                         // 30 − 16 = 14 → skończy się za tydzień → przypomnienie o zapasie
  const env = nowe({ daneStartowe: dane }), call = env.polacz();
  env.props.REMINDERS = JSON.stringify({ drugie: 0 });                     // bez drugiego przypomnienia (osobny test)
  env.api.wlaczPrzypomnienia();
  assert.equal(env.wyzwalacze.length, 1); assert.equal(env.wyzwalacze[0].min, 15);
  const tytuly = () => env.kalendarz.zdarzenia.slice().sort((a, b) => a.start - b.start).map(e => e.title);
  const dzisiejsze = () => env.kalendarz.zdarzenia.filter(e => L.str(Math.floor((e.start.getTime() + 3600e3) / 864e5)) === DZIS).sort((a, b) => a.start - b.start);
  assert.deepEqual(dzisiejsze().map(e => e.title).sort(), ['🌅 Rano: Testolek, Witamina Fikcyjna', '📦 Testolek: załatw receptę (wystarczy do 21 listopada)', '☀️ W ciągu dnia: Peeling Zmyślony', '🌙 Wieczór: Testolek, Maść Próbna'].sort());
  const rano = () => dzisiejsze().filter(e => /Rano/.test(e.title))[0];
  assert.equal(rano().start.getHours(), 9);                      // niedziela → godzina weekendowa
  assert.deepEqual(rano().przyp, [0]);
  const ile = env.kalendarz.zdarzenia.length;
  assert.equal(ile, 7 + 7 + 1 + 2);                                       // rano ×7, wieczór ×7, peeling w niedzielę, dwa zapasy (jeden dziś, jeden w grudniu)
  // odhaczenie jednej pozycji: tytuł się skraca, wydarzenie zostaje to samo
  const utworzono = env.kalendarz.utworzono;
  call('logDose', { clientId: 'cal00000001', items: [{ data: DZIS, pora: 'rano', pozycja: 'P1', status: 'wzięte' }] });
  assert.equal(dzisiejsze().filter(e => /Rano/.test(e.title))[0].title, '🌅 Rano: Witamina Fikcyjna');
  assert.equal(env.kalendarz.utworzono, utworzono);
  // odhaczenie reszty: wydarzenie znika
  call('logDose', { clientId: 'cal00000002', items: [{ data: DZIS, pora: 'rano', pozycja: 'P3', status: 'wzięte' }] });
  assert.ok(!dzisiejsze().some(e => /Rano/.test(e.title)));
  // wyzwalacz bez zmian nie rusza kalendarza
  const przed = JSON.stringify(tytuly());
  env.api.odswiezPrzypomnienia();
  assert.equal(JSON.stringify(tytuly()), przed); assert.equal(env.kalendarz.utworzono, utworzono);
  // cofnięcie przywraca wydarzenie
  call('undoDose', { ids: ['Kcal00000002-0'] });
  assert.equal(dzisiejsze().filter(e => /Rano/.test(e.title))[0].title, '🌅 Rano: Witamina Fikcyjna');
  // wyłączenie czyści kalendarz i wyzwalacz
  const r = call('saveReminders', { enabled: false });
  assert.equal(r.model.prefs.reminders.enabled, false);
  assert.equal(env.kalendarz.zdarzenia.length, 0); assert.equal(env.wyzwalacze.length, 0);
});

test('przypomnienia: brak zgody na Kalendarz nie psuje zapisu, a aplikacja dostaje podpowiedź', () => {
  const env = nowe({ brakZgodyNaKalendarz: true }), call = env.polacz();
  let r = call('saveReminders', { enabled: true });
  assert.ok(r.ok); assert.match(r.model.prefs.reminders.error, /wlaczPrzypomnienia/);
  r = call('logDose', { clientId: 'noc00000001', items: [{ data: DZIS, pora: 'rano', pozycja: 'P1', status: 'wzięte' }] });
  assert.ok(r.ok); assert.equal(r.saved, 1);
});

test('przypomnienia: popup 0 minut odrzucony przez Kalendarz → 5 minut', () => {
  const env = nowe({ popupMin5: true });
  env.api.wlaczPrzypomnienia();
  assert.deepEqual(env.kalendarz.zdarzenia[0].przyp, [5]);
});

test('ręczna zmiana w arkuszu (data jako prawdziwa data, godzina 7:05) jest czytana poprawnie', () => {
  const env = nowe(), call = env.polacz();
  const sh = env.arkusz('Pozycje');
  sh.formats = {};                                                        // użytkownik zdjął format tekstowy
  sh.getRange(2, 12).setValue('2026-11-01');                              // symulacja zamienia na datę, jak Arkusze
  assert.ok(sh.rows[1][11] instanceof Date);
  env.arkusz('Pory dnia').getRange(2, 2).setValue('7:05');
  env.api.onEdit();
  const m = call('refreshData');
  assert.equal(m.pozycje[0].od, '2026-11-01'); assert.equal(m.pory[0].godzina, '07:05');
});

test('kolumna „Przypomnienie”: dopisana przez utworzArkusz, czytana z arkusza, wydarzenia o własnej godzinie', () => {
  const dane = fikcyjneDane(DZIS);
  dane.pozycje[2].przypomnienie = 'nie';                                   // Witamina Fikcyjna bez przypomnienia
  dane.pozycje[3].przypomnienie = '22:45';                                 // Maść Próbna o własnej godzinie
  dane.pozycje[4].przypomnienie = 'kiedyś';                                // nieczytelne
  const env = nowe({ daneStartowe: dane }), call = env.polacz();
  env.props.REMINDERS = JSON.stringify({ drugie: 0 });
  const m = call('refreshData');
  assert.deepEqual(m.pozycje.slice(0, 5).map(p => p.przypomnienie), ['', '', 'nie', '22:45', '']);
  assert.equal(m.warnings.length, 1); assert.match(m.warnings[0], /nie rozumiem przypomnienia „kiedyś”/);
  env.api.wlaczPrzypomnienia();
  const dzis = env.kalendarz.zdarzenia.filter(e => e.start.getDate() === 15 && e.start.getMonth() === 10).map(e => String(e.start.getHours()).padStart(2, '0') + ':' + String(e.start.getMinutes()).padStart(2, '0') + ' ' + e.title).sort();
  assert.deepEqual(dzis, ['09:00 🌅 Rano: Testolek', '13:00 ☀️ W ciągu dnia: Peeling Zmyślony', '22:00 🌙 Wieczór: Testolek', '22:45 🌙 Wieczór: Maść Próbna']);
});

test('stary arkusz bez kolumny „Przypomnienie”: działa, a utworzArkusz dopisuje kolumnę bez ruszania danych', () => {
  const env = nowe(), sh = env.arkusz('Pozycje');
  sh.rows.forEach(r => { r.length = 15; });                                // jak arkusz z wersji 1.0
  const call = env.polacz();
  assert.deepEqual(call('refreshData').warnings, []);
  env.api.utworzArkusz();
  assert.equal(sh.rows[0][15], 'Przypomnienie');
  assert.equal(env.wiersze('Pozycje').length, 7);
  assert.match(env.dziennik.join(' '), /nowa kolumna „Przypomnienie”/);
});

test('v2: drugie przypomnienie i link do aplikacji w wydarzeniu', () => {
  const env = nowe(), call = env.polacz();
  env.api.wlaczPrzypomnienia();
  const rano = env.kalendarz.zdarzenia.filter(e => e.start.getDate() === 15 && /Rano/.test(e.title)).sort((a, b) => a.start - b.start);
  assert.deepEqual(rano.map(e => e.start.getHours() + ':' + e.start.getMinutes() + ' ' + e.title), ['9:0 🌅 Rano: Testolek, Witamina Fikcyjna', '10:0 ⏰ Nadal: Rano: Testolek, Witamina Fikcyjna']);
  assert.match(rano[0].desc, /Odhacz: https:\/\/makopako-zdrowie\.github\.io\/\?pora=rano&d=2026-11-15/);
  call('saveReminders', { drugie: 30 });
  assert.equal(env.kalendarz.zdarzenia.filter(e => e.start.getDate() === 15 && /Nadal: Rano/.test(e.title))[0].start.getMinutes(), 30);
  call('logDose', { clientId: 'rem20000001', items: [{ data: DZIS, pora: 'rano', pozycja: 'P1', status: 'wzięte' }, { data: DZIS, pora: 'rano', pozycja: 'P3', status: 'wzięte' }] });
  assert.ok(!env.kalendarz.zdarzenia.some(e => e.start.getDate() === 15 && /Rano/.test(e.title)));
  const r = call('saveReminders', { drugie: 0 });
  assert.equal(r.model.prefs.reminders.drugie, 0); assert.ok(!env.kalendarz.zdarzenia.some(e => /Nadal/.test(e.title)));
  assert.equal(r.model.prefs.reminders.enabled, true);                     // zmiana drugiego nie wyłącza przypomnień
});

test('v2: getLog zwraca dziennik z okresu, także sprzed okna modelu', () => {
  const dane = fikcyjneDane(DZIS);
  dane.dziennikWstecz.push({ od: d(-90), do: d(-60), pozycja: 'P2', pora: 'rano', status: 'wzięte' });
  const env = nowe({ daneStartowe: dane }), call = env.polacz();
  let r = call('getLog', { od: d(-90), do: d(-61) });
  assert.ok(r.ok); assert.equal(r.wpisy.length, 30); assert.ok(r.wpisy.every(w => w.pozycja === 'P2' && w.pora === 'rano'));
  assert.equal(call('getLog', { od: d(-500), do: DZIS }).ok, false);
  assert.equal(call('getLog', { od: DZIS, do: d(-1) }).ok, false);
});

test('v2: korekta zapasu z licznika', () => {
  const env = nowe(), call = env.polacz();
  let r = call('logDose', { clientId: 'kor00000001', items: [{ data: DZIS, pozycja: 'P1', status: 'korekta', ilosc: 40, godz: '10:00' }] });
  assert.ok(r.ok);
  const w = env.wiersze('Dziennik').slice(-1)[0];
  assert.deepEqual([w['Status'], w['Ilość'], w['Pora']], ['korekta', 40, '']);
  const z = L.zapasy(L.przygotuj(r.model), L.indeks(r.model.dziennik.wpisy), DZIS).filter(x => x.p.id === 'P1')[0];
  assert.equal(z.zostalo, 40); assert.deepEqual(z.korekta, { ilosc: 40, data: DZIS });
  assert.equal(call('logDose', { clientId: 'kor00000002', items: [{ data: DZIS, pozycja: 'P1', status: 'korekta' }] }).ok, false);
});

test('v2: korekta sprzed okna modelu trafia do stanu „przed”', () => {
  const dane = fikcyjneDane(DZIS);
  dane.pozycje[0].od = d(-100); dane.opakowania[0].otwarto = d(-100); dane.opakowania[0].ilosc = 500;
  dane.dziennikWstecz = [{ od: d(-100), do: d(-1), pozycja: 'P1', pory: ['rano', 'wieczór'], status: 'wzięte' }];
  const env = nowe({ daneStartowe: dane }), call = env.polacz();
  // korekta 50 dni temu: licznik pokazywał 300
  env.arkusz('Dziennik').appendRow(['KOR1', '', d(-50), '12:00', '', 'P1', 'Testolek', 'korekta', 300, '', '', '', 'test', '']);
  env.api.onEdit();
  const m = call('refreshData');
  assert.deepEqual(m.opakowania[0].przed, { zuz: 2 * 9, kor: 300, korData: d(-50) });   // korekta zapisana po wpisach z tamtego dnia: liczy się 9 dni do okna
  const z = L.zapasy(L.przygotuj(m), L.indeks(m.dziennik.wpisy), DZIS).filter(x => x.p.id === 'P1')[0];
  assert.equal(z.zostalo, 300 - 18 - 80);
});

test('v2: nowa pozycja i terapia z aplikacji, z opakowaniem', () => {
  const env = nowe(), call = env.polacz();
  let r = call('saveTherapy', { nazwa: 'Okulistyka', lekarz: 'dr Zmyślony', kolor: '#123abc' });
  assert.ok(r.ok, r.error); assert.equal(r.id, 'T3');
  r = call('savePosition', { pola: { terapia: 'T3', nazwa: 'Krople Test', rodzaj: 'lek', postac: 'krople', dawka: '2', jednostka: 'kropla', harmonogram: 'co 2 dni', pory: 'rano+wieczór', dorazne: false, warunki: '', przypomnienie: '8:05' }, start: 'dzis', opak: { ilosc: 200, wazneDo: d(28) } });
  assert.ok(r.ok, r.error); assert.equal(r.id, 'P8');
  const p = env.wiersze('Pozycje')[7];
  assert.deepEqual([p['Terapia'], p['Dawka'], p['Harmonogram'], p['Pory'], p['Od'], p['Status'], p['Przypomnienie']], ['T3', 2, 'co 2 dni', 'rano+wieczór', DZIS, 'aktywna', '08:05']);
  const o = env.wiersze('Opakowania').slice(-1)[0];
  assert.deepEqual([o['Pozycja'], o['Ilość w opakowaniu'], o['Ważne do'], o['Otwarto']], ['P8', 200, d(28), DZIS]);
  assert.ok(L.dzien(L.przygotuj(r.model), L.indeks([]), DZIS).some(k => k.pozycje.some(x => x.p.id === 'P8')));
  // błędy
  assert.match(call('savePosition', { pola: { terapia: 'T3', nazwa: 'X', harmonogram: 'kiedyś' } }).error, /harmonogramu/);
  assert.match(call('savePosition', { pola: { terapia: 'T3', nazwa: 'X', pory: 'północ' } }).error, /pory „północ”/);
  assert.match(call('savePosition', { pola: { terapia: 'T9', nazwa: 'X' } }).error, /terapię/);
  assert.match(call('savePosition', { pola: { terapia: 'T3', nazwa: 'X' }, start: 'dzis' }).error, /harmonogram/);
  assert.match(call('addPackage', { pozycja: 'P8', ilosc: 5 }).error, /otwarte opakowanie/);
  // planowana bez opakowania, potem usunięcie
  r = call('savePosition', { pola: { terapia: 'T3', nazwa: 'Na później', harmonogram: 'codziennie', pory: 'rano' }, start: 'planowana' });
  assert.equal(env.wiersze('Pozycje').slice(-1)[0]['Status'], 'planowana');
  r = call('deletePosition', { id: r.id });
  assert.ok(r.ok); assert.equal(env.wiersze('Pozycje').slice(-1)[0]['Status'], 'usunięta');
  assert.ok(!r.model.pozycje.some(x => x.status === 'usunięta' && L.przygotuj(r.model).pozMap[x.id]));
  assert.match(call('deletePosition', { id: 'P1' }).error, /tylko pozycję planowaną/);
});

test('v2: zmiana dawki tworzy nową wersję, opakowanie i zapas idą dalej; zmiana warunków w miejscu', () => {
  const env = nowe(), call = env.polacz();
  let r = call('savePosition', { id: 'P1', pola: { warunki: 'po jedzeniu', przypomnienie: 'nie' } });
  assert.ok(r.ok); assert.equal(r.id, 'P1'); assert.equal(env.wiersze('Pozycje').length, 7);
  assert.equal(env.wiersze('Pozycje')[0]['Warunki'], 'po jedzeniu');
  r = call('savePosition', { id: 'P1', pola: { dawka: 2, warunki: 'po jedzeniu' }, od: d(1) });
  assert.ok(r.ok, r.error); assert.equal(r.id, 'P8'); assert.ok(r.nowaWersja);
  const [stara, nowa] = [env.wiersze('Pozycje')[0], env.wiersze('Pozycje')[7]];
  assert.deepEqual([stara['Do'], stara['Status']], [DZIS, 'zakończona']);
  assert.deepEqual([nowa['Od'], nowa['Dawka'], nowa['Poprzednia'], nowa['Nazwa'], nowa['Pory'], nowa['Doraźnie'], nowa['Przypomnienie'], nowa['Status']], [d(1), 2, 'P1', 'Testolek', 'rano+wieczór', 'TAK', 'nie', 'aktywna']);
  assert.equal(env.wiersze('Opakowania')[0]['Pozycja'], 'P8');
  const ctx = L.przygotuj(r.model), idx = L.indeks(r.model.dziennik.wpisy);
  const z = L.zapasy(ctx, idx, DZIS).filter(x => x.opak.id === 'O1')[0];
  assert.equal(z.p.id, 'P8'); assert.equal(z.zuzyte, 16);                  // odhaczenia starej wersji liczą się do zapasu
  assert.ok(L.dzien(ctx, idx, DZIS)[0].pozycje.some(x => x.p.id === 'P1'));   // dziś jeszcze stara wersja
  assert.ok(L.dzien(ctx, idx, d(1))[0].pozycje.some(x => x.p.id === 'P8' && x.p.dawkaN === 2));
  // zmiana planu pozycji, która zaczyna się od dziś: w miejscu (bez nowej wersji)
  call('savePosition', { pola: { terapia: 'T1', nazwa: 'Świeży', harmonogram: 'codziennie', pory: 'rano', dawka: 1 }, start: 'dzis' });
  r = call('savePosition', { id: 'P9', pola: { dawka: 3 } });
  assert.equal(r.id, 'P9'); assert.equal(env.wiersze('Pozycje')[8]['Dawka'], 3);
});

test('v2: zakończenie pozycji, godziny pór', () => {
  const env = nowe(), call = env.polacz();
  let r = call('endPosition', { id: 'P3' });
  assert.ok(r.ok); assert.deepEqual([env.wiersze('Pozycje')[2]['Do'], env.wiersze('Pozycje')[2]['Status']], [DZIS, 'zakończona']);
  r = call('savePory', { pory: [{ nazwa: 'Rano', godzina: '7:15', weekend: '' }, { nazwa: 'wieczór', godzina: '21:00', weekend: '22:30' }] });
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.model.pory.map(p => p.nazwa + ' ' + p.godzina + ' ' + p.weekend), ['rano 07:15 ', 'w ciągu dnia 13:00 13:00', 'wieczór 21:00 22:30']);
  assert.match(call('savePory', { pory: [{ nazwa: 'noc', godzina: '23:00' }] }).error, /Nie ma pory/);
  assert.match(call('savePory', { pory: [{ nazwa: 'rano', godzina: '25:99' }] }).error, /Niepoprawna godzina/);
});
