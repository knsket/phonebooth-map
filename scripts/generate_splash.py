#!/usr/bin/env python3
"""Generate splash screen PNGs at arbitrary sizes."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ICON_PATH = ROOT / "assets" / "icon.png"
TITLE_FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
SUBTITLE_FONT_PATH = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
TOP_COLOR = (232, 244, 253)
BOTTOM_COLOR = (255, 255, 255)
TITLE_COLOR = (30, 58, 95)
SUBTITLE_COLOR = (52, 96, 146)
TITLE = "Phone Booth Map"
SUBTITLE = "テレワークボックスを簡単検索！"


def _draw_background(width: int, height: int) -> Image.Image:
    base = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(base)
    for y in range(height):
        t = y / max(height - 1, 1)
        color = tuple(
            int(TOP_COLOR[i] * (1 - t) + BOTTOM_COLOR[i] * t) for i in range(3)
        )
        draw.line([(0, y), (width, y)], fill=color)

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    circles = [
        (0.14, 0.15, 0.17, 28),
        (0.86, 0.24, 0.14, 22),
        (0.76, 0.76, 0.20, 18),
        (0.17, 0.85, 0.16, 20),
    ]
    for cx_ratio, cy_ratio, r_ratio, alpha in circles:
        r = int(min(width, height) * r_ratio)
        cx = int(width * cx_ratio)
        cy = int(height * cy_ratio)
        od.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(74, 144, 217, alpha))
    return Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")


def _text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def generate_splash(width: int, height: int, icon_path: Path, out_path: Path) -> None:
    is_landscape = width > height
    base = _draw_background(width, height)
    draw = ImageDraw.Draw(base)

    min_side = min(width, height)
    title_size = max(48, int(min_side * 0.072))
    subtitle_size = max(28, int(min_side * 0.04))
    title_font = ImageFont.truetype(TITLE_FONT_PATH, title_size)
    subtitle_font = ImageFont.truetype(SUBTITLE_FONT_PATH, subtitle_size)

    title_w, title_h = _text_size(draw, TITLE, title_font)
    subtitle_w, subtitle_h = _text_size(draw, SUBTITLE, subtitle_font)
    text_block_h = title_h + int(min_side * 0.028) + subtitle_h

    icon = Image.open(icon_path).convert("RGBA")
    if is_landscape:
        icon_size = int(height * 0.42)
        gap = int(width * 0.035)
        text_block_w = max(title_w, subtitle_w)
        group_w = icon_size + gap + text_block_w
        group_h = max(icon_size, text_block_h)
        origin_x = (width - group_w) // 2
        origin_y = (height - group_h) // 2

        icon_resized = icon.resize((icon_size, icon_size), Image.LANCZOS)
        icon_x = origin_x
        icon_y = origin_y + (group_h - icon_size) // 2
        base.paste(icon_resized, (icon_x, icon_y), icon_resized)

        text_x = origin_x + icon_size + gap
        title_y = origin_y + (group_h - text_block_h) // 2
        draw.text((text_x, title_y), TITLE, font=title_font, fill=TITLE_COLOR)
        draw.text(
            (text_x, title_y + title_h + int(min_side * 0.028)),
            SUBTITLE,
            font=subtitle_font,
            fill=SUBTITLE_COLOR,
        )
    else:
        icon_size = int(min(width, height) * 0.33)
        icon_resized = icon.resize((icon_size, icon_size), Image.LANCZOS)
        icon_x = (width - icon_size) // 2
        icon_y = int(height * 0.28)
        base.paste(icon_resized, (icon_x, icon_y), icon_resized)

        title_y = icon_y + icon_size + int(min_side * 0.062)
        draw.text(((width - title_w) // 2, title_y), TITLE, font=title_font, fill=TITLE_COLOR)
        draw.text(
            ((width - subtitle_w) // 2, title_y + title_h + int(min_side * 0.028)),
            SUBTITLE,
            font=subtitle_font,
            fill=SUBTITLE_COLOR,
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    base.save(out_path, optimize=True)
    print(f"saved {out_path} ({width}x{height})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("width", type=int)
    parser.add_argument("height", type=int)
    parser.add_argument("output", type=Path)
    parser.add_argument("--icon", type=Path, default=ICON_PATH)
    args = parser.parse_args()
    generate_splash(args.width, args.height, args.icon, args.output)


if __name__ == "__main__":
    main()
