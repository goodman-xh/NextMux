#!/usr/bin/env python3
"""Every NextMux logo file, generated from assets/brand (run after the logo changes).

    python3 scripts/brand-assets.py

Sources (assets/brand):
  nextmux-logo.png         the logo: the last frame of the launch animation (1254 px, transparent)
  splash-pointer.png       the animation's intact pointer texture
  splash-character.png     the animation's character texture

Outputs:
  apps/desktop/build-resources/icon.png, icon.icns   macOS app icon (the logo on the light rounded tile)
  apps/desktop/build-resources/icon.ico              Windows icon (transparent logo)
  apps/desktop/build-resources/tray-logo*.png        menu-bar logo (the colour logo, 18 pt and @2x)
  apps/desktop/splash/*.webp                         launch-animation textures
  packages/theia-nextmux-extension/src/browser/style/brand/nextmux-logo.png   the app's logo (256 px)
  apps/cloudflare-platform/web/public/…              site logo, favicons, touch icon, share image
Needs Pillow, cwebp and (for .icns) macOS iconutil.
"""
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BRAND = os.path.join(ROOT, 'assets', 'brand')
DESKTOP = os.path.join(ROOT, 'apps', 'desktop')
EXTENSION_BRAND = os.path.join(ROOT, 'packages', 'theia-nextmux-extension', 'src', 'browser', 'style', 'brand')
WEB_PUBLIC = os.path.join(ROOT, 'apps', 'cloudflare-platform', 'web', 'public')
TILE = (244, 239, 236, 255)  # the light tile the old icon used (#f4efec)


def load(name):
    image = Image.open(os.path.join(BRAND, name))
    image.load()
    return image.convert('RGBA')


def trimmed(image, margin=0.03):
    """The drawing without its empty border, on a square canvas with a small margin."""
    box = image.getbbox()
    art = image.crop(box)
    side = int(max(art.size) * (1 + 2 * margin))
    square = Image.new('RGBA', (side, side))
    square.paste(art, ((side - art.width) // 2, (side - art.height) // 2), art)
    return square


def fitted(image, size, fill=1.0):
    canvas = Image.new('RGBA', (size, size))
    inner = max(1, round(size * fill))
    art = image.resize((inner, inner), Image.LANCZOS)
    canvas.paste(art, ((size - inner) // 2, (size - inner) // 2), art)
    return canvas


def save_png(image, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path, optimize=True)


def tile_icon(logo, size=1024):
    """macOS icon grid: an 824 px rounded tile in 1024 with a soft shadow, the logo inside it."""
    scale = size / 1024
    canvas = Image.new('RGBA', (size, size))
    shadow = Image.new('RGBA', (size, size))
    body = (round(100 * scale), round(100 * scale), round(924 * scale), round(924 * scale))
    radius = round(185 * scale)
    ImageDraw.Draw(shadow).rounded_rectangle((body[0], body[1] + round(10 * scale), body[2], body[3] + round(10 * scale)), radius, fill=(0, 0, 0, 70))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(round(18 * scale))))
    tile = Image.new('RGBA', (size, size))
    ImageDraw.Draw(tile).rounded_rectangle(body, radius, fill=TILE)
    canvas.alpha_composite(tile)
    art = fitted(logo, round(700 * scale))
    offset = (size - art.width) // 2
    canvas.alpha_composite(art, (offset, offset))
    return canvas


def mac_icns(icon, path):
    work = tempfile.mkdtemp()
    iconset = os.path.join(work, 'icon.iconset')
    os.makedirs(iconset)
    for base in (16, 32, 128, 256, 512):
        icon.resize((base, base), Image.LANCZOS).save(os.path.join(iconset, f'icon_{base}x{base}.png'))
        icon.resize((base * 2, base * 2), Image.LANCZOS).save(os.path.join(iconset, f'icon_{base}x{base}@2x.png'))
    subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', path], check=True)
    shutil.rmtree(work)


def tray_logo(logo, size):
    """The menu-bar logo: the colour logo itself, so the menu bar shows the same mark as the app (readable on a
    light and on a dark menu bar)."""
    return fitted(trimmed(logo, 0.02), size, 0.98)


def webp(source, target, quality=92):
    subprocess.run(['cwebp', '-quiet', '-q', str(quality), '-alpha_q', '100', '-m', '6', source, '-o', target], check=True)


def share_image(logo, path):
    """1200×630 share card: the logo on the site's dark background."""
    width, height = 1200, 630
    card = Image.new('RGBA', (width, height), (11, 13, 18, 255))
    glow = Image.new('RGBA', (width, height))
    ImageDraw.Draw(glow).ellipse((width // 2 - 330, height // 2 - 300, width // 2 + 330, height // 2 + 300), fill=(123, 92, 255, 90))
    card.alpha_composite(glow.filter(ImageFilter.GaussianBlur(110)))
    art = fitted(logo, 520)
    card.alpha_composite(art, ((width - art.width) // 2, (height - art.height) // 2))
    card.convert('RGB').save(path, optimize=True, quality=90)


def main():
    logo = trimmed(load('nextmux-logo.png'))

    icon = tile_icon(logo)
    save_png(icon, os.path.join(DESKTOP, 'build-resources', 'icon.png'))
    mac_icns(icon, os.path.join(DESKTOP, 'build-resources', 'icon.icns'))
    fitted(logo, 256).save(os.path.join(DESKTOP, 'build-resources', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    source = load('nextmux-logo.png')
    save_png(tray_logo(source, 18), os.path.join(DESKTOP, 'build-resources', 'tray-logo.png'))
    save_png(tray_logo(source, 36), os.path.join(DESKTOP, 'build-resources', 'tray-logo@2x.png'))

    splash = os.path.join(DESKTOP, 'splash')
    os.makedirs(splash, exist_ok=True)
    webp(os.path.join(BRAND, 'splash-pointer.png'), os.path.join(splash, 'pointer.webp'))
    webp(os.path.join(BRAND, 'splash-character.png'), os.path.join(splash, 'character.webp'))

    save_png(fitted(logo, 256), os.path.join(EXTENSION_BRAND, 'nextmux-logo.png'))
    # The whole last frame (untrimmed): the first-launch setup shows it exactly where the launch animation ended.
    save_png(load('nextmux-logo.png').resize((600, 600), Image.LANCZOS), os.path.join(EXTENSION_BRAND, 'nextmux-logo-frame.png'))

    save_png(fitted(logo, 256), os.path.join(WEB_PUBLIC, 'nextmux-logo.png'))
    save_png(fitted(logo, 512), os.path.join(WEB_PUBLIC, 'nextmux-logo-512.png'))
    save_png(fitted(logo, 32), os.path.join(WEB_PUBLIC, 'favicon-32.png'))
    fitted(logo, 64).save(os.path.join(WEB_PUBLIC, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    touch = Image.new('RGBA', (180, 180), TILE)
    touch.alpha_composite(fitted(logo, 150), (15, 15))
    touch.convert('RGB').save(os.path.join(WEB_PUBLIC, 'apple-touch-icon.png'), optimize=True)
    share_image(logo, os.path.join(WEB_PUBLIC, 'og-image.png'))
    print('brand assets written')


if __name__ == '__main__':
    main()
