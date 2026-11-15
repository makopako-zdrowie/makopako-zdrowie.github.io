# Zdrowie

Osobista aplikacja do odhaczania leków, suplementów i zabiegów: jedno dotknięcie = wzięte, przypomnienia w Kalendarzu Google, zapasy z prognozą końca. Strona działa na GitHub Pages, dane są w arkuszu Google, a skrypt Apps Script pośredniczy między nimi.

**W tym repozytorium nie ma żadnych danych.** Leki, dawki, dziennik i klucz dostępu są tylko w arkuszu właściciela i na jego urządzeniach. Testy używają wyłącznie zmyślonych danych.

## Pliki

- `index.html`, `styles.css`, `skin.js`, `app.js`, `moduly.js`: ekrany (Dziś, Historia, Terapie, Raport dla lekarza, Ustawienia), edycja w aplikacji i skórki, bez zewnętrznych bibliotek.
- `logika.js`: harmonogramy, plan dnia, tydzień, zapasy, przypomnienia. Ta sama logika jest w `apps-script/Code.gs` (wstawia ją `node narzedzia/zbuduj.js`), więc telefon i skrypt liczą tak samo.
- `rdzen.js`: połączenie ze skryptem, przepustki urządzeń, parowanie kodem, kolejka offline (rdzeń z aplikacji Finanse).
- `config.js`: adres skryptu (sam adres nic nie zdradza: bez przepustki skrypt nie zwraca danych).
- `apps-script/Code.gs`: skrypt podpięty do arkusza.
- `manifest.webmanifest`, `sw.js`, `icons/`: instalacja na telefonie i działanie bez internetu.
- `testy/`: testy logiki, skryptu na symulowanym arkuszu i całej strony w przeglądarce.

## Uruchomienie

1. Nowy arkusz Google → Rozszerzenia → Apps Script. Wklej `apps-script/Code.gs`. Opcjonalnie dodaj plik `DaneStartowe` z własnymi danymi (zmienna `DANE_STARTOWE`, ten sam układ co w testach).
2. Ustawienia projektu → strefa czasowa Europe/Warsaw.
3. Uruchom `utworzArkusz` (zakładki: Terapie, Pozycje, Pory dnia, Dziennik, Opakowania), potem `utworzKlucz` i skopiuj klucz z dziennika wykonania.
4. Wdróż → Nowe wdrożenie → Aplikacja internetowa. Wykonaj jako: Ja. Kto ma dostęp: Każdy. Skopiuj adres kończący się na `/exec`.
5. Otwórz stronę, wybierz „Pierwsze urządzenie”, wklej adres i klucz. Kolejne urządzenia łączysz kodem: zębatka → Połącz nowe.
6. Przypomnienia: w Apps Script uruchom raz `wlaczPrzypomnienia` (zgoda na Kalendarz). Skrypt prowadzi kalendarz „Zdrowie – przypomnienia” i co 15 minut usuwa wydarzenia pór, które są już odhaczone.

Przy zmianach w `Code.gs`: Wdróż → Zarządzaj wdrożeniami → edytuj → Nowa wersja (adres `/exec` się nie zmienia). Strona ostrzega, gdy wersje strony i skryptu się różnią.

## Testy

```
node --test testy/*.test.js
NODE_PATH=<katalog z playwright> node testy/przegladarka.js [katalog-na-zrzuty]
```
