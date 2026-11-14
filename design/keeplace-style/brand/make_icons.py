"""Generate 好記 HAOJI app icon / splash assets in the KEEPLACE visual language.

Run: python3 design/keeplace-style/brand/make_icons.py   (needs Pillow; macOS for Avenir Next)
Output goes to design/keeplace-style/brand/out/. Copying the files into the iOS asset catalog and
Android mipmaps is a separate step in the redesign (see ../GUIDELINE.md §3).

The script is adapted from KEEPLACE's scripts/brand/make_icons.py and keeps the same geometry:
- a single open line stroke, primaryDark #536550, width ~1.7% of the icon
- the stroke leaves a small gap where the line ends near its tip, like a hand-drawn line that isn't closed
- one soft "seed" inside, in wishlist #C58D75 blended 45% over the ivory background
- the tracked Latin wordmark under the mark, Avenir Next Regular, heading #262626
For KEEPLACE the stroke is a map pin. For 好記 it is a speech bubble, and the seed is a short
three-bar waveform: something said, kept.
Everything is rendered at 4x and downsampled for anti-aliasing.
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), 'out')
BG = (0xF7, 0xF3, 0xEA)
STROKE = (0x53, 0x65, 0x50)
TEXT = (0x26, 0x26, 0x26)
WISH = (0xC5, 0x8D, 0x75)
SEED = tuple(round(w * 0.45 + b * 0.55) for w, b in zip(WISH, BG))
SS = 4


def bubble_points(cx, cy, r, gap):
    """Round speech bubble with a tail at the lower-left, open between the tail tip and its left side."""
    a_left, a_right = math.radians(150), math.radians(118)  # where the tail meets the circle
    tip = (cx - r * 0.98, cy + r * 0.98)
    lx, ly = cx + r * math.cos(a_left), cy + r * math.sin(a_left)
    pts = [(tip[0] + (lx - tip[0]) * gap, tip[1] + (ly - tip[1]) * gap), (lx, ly)]
    end = a_right + 2 * math.pi
    steps = 180
    for i in range(1, steps):
        t = a_left + (end - a_left) * i / steps
        pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    pts.append((cx + r * math.cos(a_right), cy + r * math.sin(a_right)))
    pts.append(tip)
    return pts


def bar(d, x, y0, y1, w, fill):
    d.rounded_rectangle([x - w / 2, y0, x + w / 2, y1], radius=w / 2, fill=fill)


def draw_mark(d, size, ox, oy, scale, with_text=True, mono=None):
    s = size * scale
    cx, cy = ox + s * 0.5, oy + s * 0.38
    r = s * 0.21
    color = mono or STROKE
    width = round(s * 0.017)
    pts = bubble_points(cx, cy, r, 0.35)
    d.line(pts, fill=color, width=width, joint='curve')
    for x, y in (pts[0], pts[-1]):  # round caps
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=color)
    # waveform seed: soft tall middle bar, thin stroke-coloured bars either side
    bw, gap = s * 0.034, s * 0.062
    bar(d, cx, cy - s * 0.075, cy + s * 0.075, bw * 1.25, mono or SEED)
    for dx in (-gap, gap):
        bar(d, cx + dx, cy - s * 0.04, cy + s * 0.04, width, color)
    if with_text:
        font = ImageFont.truetype('/System/Library/Fonts/Avenir Next.ttc', round(s * 0.068), index=7)  # Regular
        text = 'HAOJI'
        spacing = s * 0.032
        widths = [d.textlength(ch, font=font) for ch in text]
        total = sum(widths) + spacing * (len(text) - 1)
        x = ox + (s - total) / 2
        y = oy + s * 0.78
        for ch, w in zip(text, widths):
            d.text((x, y), ch, font=font, fill=mono or TEXT)
            x += w + spacing


def render(name, size, bg, scale, with_text=True, mono=None):
    big = size * SS
    im = Image.new('RGBA', (big, big), bg + (255,) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    o = big * (1 - scale) / 2
    draw_mark(d, big, o, o, scale, with_text, mono)
    im = im.resize((size, size), Image.LANCZOS)
    if bg:
        im = im.convert('RGB')  # iOS icons must not have alpha
    im.save(os.path.join(OUT, name))
    print('wrote', name)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    render('icon-1024.png', 1024, BG, 1.0)
    # iOS asset catalog sizes (app/ios/Haoji/Images.xcassets/AppIcon.appiconset uses these names).
    for px in (40, 58, 60, 80, 87, 120, 180):
        render(f'icon-{px}.png', px, BG, 1.0, with_text=px >= 120)
    # Android adaptive: keep the mark inside the 66% safe zone.
    render('android-icon-foreground.png', 512, None, 0.62)
    Image.new('RGB', (512, 512), BG).save(os.path.join(OUT, 'android-icon-background.png'))
    render('android-icon-monochrome.png', 512, None, 0.62, with_text=False, mono=(255, 255, 255))
    render('splash-icon.png', 1024, None, 1.0)
