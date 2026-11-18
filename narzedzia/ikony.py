# Ikony aplikacji Zdrowie (od v2.1.6): własny znak w klimacie „planu technicznego” – czarne tło, kapsułka leku
# narysowana zielonymi liniami jak rysunek techniczny (kreskowanie, oś, wymiary) i czerwony krzyż z wyciętym ptaszkiem.
# Rysuje icons/ikona.svg i icons/ikona-mask.svg (wersja do maskowania na Androidzie), PNG robi rsvg-convert.
# Uruchom: python3 narzedzia/ikony.py
import pathlib, subprocess
from PIL import Image

D = pathlib.Path(__file__).resolve().parent.parent / 'icons'
ZIEL = '#3cf2b0'; CZER = '#ff1f4d'; TLO = '#000000'


def krzyz(w=54, l=164, sciecie=10):
    a, b, c = w / 2, l / 2, sciecie
    pts = [(-a, -b + c), (-a + c, -b), (a - c, -b), (a, -b + c), (a, -a), (b - c, -a), (b, -a + c), (b, a - c), (b - c, a), (a, a),
           (a, b - c), (a - c, b), (-a + c, b), (-a, b - c), (-a, a), (-b + c, a), (-b, a - c), (-b, -a + c), (-b + c, -a), (-a, -a)]
    return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts) + ' Z'


def kapsulka():
    """Kapsułka leku jako rysunek techniczny, w układzie lokalnym (środek 0,0), przed obrotem."""
    W, H = 392, 168
    x0, y0, r = -W / 2, -H / 2, H / 2
    s = f'''<defs>
  <clipPath id="lewa"><rect x="{x0}" y="{y0}" width="{W/2 - 8}" height="{H}" rx="{r}"/></clipPath>
  <pattern id="kresk" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0V6" stroke="{ZIEL}" stroke-width="1.6" stroke-opacity=".55"/></pattern>
  <pattern id="kropki" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="{ZIEL}" fill-opacity=".35"/></pattern>
</defs>
<g fill="none" stroke="{ZIEL}" stroke-linecap="round" stroke-linejoin="round" filter="url(#poswiata)">
  <rect x="{x0}" y="{y0}" width="{W/2 - 8}" height="{H}" rx="{r}" fill="url(#kresk)" stroke="none" clip-path="url(#lewa)"/>
  <rect x="{8}" y="{y0}" width="{W/2 - 8}" height="{H}" fill="url(#kropki)" stroke="none" clip-path="url(#prawa)"/>
  <rect x="{x0}" y="{y0}" width="{W}" height="{H}" rx="{r}" stroke-width="4.5"/>
  <rect x="{x0 + 12}" y="{y0 + 12}" width="{W - 24}" height="{H - 24}" rx="{r - 12}" stroke-width="1.6" stroke-opacity=".55"/>
  <path d="M-8 {y0}V{-y0}M8 {y0}V{-y0}" stroke-width="3"/>
  <path d="M-8 {y0 + 20}h16M-8 {-y0 - 20}h16" stroke-width="2" stroke-opacity=".8"/>
  <path d="M{x0 - 34} 0H{-x0 + 34}" stroke-width="1.6" stroke-opacity=".7" stroke-dasharray="14 6 3 6"/>
  <path d="M{x0 + 40} {y0 + 30}a{r - 22} {r - 22} 0 0 1 34 -10" stroke-width="3" stroke-opacity=".9"/>
  <circle cx="{-x0 - 74}" cy="-34" r="7" stroke-width="2.4"/><circle cx="{-x0 - 52}" cy="30" r="4.5" stroke-width="2.2"/>
  <path d="M{x0} {-y0 + 30}V{-y0 + 48}M{-x0} {-y0 + 30}V{-y0 + 48}M{x0} {-y0 + 39}H{-x0}M-8 {-y0 + 33}V{-y0 + 45}" stroke-width="2" stroke-opacity=".75"/>
  <path d="M{x0 - 30} {y0}H{x0 - 18}M{x0 - 30} {-y0}H{x0 - 18}M{x0 - 24} {y0}V{-y0}" stroke-width="2" stroke-opacity=".75"/>
</g>'''
    return s.replace('clip-path="url(#prawa)"', f'clip-path="url(#prawaClip)"').replace('</defs>', f'<clipPath id="prawaClip"><rect x="{x0}" y="{y0}" width="{W}" height="{H}" rx="{r}"/></clipPath></defs>')


def svg(maskowalna=False):
    skala = 0.8 if maskowalna else 1
    s = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
  <radialGradient id="tlo" cx="50%" cy="48%" r="70%"><stop offset="0" stop-color="#04110d"/><stop offset="1" stop-color="{TLO}"/></radialGradient>
  <pattern id="siatka" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="{ZIEL}" stroke-opacity=".05" stroke-width="1"/></pattern>
  <filter id="poswiata" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="poswiataC" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="512" height="512" fill="url(#tlo)"/><rect width="512" height="512" fill="url(#siatka)"/>'''
    if not maskowalna:
        s += f'''<g fill="none" stroke="{ZIEL}" stroke-opacity=".5" stroke-width="2.5"><path d="M30 64V30h34M482 64V30h-34M30 448v34h34M482 448v34h-34"/></g>
<g fill="{ZIEL}" fill-opacity=".28"><rect x="44" y="84" width="26" height="3"/><rect x="44" y="92" width="16" height="3"/><rect x="442" y="420" width="26" height="3"/><rect x="452" y="428" width="16" height="3"/></g>'''
    s += f'<g transform="translate(256 262) scale({skala})">'
    s += f'<g transform="rotate(-32)">{kapsulka()}</g>'
    # czerwony znak: krzyż z wyciętym ptaszkiem, oddzielony od rysunku czarną obwódką
    s += f'''<g transform="translate(6 -4)">
  <path d="{krzyz()}" fill="none" stroke="{TLO}" stroke-width="12" stroke-linejoin="miter"/>
  <path d="{krzyz()}" fill="{CZER}" filter="url(#poswiataC)"/>
  <path d="M-30 4l20 20 40 -44" fill="none" stroke="{TLO}" stroke-width="11" stroke-linecap="square" stroke-linejoin="miter"/>
</g></g></svg>'''
    return s


if __name__ == '__main__':
    (D / 'ikona.svg').write_text(svg(), encoding='utf8')
    (D / 'ikona-mask.svg').write_text(svg(True), encoding='utf8')
    for zr, nazwa in [('ikona.svg', 'icon-512.png'), ('ikona-mask.svg', 'icon-maskable-512.png')]:
        subprocess.run(['rsvg-convert', '-w', '512', '-h', '512', '-o', str(D / nazwa), str(D / zr)], check=True)
    duza = Image.open(D / 'icon-512.png').convert('RGB')
    for nazwa, r in [('icon-192.png', 192), ('apple-touch-icon.png', 180), ('favicon-32.png', 32)]:
        duza.resize((r, r), Image.LANCZOS).save(D / nazwa, optimize=True)
    duza.save(D / 'icon-512.png', optimize=True)
    Image.open(D / 'icon-maskable-512.png').convert('RGB').save(D / 'icon-maskable-512.png', optimize=True)
    print('ikony gotowe')
