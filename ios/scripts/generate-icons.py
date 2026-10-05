#!/usr/bin/env python3
"""Regenerate opaque 1024px icons and offline logos. Requires Pillow (pip install Pillow)."""
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
for target, source in [('ConstructHUB', 'icon-512.png'), ('ConstructHUBCRM', 'chub-logo-square.png')]:
    assets = ROOT / 'ios' / target / 'Assets.xcassets'
    assets.mkdir(parents=True, exist_ok=True)
    info = {'version': 1, 'author': 'xcode'}
    (assets / 'Contents.json').write_text(json.dumps({'info': info}, indent=2) + '\n')
    with Image.open(ROOT / 'client/public' / source) as original:
        rgba = ImageOps.contain(original.convert('RGBA'), (1024, 1024), Image.Resampling.LANCZOS)
        icon = Image.new('RGB', (1024, 1024), 'white')
        icon.paste(rgba, ((1024-rgba.width)//2, (1024-rgba.height)//2), rgba)
        for name in ['AppIcon.appiconset', 'Logo.imageset']:
            folder = assets / name
            folder.mkdir(exist_ok=True)
            icon.save(folder / 'icon.png')
            entry = {'filename': 'icon.png', 'idiom': 'universal'}
            if name.startswith('AppIcon'):
                entry.update({'platform': 'ios', 'size': '1024x1024'})
            else:
                entry['scale'] = '1x'
            (folder / 'Contents.json').write_text(json.dumps({'images': [entry], 'info': info}, indent=2) + '\n')
        print(f'{target}: {source} {original.size} -> opaque RGB 1024x1024')
