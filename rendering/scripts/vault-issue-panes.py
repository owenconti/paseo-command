"""The Dungeon Board vault's Linear issue panes. Run from the repository root.

Each issue pane starts from the PR panes' stained glass of the same colour (`assets/dungeon/tiles.png`): its ivory
PR icon and that icon's leading are taken out, the hole is glazed again with new cells whose glass is copied from the
pane's own (so its painted texture carries on), and a circle-based status icon in the style of Linear's is leaded in
its place, its ivory copied from the old icon's: Done a ring round a check, In Progress a ring half filled, Todo an
empty ring, Blocked a ring struck through. Deterministic (seeded). Writes `assets/dungeon/vault.png|json`.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
from pathlib import Path
import json, math, random, colorsys

SRC = Path('rendering/src/assets/dungeon/tiles.png')
OUT = Path('rendering/src/assets/dungeon')
SIZE = 132
# The PR panes each issue pane is glazed from: the same colour, in the `tiles` sheet.
PANES = {'merged': (6, 6), 'review': (150, 6), 'draft': (294, 6), 'failing': (6, 150)}
ISSUES = [('issue-done', 'merged', 'done'), ('issue-progress', 'review', 'progress'),
          ('issue-todo', 'draft', 'todo'), ('issue-blocked', 'failing', 'blocked')]
LEAD = (46, 28, 17, 255)
# The cells' leading: the pane's own, a warm dark brown, a little softer than the icon's outline.
CAME = (62, 38, 22, 255)


def is_ivory(p):
    r, g, b, a = p
    if a < 200:
        return False
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return l > 0.62 and r > 200 and g > 160


def mask_of(im, test):
    m = Image.new('L', im.size, 0)
    src, dst = im.load(), m.load()
    for y in range(im.height):
        for x in range(im.width):
            if test(src[x, y]):
                dst[x, y] = 255
    return m


def glaze(pane, rng):
    """The pane's opening glazed again, its icon gone: new cells, each copying the pane's own glass (its leading and
    icon first painted over by the glass round them) from a place of its own, slightly lighter or darker, leaded."""
    alpha = pane.getchannel('A')
    src = pane.load()
    # The opening: opaque, inside the copper frame.
    opening = alpha.point(lambda a: 255 if a > 240 else 0).filter(ImageFilter.MinFilter(13))
    op_ = opening.load()

    def creamy(p):
        h, l, sat = colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255)
        return l > 0.4 and sat < 0.45

    def lum(p):
        return (0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]) / 255

    # Clean glass: the opening's coloured pixels, neither the ivory icon (and its paint's shading) nor the leading.
    bad = mask_of(pane, lambda p: is_ivory(p) or lum(p) < 0.26 or creamy(p)).filter(ImageFilter.MaxFilter(5))
    ivory = mask_of(pane, is_ivory).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    icon_area = ivory.filter(ImageFilter.MaxFilter(11))
    clean = ImageChops.subtract(opening, ImageChops.lighter(bad, icon_area))
    cp = clean.load()
    # Fill everything else from the clean glass round it (spreading inward a pixel at a time), so any copy is glass.
    filled = pane.copy()
    fp = filled.load()
    known = {(x, y) for y in range(SIZE) for x in range(SIZE) if cp[x, y]}
    todo = {(x, y) for y in range(SIZE) for x in range(SIZE) if op_[x, y] and (x, y) not in known}
    while todo:
        grown = {}
        for (x, y) in todo:
            near = [fp[u, v] for u, v in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1), (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1)) if (u, v) in known]
            if near:
                pick = near[rng.randrange(len(near))]
                grown[(x, y)] = pick
        if not grown:
            break
        for k, v in grown.items():
            fp[k] = v
            known.add(k)
            todo.discard(k)
    # New cells over the whole opening, about the pane's own size.
    box = opening.getbbox()
    seeds = []
    tries = 0
    while tries < 20000 and len(seeds) < 11:
        tries += 1
        sx, sy = rng.uniform(box[0] - 6, box[2] + 6), rng.uniform(box[1] - 6, box[3] + 6)
        if all((sx - a) ** 2 + (sy - b) ** 2 > 30 ** 2 for a, b in seeds):
            seeds.append((sx, sy))
    owner = {}
    cells = {i: [] for i in range(len(seeds))}
    for y in range(SIZE):
        for x in range(SIZE):
            if not op_[x, y]:
                continue
            i = min(range(len(seeds)), key=lambda i: (x - seeds[i][0]) ** 2 + (y - seeds[i][1]) ** 2)
            owner[(x, y)] = i
            cells[i].append((x, y))
    out = pane.copy()
    o = out.load()
    for i, pts in cells.items():
        if not pts:
            continue
        # The offset whose source is the cleanest glass (all of it inside the opening).
        best, score = (0, 0), -1
        for _ in range(500):
            dx, dy = rng.randint(-70, 70), rng.randint(-70, 70)
            ok, n = True, 0
            for (x, y) in pts[::3]:
                u, v = x + dx, y + dy
                if not (0 <= u < SIZE and 0 <= v < SIZE and op_[u, v]):
                    ok = False
                    break
                n += 1 if cp[u, v] else 0
            if ok and n > score:
                best, score = (dx, dy), n
        k = 1 + rng.uniform(-0.09, 0.09)
        for (x, y) in pts:
            r, g, b, a = fp[x + best[0], y + best[1]]
            o[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), 255)
    # Leading between the cells, and round the opening's edge where it meets the frame.
    lead = Image.new('L', out.size, 0)
    lp = lead.load()
    for (x, y), i in owner.items():
        for nx, ny in ((x + 1, y), (x, y + 1)):
            j = owner.get((nx, ny))
            if j is not None and j != i:
                lp[x, y] = 255
    lead = lead.filter(ImageFilter.GaussianBlur(0.7)).point(lambda v: min(255, v * 2.2))
    return out, lead, ivory, opening


def icon(kind, cx, cy):
    """The icon's ivory (L mask) and its leading (the ivory's outline), at 4x then reduced."""
    k = 4
    W = SIZE * k
    ivory = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(ivory)
    X, Y = cx * k, cy * k
    R, r = 35 * k, 23 * k
    d.ellipse((X - R, Y - R, X + R, Y + R), fill=255)
    d.ellipse((X - r, Y - r, X + r, Y + r), fill=0)
    if kind == 'done':
        pts = [(X - 11 * k, Y + 1 * k), (X - 4 * k, Y + 8 * k), (X + 11 * k, Y - 7 * k)]
        d.line(pts, fill=255, width=11 * k, joint='curve')
        for p in (pts[0], pts[2]):
            d.ellipse((p[0] - 5.5 * k, p[1] - 5.5 * k, p[0] + 5.5 * k, p[1] + 5.5 * k), fill=255)
    elif kind == 'progress':
        f = 16 * k
        d.pieslice((X - f, Y - f, X + f, Y + f), -90, 90, fill=255)
    elif kind == 'blocked':
        a = math.radians(45)
        dx, dy = math.cos(a) * (r + 2 * k), math.sin(a) * (r + 2 * k)
        d.line([(X - dx, Y + dy), (X + dx, Y - dy)], fill=255, width=12 * k)
    ivory = ivory.resize((SIZE, SIZE), Image.LANCZOS)
    outline = ivory.filter(ImageFilter.MaxFilter(5))
    return ivory, outline


def main():
    sheet = Image.open(SRC).convert('RGBA')
    out = Image.new('RGBA', (4 * (SIZE + 12), SIZE + 12), (0, 0, 0, 0))
    frames = {}
    for n, (name, pane_name, kind) in enumerate(ISSUES):
        x, y = PANES[pane_name]
        pane = sheet.crop((x, y, x + SIZE, y + SIZE))
        rng = random.Random(name)
        glazed, lead, old_ivory, opening = glaze(pane, rng)
        alpha = pane.getchannel('A')
        # The pane's opening's centre (its glass's middle).
        bbox = alpha.point(lambda a: 255 if a > 240 else 0).getbbox()
        cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2 + 4
        ivory, outline = icon(kind, cx, cy)
        # The ivory's texture: the old icon's paint, tiled from its own pixels.
        src = pane.load()
        ivory_px = [src[x, y] for y in range(SIZE) for x in range(SIZE) if old_ivory.getpixel((x, y))]
        tex = Image.new('RGBA', (SIZE, SIZE))
        tp = tex.load()
        trng = random.Random(name + 'ivory')
        ox, oy = old_ivory.getbbox()[:2]
        for yy in range(SIZE):
            for xx in range(SIZE):
                tp[xx, yy] = trng.choice(ivory_px)
        tex = tex.filter(ImageFilter.GaussianBlur(0.6))
        # A soft bevel: lighter toward the upper left, darker toward the lower right, as the painted icons are.
        shade = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        dark = ImageChops.subtract(ivory, ImageChops.offset(ivory, -2, -2))
        shade.paste((120, 70, 30, 90), (0, 0), dark)
        light = ImageChops.subtract(ivory, ImageChops.offset(ivory, 2, 2))
        result = glazed.copy()
        result.paste(CAME, (0, 0), ImageChops.multiply(lead, opening))
        result.paste(LEAD, (0, 0), outline)
        result.paste(tex, (0, 0), ivory)
        result.alpha_composite(shade)
        result.paste((255, 246, 220, 255), (0, 0), light.point(lambda v: v * 0.35))
        result.putalpha(alpha)
        ox = 6 + n * (SIZE + 12)
        out.paste(result, (ox, 6))
        frames[name] = {'x': ox, 'y': 6, 'w': SIZE, 'h': SIZE, 'anchor': {'x': SIZE / 2, 'y': SIZE / 2}}
    out.save(OUT / 'vault.png', optimize=True)
    (OUT / 'vault.json').write_text(json.dumps({'image': 'vault.png', 'scale': 3, 'frames': frames}, indent=2) + '\n')


if __name__ == '__main__':
    main()
