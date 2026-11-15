# Rysuje ikony aplikacji (PIL). Uruchom: python3 narzedzia/ikony.py
import os
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
BG, ACC, INK = (12, 21, 25), (47, 191, 147), (4, 33, 26)

def ikona(size, maskable=False, radius=True):
    S = size * 4                                   # rysujemy 4x większe i zmniejszamy (gładkie krawędzie)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable or not radius: d.rectangle([0, 0, S, S], fill=BG)
    else: d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
    r = S * (0.27 if maskable else 0.33)           # maskowalna: znak w bezpiecznym środku
    c = S / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill=ACC)
    w = int(r * 0.2)
    pts = [(c - r * 0.44, c + r * 0.02), (c - r * 0.12, c + r * 0.34), (c + r * 0.46, c - r * 0.30)]
    d.line(pts, fill=INK, width=w, joint='curve')
    for x, y in pts: d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=INK)
    return im.resize((size, size), Image.LANCZOS)

ikona(192).save(os.path.join(OUT, 'icon-192.png'))
ikona(512).save(os.path.join(OUT, 'icon-512.png'))
ikona(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
ikona(32).save(os.path.join(OUT, 'favicon-32.png'))
ikona(180, radius=False).save(os.path.join(OUT, 'apple-touch-icon.png'))
print('ikony gotowe')
