# Turns a manufacturer product photo into a shipped device photo: transparent background, trimmed, <=1600 px PNG.
# Usage: python3 -I tools/device-photo.py <source image> data/devices/<modelKey>.png [x0,y0,x1,y1] [seed=x,y] [holes] [nocable]
#   x0,y0,x1,y1  crop the source first (e.g. to leave out a receiver standing next to the mouse)
#   seed=x,y     a point of enclosed background to clear too (e.g. inside a headband)
#   holes        clear every enclosed patch of background colour (dark products only: it would punch holes in white ones)
#   nocable      cut off a cable leaving the top of the mouse (the button overlay expects the body to start at the top)
# Sources that already have a transparent background are only trimmed. Then run: npx vitest run test/photos.test.ts
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src)
seeds = []
for arg in sys.argv[3:]:
    if arg.startswith('seed='): seeds.append(tuple(int(v) for v in arg[5:].split(',')))
    elif arg and arg not in ('holes', 'nocable'): im = im.crop(tuple(int(v) for v in arg.split(',')))
has_alpha = im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getextrema()[3][0] < 250
if has_alpha:
    out = im.convert('RGBA')
else:
    rgb = im.convert('RGB'); W, H = rgb.size
    corners = [rgb.getpixel(p) for p in [(2, 2), (W - 3, 2), (2, H - 3), (W - 3, H - 3)]]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    diff = ImageChops.difference(rgb, Image.new('RGB', rgb.size, bg))
    r, g, b = diff.split(); dist = ImageChops.lighter(ImageChops.lighter(r, g), b)
    near = dist.point(lambda v: 255 if v <= 10 else 0)
    work = Image.merge('RGB', (near, near, near))
    for x in range(0, W, 16):
        for y in (0, H - 1):
            if work.getpixel((x, y)) == (255, 255, 255): ImageDraw.floodfill(work, (x, y), (255, 0, 0), thresh=0)
    for y in range(0, H, 16):
        for x in (0, W - 1):
            if work.getpixel((x, y)) == (255, 255, 255): ImageDraw.floodfill(work, (x, y), (255, 0, 0), thresh=0)
    if 'holes' in sys.argv:  # dark products only: every enclosed patch of background colour is a hole
        seeds += [(x, y) for x in range(0, W, 6) for y in range(0, H, 6)]
    for xy in seeds:  # enclosed background, e.g. the gap inside a headband
        if work.getpixel(xy) == (255, 255, 255): ImageDraw.floodfill(work, xy, (255, 0, 0), thresh=0)
        elif 'holes' not in sys.argv: print('seed not on background', xy, rgb.getpixel(xy))
    wr, wg, _ = work.split(); bgmask = ImageChops.subtract(wr, wg)
    fg = ImageChops.invert(bgmask)
    band = fg.filter(ImageFilter.MaxFilter(5))
    soft = dist.point(lambda v: max(0, min(255, int((v - 4) * 255 / 40))))
    alpha = ImageChops.lighter(fg.filter(ImageFilter.MinFilter(3)), ImageChops.multiply(band, soft))
    # un-mix the background colour from semi-transparent edge pixels
    px = rgb.load(); a = alpha.load(); out = Image.new('RGBA', rgb.size); o = out.load()
    for y in range(H):
        for x in range(W):
            av = a[x, y]
            if av == 0: o[x, y] = (0, 0, 0, 0)
            elif av == 255: o[x, y] = px[x, y] + (255,)
            else:
                f = av / 255
                o[x, y] = tuple(max(0, min(255, round((c - (1 - f) * bc) / f))) for c, bc in zip(px[x, y], bg)) + (av,)
A = out.getchannel('A')
bbox = A.point(lambda v: 255 if v > 8 else 0).getbbox()
out = out.crop(bbox)
if 'nocable' in sys.argv:  # first row where the body is at least 16% of its widest
    A = out.getchannel('A'); widths = [sum(1 for x in range(out.width) if A.getpixel((x, y)) > 128) for y in range(out.height)]
    top = next(y for y, w in enumerate(widths) if w > max(widths) * 0.16)
    out = out.crop((0, top, out.width, out.height)); out = out.crop(out.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
pad = round(max(out.size) * 0.02)
canvas = Image.new('RGBA', (out.width + 2 * pad, out.height + 2 * pad), (0, 0, 0, 0)); canvas.paste(out, (pad, pad))
if max(canvas.size) > 1600: canvas.thumbnail((1600, 1600), Image.LANCZOS)
canvas.save(dst, 'PNG', optimize=True)
print(dst.split('/')[-1], canvas.size, 'alpha-source' if has_alpha else f'bg removed')
