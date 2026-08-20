# -*- coding: utf-8 -*-
"""Generate app icon: rounded-square blue gradient with MD monogram."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build')
os.makedirs(OUT_DIR, exist_ok=True)

SIZE = 512
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded square background (vertical gradient blue)
def lerp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

TOP = (43, 64, 128)
BOTTOM = (24, 39, 80)
for y in range(SIZE):
    color = lerp(TOP, BOTTOM, y / SIZE)
    d.line([(0, y), (SIZE, y)], fill=color + (255,))

# Rounded-corner mask
mask = Image.new('L', (SIZE, SIZE), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=90, fill=255)
img.putalpha(mask)

# Decorative bottom accent line
d.rounded_rectangle([64, SIZE - 64, SIZE - 64, SIZE - 56], radius=8, fill=(138, 180, 248, 230))

# "MD" monogram
target_font = None
for path in [
    r"C:\Windows\Fonts\seguisb.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\msyhbd.ttc",
]:
    if os.path.exists(path):
        try:
            target_font = ImageFont.truetype(path, 300)
            break
        except Exception:
            continue
if target_font is None:
    target_font = ImageFont.load_default()

text = "MD"
bbox = d.textbbox((0, 0), text, font=target_font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
tx = (SIZE - tw) / 2 - bbox[0]
ty = (SIZE - th) / 2 - bbox[1] - 16

# Draw text manually with alpha support: use separate layer for crisp text
txt_layer = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
td = ImageDraw.Draw(txt_layer)
td.text((tx, ty), text, font=target_font, fill=(255, 255, 255, 255))
# soft drop shadow (simulated by offset dark layer at low alpha)
shd = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shd)
sd.text((tx + 8, ty + 10), text, font=target_font, fill=(0, 0, 0, 90))
img = Image.alpha_composite(img, shd)
img = Image.alpha_composite(img, txt_layer)

# Save PNG
png_path = os.path.join(OUT_DIR, 'icon.png')
img.save(png_path, 'PNG')

# Save ICO (multi-size)
ico_path = os.path.join(OUT_DIR, 'icon.ico')
img.save(ico_path, 'ICO', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

print('OK:', png_path)
print('OK:', ico_path)