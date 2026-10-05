#!/usr/bin/env python3
"""Regenerate both apps' opaque 1024px icons and offline logos. Requires Pillow + numpy.

The CHUB wordmark is cut from client/public/chub-logo.png (its alpha channel, 835px wide, so nothing is upscaled)
and filled with flat brand colors:
  ConstructHUB      navy #0d1b3d, orange wordmark (matches the site's icon-512 / apple-touch-icon)
  ConstructHUB CRM  orange, white wordmark + navy "CRM" — tells the two apart at a glance on the home screen
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
NAVY, ORANGE, WHITE = (13, 27, 61), (248, 112, 41), (255, 255, 255)
FONTS = ['/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
         '/System/Library/Fonts/Supplemental/Arial Bold.ttf']


def wordmark() -> Image.Image:
    with Image.open(ROOT / 'client/public/chub-logo.png') as logo:
        alpha = logo.convert('RGBA').split()[3]
    ys, xs = np.where(np.array(alpha) > 0)
    return alpha.crop((xs.min() - 4, ys.min() - 4, xs.max() + 5, ys.max() + 5))


def icon(mark: Image.Image, bg, fg, width: int, label: str = '', label_color=None) -> Image.Image:
    canvas = Image.new('RGB', (1024, 1024), bg)
    m = mark.resize((width, round(mark.height * width / mark.width)), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(canvas)
    if not label:
        canvas.paste(Image.new('RGB', m.size, fg), ((1024 - m.width) // 2, (1024 - m.height) // 2), m)
        return canvas
    font = ImageFont.truetype(next(f for f in FONTS if Path(f).exists()), 210)
    spacing, gap = 34, 80
    widths = [draw.textlength(ch, font=font) for ch in label]
    top, bottom = font.getbbox(label)[1], font.getbbox(label)[3]
    group = m.height + gap + (bottom - top)
    y = (1024 - group) // 2
    canvas.paste(Image.new('RGB', m.size, fg), ((1024 - m.width) // 2, y), m)
    x, ty = (1024 - (sum(widths) + spacing * (len(label) - 1))) / 2, y + m.height + gap - top
    for ch, w in zip(label, widths):
        draw.text((x, ty), ch, font=font, fill=label_color)
        x += w + spacing
    return canvas


mark = wordmark()
for target, art in [('ConstructHUB', icon(mark, NAVY, ORANGE, 780)),
                    ('ConstructHUBCRM', icon(mark, ORANGE, WHITE, 700, 'CRM', NAVY))]:
    assets = ROOT / 'ios' / target / 'Assets.xcassets'
    assets.mkdir(parents=True, exist_ok=True)
    info = {'version': 1, 'author': 'xcode'}
    (assets / 'Contents.json').write_text(json.dumps({'info': info}, indent=2) + '\n')
    for name in ['AppIcon.appiconset', 'Logo.imageset']:
        folder = assets / name
        folder.mkdir(exist_ok=True)
        art.save(folder / 'icon.png', optimize=True)
        entry = {'filename': 'icon.png', 'idiom': 'universal'}
        if name.startswith('AppIcon'):
            entry.update({'platform': 'ios', 'size': '1024x1024'})
        else:
            entry['scale'] = '1x'
        (folder / 'Contents.json').write_text(json.dumps({'images': [entry], 'info': info}, indent=2) + '\n')
    print(f'{target}: wordmark {mark.size} -> opaque RGB 1024x1024')
