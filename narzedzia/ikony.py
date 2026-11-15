# Ikony aplikacji Zdrowie (od v2.0): czerwony krzyż z ptaszkiem (wariant C) na ciemnym tle w stylu planu technicznego.
# Rysuje SVG (ikona-A/B/C.svg, wersje -mask do maskowania na Androidzie). PNG w icons/ powstały przez zrzut SVG w przeglądarce
# (512, 192, 180 dla iPhone'a, maskowalna 512) i uproszczoną wersję 32 px. Źródło: icons/ikona.svg.
import sys
CYAN = '#2fe3e8'; RED = '#ff2d55'; BG1 = '#0b171c'; BG2 = '#03070a'

def tlo(maskowalna=False):
    s = f'''<defs>
  <radialGradient id="bg" cx="50%" cy="46%" r="70%"><stop offset="0" stop-color="{BG1}"/><stop offset="1" stop-color="{BG2}"/></radialGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="cglow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="{CYAN}" stroke-opacity=".10" stroke-width="1"/></pattern>
</defs>
<rect width="512" height="512" fill="url(#bg)"/>
<rect width="512" height="512" fill="url(#grid)"/>'''
    # pierścień skanera z podziałką
    s += f'''<g fill="none" stroke="{CYAN}" filter="url(#cglow)">
  <circle cx="256" cy="256" r="178" stroke-opacity=".55" stroke-width="2"/>
  <circle cx="256" cy="256" r="196" stroke-opacity=".7" stroke-width="10" stroke-dasharray="1.5 9.75"/>
  <path d="M256 46v26M256 440v26M46 256h26M440 256h26" stroke-opacity=".8" stroke-width="3"/>
  <path d="M120 130a190 190 0 0 1 60-56" stroke-opacity=".9" stroke-width="4" stroke-linecap="round"/>
  <path d="M392 382a190 190 0 0 1-60 56" stroke-opacity=".9" stroke-width="4" stroke-linecap="round"/>
</g>'''
    if not maskowalna:
        # narożniki i bloki „danych” (poza bezpieczną strefą maskowania)
        s += f'''<g fill="none" stroke="{CYAN}" stroke-opacity=".75" stroke-width="3">
  <path d="M28 70V28h42M484 70V28h-42M28 442v42h42M484 442v42h-42"/></g>
<g fill="{CYAN}" fill-opacity=".45">
  <rect x="40" y="96" width="34" height="4"/><rect x="40" y="106" width="22" height="4"/><rect x="40" y="116" width="28" height="4"/>
  <rect x="438" y="392" width="34" height="4"/><rect x="450" y="402" width="22" height="4"/><rect x="444" y="412" width="28" height="4"/>
</g>'''
    return s

def krzyz(w=96, l=300, sciecie=22):
    a, b, c = w / 2, l / 2, sciecie
    pts = [(-a, -b + c), (-a + c, -b), (a - c, -b), (a, -b + c), (a, -a), (b - c, -a), (b, -a + c), (b, a - c), (b - c, a), (a, a),
           (a, b - c), (a - c, b), (-a + c, b), (-a, b - c), (-a, a), (-b + c, a), (-b, a - c), (-b, -a + c), (-b + c, -a), (-a, -a)]
    return 'M' + ' L'.join(f'{256 + x:.1f} {256 + y:.1f}' for x, y in pts) + ' Z'

def wariant(nr, maskowalna=False):
    skala = 0.86 if maskowalna else 1
    g = f'<g transform="translate(256 256) scale({skala}) translate(-256 -256)">'
    if nr == 'A':      # krzyż z linią pulsu (EKG) wyciętą w poziomym ramieniu
        g += f'''<path d="{krzyz()}" fill="{RED}" filter="url(#glow)"/>
<path d="M98 256h96l18-34 26 74 24-92 22 72 14-20h116" fill="none" stroke="{BG2}" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/>'''
    elif nr == 'B':    # krzyż przecięty ukośnym cięciem, z obwódką jak z planu
        g += f'''<path d="{krzyz()}" fill="{RED}" filter="url(#glow)"/>
<path d="M150 362 362 150" stroke="{BG2}" stroke-width="14"/>
<path d="{krzyz(132, 336, 30)}" fill="none" stroke="{RED}" stroke-opacity=".55" stroke-width="2.5" stroke-dasharray="14 8"/>'''
    else:              # krzyż z wyciętym „ptaszkiem” odhaczenia
        g += f'''<path d="{krzyz()}" fill="{RED}" filter="url(#glow)"/>
<path d="M200 262l40 40 78-86" fill="none" stroke="{BG2}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>'''
    return g + '</g>'

def svg(nr, maskowalna=False):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">{tlo(maskowalna)}{wariant(nr, maskowalna)}</svg>'

if __name__ == '__main__':
    for nr in 'ABC':
        open(f'ikona-{nr}.svg', 'w').write(svg(nr))
        open(f'ikona-{nr}-mask.svg', 'w').write(svg(nr, True))
    print('ok')
