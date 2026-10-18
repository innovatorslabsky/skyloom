#!/usr/bin/env python3
"""Generates the Skyloom logo set into brand/svg/.

    pip install fonttools
    python3 brand/build.py

The mark is an S spun from three silk strands (the loom's threads). The wordmark is "Skyloom" set in Inter ExtraBold (SIL OFL 1.1,
https://github.com/rsms/inter) and converted to outlines, so the SVGs need no font. Set INTER_FONT to another copy of
Inter-ExtraBold.otf if yours is elsewhere.
"""
import math, os, pathlib
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = pathlib.Path(__file__).parent / 'svg'
FONT = os.environ.get('INTER_FONT', '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf')

# ---- palette (matches the landing page and app)
CYAN, VIOLET, DEEP, INK, ACCENT = '#8be9ff', '#6a58f0', '#3b25b8', '#14112b', '#4630c8'

# ---- the S: centreline of a vertical figure-eight with its loops opened at both ends
def centreline(A=14.5, B=20.5, gap=0.9, n=300):
    t0, t1 = gap, 2 * math.pi - gap
    ts = [t0 + (t1 - t0) * i / n for i in range(n + 1)]
    return [(32 + A * math.sin(2 * t), 32 - B * math.sin(t)) for t in ts]

def offset(pts, dist):
    out = []
    for i, (x, y) in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dy) or 1
        out.append((x + dist * (-dy / l), y + dist * (dx / l)))
    return out

def d(pts, step=6):
    """Smooth cubic path through the sampled points (Catmull-Rom → Bézier), keeping every `step`-th sample plus the last."""
    k = list(pts[::step])
    if k[-1] != pts[-1]: k.append(pts[-1])
    out = [f'M{k[0][0]:.2f} {k[0][1]:.2f}']
    for i in range(len(k) - 1):
        p0, p1, p2, p3 = k[max(i - 1, 0)], k[i], k[i + 1], k[min(i + 2, len(k) - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out.append(f'C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}')
    return ''.join(out)

C = centreline()

def strands(colors, sep=4.1, w=3.4, trims=((0, .07), (0, 0), (.07, 0))):
    """Three parallel strands; the outer two stop short at opposite ends, like loose thread."""
    n = len(C)
    out = []
    for dist, col, (ta, tb) in zip((-sep, 0, sep), colors, trims):
        p = offset(C, dist)[int(ta * n): n - int(tb * n)]
        out.append(f'<path d="{d(p)}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')
    return ''.join(out)

def solid(color, w=8.2):
    return f'<path d="{d(C)}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'

def grad(i='g'):
    return (f'<linearGradient id="{i}" x1="8" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{CYAN}"/><stop offset=".45" stop-color="{VIOLET}"/><stop offset="1" stop-color="{DEEP}"/></linearGradient>')

def tile(glyph, i='g', rx=15):
    return f'<defs>{grad(i)}</defs><rect width="64" height="64" rx="{rx}" fill="url(#{i})"/>{glyph}'

def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{body}</svg>\n')

# ---- wordmark as outlines
def word(text, size, tracking=-0.015):
    f = TTFont(FONT)
    gs, cmap, upm = f.getGlyphSet(), f.getBestCmap(), f['head'].unitsPerEm
    sc = size / upm
    x, parts = 0.0, []
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=lambda v: f'{v:.2f}')
        gs[name].draw(TransformPen(pen, (sc, 0, 0, -sc, x, 0)))   # flip y; baseline at y=0
        parts.append((ch, pen.getCommands()))
        x += gs[name].width * sc + tracking * size
    return parts, x - tracking * size, f['OS/2'].sCapHeight * sc

def lockup(sky, loom, mark_body_fn):
    size = 40.0
    parts, width, cap = word('Skyloom', size)
    gap = 18.0
    base = 32 + cap / 2                      # centre the cap height on the tile's mid-line
    split = 3
    paths = ''.join(f'<path d="{p}" fill="{sky if i < split else loom}" transform="translate({64 + gap:.2f} {base:.2f})"/>' for i, (ch, p) in enumerate(parts))
    w = 64 + gap + width + 2
    return w, mark_body_fn() + paths

def write(name, content):
    (OUT / name).write_text(content, encoding='utf-8')
    print('wrote', name, len(content), 'bytes')

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    # tile icons
    write('skyloom-icon.svg', svg(64, 64, tile(strands(('#a9f0ff', '#ffffff', '#d6ccff'))), 'Skyloom'))
    write('skyloom-icon-square.svg', svg(64, 64, tile(strands(('#a9f0ff', '#ffffff', '#d6ccff')), 'g', rx=0), 'Skyloom'))  # full-bleed, for apple-touch / maskable
    write('skyloom-favicon.svg', svg(64, 64, tile(solid('#ffffff')), 'Skyloom'))
    # glyph only (no tile): for light and dark backgrounds, and one-colour use
    write('skyloom-glyph.svg', svg(64, 64, strands((CYAN, VIOLET, ACCENT)), 'Skyloom'))
    write('skyloom-glyph-white.svg', svg(64, 64, strands(('#ffffff',) * 3), 'Skyloom'))
    write('skyloom-glyph-ink.svg', svg(64, 64, strands((INK,) * 3), 'Skyloom'))
    # horizontal lockups
    w, body = lockup(INK, ACCENT, lambda: tile(strands(('#a9f0ff', '#ffffff', '#d6ccff')), 'g1'))
    write('skyloom-logo.svg', svg(round(w, 1), 64, body, 'Skyloom'))
    w, body = lockup('#ffffff', CYAN, lambda: tile(strands(('#a9f0ff', '#ffffff', '#d6ccff')), 'g2'))
    write('skyloom-logo-dark.svg', svg(round(w, 1), 64, body, 'Skyloom'))
    w, body = lockup(INK, INK, lambda: strands((INK,) * 3))
    write('skyloom-logo-ink.svg', svg(round(w, 1), 64, body, 'Skyloom'))
    w, body = lockup('#ffffff', '#ffffff', lambda: strands(('#ffffff',) * 3))
    write('skyloom-logo-white.svg', svg(round(w, 1), 64, body, 'Skyloom'))
