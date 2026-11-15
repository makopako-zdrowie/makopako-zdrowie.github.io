/* Wstawia logika.js do apps-script/Code.gs (między znaczniki LOGIKA), żeby telefon i skrypt liczyły tak samo.
   Uruchom po każdej zmianie logika.js:  node narzedzia/zbuduj.js
   Z parametrem --sprawdz tylko sprawdza, czy oba pliki są zgodne (używane w testach). */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const A = '/* >>> LOGIKA >>> */', B = '/* <<< LOGIKA <<< */';
const logika = fs.readFileSync(path.join(root, 'logika.js'), 'utf8').trim();
const file = path.join(root, 'apps-script', 'Code.gs');
const code = fs.readFileSync(file, 'utf8');
const a = code.indexOf(A), b = code.indexOf(B);
if (a < 0 || b < a) { console.error('Brak znaczników LOGIKA w Code.gs'); process.exit(1); }
const out = code.slice(0, a + A.length) + '\n' + logika + '\n' + code.slice(b);
if (process.argv.includes('--sprawdz')) {
  if (out !== code) { console.error('Code.gs ma nieaktualną kopię logika.js. Uruchom: node narzedzia/zbuduj.js'); process.exit(1); }
  console.log('Code.gs i logika.js są zgodne.');
} else {
  fs.writeFileSync(file, out);
  console.log('Wstawiono logika.js do Code.gs (' + logika.split('\n').length + ' wierszy).');
}
