"""Składa skin-*.css Zdrowia: dosłowna kopia pliku z Finansów + sekcja „Zdrowie” (narzedzia/skorki/<skórka>.css).
Uruchom: python3 narzedzia/skorki.py <katalog-z-finansami>"""
import re, sys, pathlib
FIN = pathlib.Path(sys.argv[1]); ROOT = pathlib.Path(__file__).resolve().parent.parent
Z_EMBLEM = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 230'%3E%3Cg opacity='.05'%3E%3Cg fill='none' stroke='%23f3e600' stroke-width='5'%3E%3Cpath d='M100 6 190 58v104l-90 52-90-52V58z'/%3E%3Cpath d='M100 26 172 68v84l-72 42-72-42V68z' stroke-width='2' stroke-dasharray='10 6'/%3E%3C/g%3E%3Cpath fill='%23f3e600' d='M66 62h76v14l-52 75h52v16H62v-14l52-75H66z'/%3E%3Cpath fill='%2300e5ff' d='M70 176h60l-8 12H78z'/%3E%3C/g%3E%3C/svg%3E\")"
for fin, our, name in [('skin-neon.css', 'neon', 'neon'), ('skin-sunset.css', 'synthwave', 'synthwave'), ('skin-racer.css', 'racer', 'racer')]:
    s = (FIN / fin).read_text(encoding='utf8')
    s = s.replace('data-skin="sunset"', 'data-skin="synthwave"')
    # Zdrowie ma 4 zakładki bez środkowego „Dodaj”
    s = re.sub(r'html\[data-skin="\w+"\] \.tabbar \{ grid-template-columns: repeat\(5, minmax\(0, 1fr\)\); \}\n', '', s)
    if name == 'neon':
        s, n = re.subn(r'url\("data:image/svg\+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 200 230\'.*?"\)', lambda m: Z_EMBLEM, s, flags=re.S); assert n == 1, n
        s = s.replace('(sześciokąt z „F”)', '(sześciokąt z „Z”)')
    assert 'repeat(5' not in s and 'Finanse' not in s
    z = (ROOT / 'narzedzia' / 'skorki' / f'{name}.css').read_text(encoding='utf8')
    head = f'/* Plik złożony przez narzedzia/skorki.py – nie edytuj ręcznie.\n   Część 1: {fin} z Finansów, bez zmian poza: nazwa skórki, emblemat „Z”, 4 zakładki.\n   Część 2: elementy Zdrowia (narzedzia/skorki/{name}.css). */\n'
    (ROOT / f'skin-{name}.css').write_text(head + s.rstrip() + '\n\n/* ======================= Zdrowie ======================= */\n' + z, encoding='utf8')
    print(name, len(s), len(z))
