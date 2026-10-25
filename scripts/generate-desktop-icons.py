#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "apps" / "desktop" / "build-resources"


def make_icon(size: int = 1024) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    unit = size / 36
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=round(10 * unit), fill="#252223")
    line_width = max(2, round(2.15 * unit))
    white = "#F4EFF1"
    rose = "#D74470"
    for y in (9, 18, 27):
        r = 1.6 * unit
        draw.ellipse((7.5 * unit - r, y * unit - r, 7.5 * unit + r, y * unit + r), fill=white)
    draw.line([(9.2 * unit, 9 * unit), (11.7 * unit, 9 * unit), (13.7 * unit, 9.2 * unit), (15.2 * unit, 12.2 * unit), (18 * unit, 15.8 * unit)], fill=white, width=line_width, joint="curve")
    draw.line([(9.2 * unit, 18 * unit), (18 * unit, 18 * unit)], fill=white, width=line_width)
    draw.line([(9.2 * unit, 27 * unit), (11.7 * unit, 27 * unit), (13.7 * unit, 26.8 * unit), (15.2 * unit, 23.8 * unit), (18 * unit, 20.2 * unit)], fill=white, width=line_width, joint="curve")
    draw.line([(20 * unit, 18 * unit), (28.5 * unit, 18 * unit)], fill=white, width=line_width)
    draw.polygon([(18 * unit, 15.2 * unit), (20.8 * unit, 18 * unit), (18 * unit, 20.8 * unit), (15.2 * unit, 18 * unit)], fill=rose)
    r = 1.7 * unit
    draw.ellipse((29 * unit - r, 18 * unit - r, 29 * unit + r, 18 * unit + r), fill=rose)
    return image


def make_tray_template(size: int = 36) -> Image.Image:
    """Create the monochrome macOS template from the same brand geometry.

    macOS menu-bar images must be transparent alpha masks.  Keeping the
    geometry here beside the Dock/app icon prevents the status item from
    drifting to a different logo while still allowing macOS to tint it.
    """
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    unit = size / 36
    white = (255, 255, 255, 255)
    line_width = max(1, round(2.15 * unit))
    for y in (9, 18, 27):
        r = 1.6 * unit
        draw.ellipse((7.5 * unit - r, y * unit - r, 7.5 * unit + r, y * unit + r), fill=white)
    draw.line([(9.2 * unit, 9 * unit), (11.7 * unit, 9 * unit), (13.7 * unit, 9.2 * unit), (15.2 * unit, 12.2 * unit), (18 * unit, 15.8 * unit)], fill=white, width=line_width, joint="curve")
    draw.line([(9.2 * unit, 18 * unit), (18 * unit, 18 * unit)], fill=white, width=line_width)
    draw.line([(9.2 * unit, 27 * unit), (11.7 * unit, 27 * unit), (13.7 * unit, 26.8 * unit), (15.2 * unit, 23.8 * unit), (18 * unit, 20.2 * unit)], fill=white, width=line_width, joint="curve")
    draw.line([(20 * unit, 18 * unit), (28.5 * unit, 18 * unit)], fill=white, width=line_width)
    draw.polygon([(18 * unit, 15.2 * unit), (20.8 * unit, 18 * unit), (18 * unit, 20.8 * unit), (15.2 * unit, 18 * unit)], fill=white)
    r = 1.7 * unit
    draw.ellipse((29 * unit - r, 18 * unit - r, 29 * unit + r, 18 * unit + r), fill=white)
    return image


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    icon = make_icon()
    icon.save(OUTPUT / "icon.png", optimize=True)
    icon.save(
        OUTPUT / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    icon.save(OUTPUT / "icon.icns", format="ICNS")
    make_tray_template().save(OUTPUT / "tray-template.png", optimize=True)
    print(f"Generated desktop icons in {OUTPUT}")


if __name__ == "__main__":
    main()
