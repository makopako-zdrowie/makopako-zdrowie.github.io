/* Skórka wyglądu – zapamiętana osobno na każdym urządzeniu (localStorage „zdrowie.skin”).
   Ładowana w <head> przed resztą strony, żeby nie mignął zły motyw. Domyślnie: klasyczny. Bez zewnętrznych czcionek. */
(function () {
  var BAR = { klasyczny: '#0c1519', jasny: '#f3f6f5', neon: '#07070c', synthwave: '#1b0b2e', racer: '#ece6da' };
  var JASNE = { jasny: 1, racer: 1 };
  function apply(s) {
    if (!BAR[s]) s = 'klasyczny';
    var d = document.documentElement;
    if (s === 'klasyczny') d.removeAttribute('data-skin'); else d.setAttribute('data-skin', s);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', BAR[s]);
    var cs = document.querySelector('meta[name="color-scheme"]');
    if (cs) cs.setAttribute('content', JASNE[s] ? 'light' : 'dark');
    return s;
  }
  var saved = 'klasyczny';
  try { saved = localStorage.getItem('zdrowie.skin') || 'klasyczny'; } catch (e) { /* bez pamięci przeglądarki: klasyczny */ }
  window.SKIN = apply(saved);
  window.setSkin = function (v) {
    window.SKIN = apply(v);
    try { localStorage.setItem('zdrowie.skin', window.SKIN); } catch (e) { /* zostaje do zamknięcia strony */ }
    return window.SKIN;
  };
})();
