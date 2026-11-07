#!/usr/bin/env python3
"""Build labeled PR before/after PNGs from unmodified synthetic UI captures."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'media'
OUT.mkdir(exist_ok=True)
PAIRS = [
    ('dashboard', 1440),
    ('providers', 1440),
    ('quota', 1440),
    ('config-dark', 1440),
    ('auth-files', 390),
    ('logs', 390),
    ('oauth-model-alias', 390),
]
font = ImageFont.load_default(size=20)
for name, width in PAIRS:
    before = Image.open(ROOT / 'round-1' / 'screenshots' / f'{name}-{width}.png').convert('RGB')
    after = Image.open(ROOT / 'round-6' / 'screenshots' / f'{name}-{width}.png').convert('RGB')
    if before.size != after.size:
        raise ValueError(f'Viewports differ for {name}')
    header = 48
    gap = 16
    image = Image.new('RGB', (before.width * 2 + gap, before.height + header), '#f5f6f7')
    image.paste(before, (0, header))
    image.paste(after, (before.width + gap, header))
    draw = ImageDraw.Draw(image)
    draw.text((16, 12), f'Before · {name} · {width}px', fill='#202428', font=font)
    draw.text((before.width + gap + 16, 12), f'After · {name} · {width}px', fill='#202428', font=font)
    target = OUT / f'{name}-{width}-before-after.png'
    image.save(target, optimize=True)
    print(target.relative_to(ROOT))
