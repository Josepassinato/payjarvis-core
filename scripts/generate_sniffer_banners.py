#!/usr/bin/env python3
"""
Generate all Sniffer-branded banners (replacing old Jarvis ones).
- 8 landscape banners (1200x630) for sniffer_*.png
- 8 square banners (1080x1080) for banner_day*.png
Brand: Sniffer, orange #ff6b2b, sniffershop.com
"""

from PIL import Image, ImageDraw, ImageFont
import math
import os

# Brand colors
BG_COLOR = (22, 27, 44)          # Dark navy
GRID_COLOR = (35, 42, 65)       # Subtle grid
WHITE = (255, 255, 255)
GRAY = (160, 165, 180)
ORANGE = (255, 107, 43)         # #ff6b2b
ORANGE_DIM = (180, 75, 30)      # Dimmer orange for circles
ORANGE_LIGHT = (255, 140, 80)   # Lighter orange

# Fonts
FONT_BOLD = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
FONT_REGULAR = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
FONT_LIGHT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "apps", "api", "public", "banners")
OUT_DIR_PUBLIC = os.path.join(os.path.dirname(__file__), "..", "public", "banners")


def draw_grid(draw, w, h, spacing=60):
    for x in range(0, w, spacing):
        draw.line([(x, 0), (x, h)], fill=GRID_COLOR, width=1)
    for y in range(0, h, spacing):
        draw.line([(0, y), (w, y)], fill=GRID_COLOR, width=1)


def draw_circle(img, cx, cy, r, color, alpha=60):
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*color, alpha))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))


def draw_badge(draw, x, y, text, color):
    font = ImageFont.truetype(FONT_REGULAR, 14)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x, pad_y = 14, 6
    draw.rounded_rectangle(
        [x, y, x + tw + pad_x * 2, y + th + pad_y * 2],
        radius=4, fill=color
    )
    draw.text((x + pad_x, y + pad_y - 1), text, fill=WHITE, font=font)


def draw_icon_diamond(draw, cx, cy, size, color):
    s = size
    points = [(cx, cy - s), (cx + s, cy), (cx, cy + s), (cx - s, cy)]
    draw.polygon(points, fill=color)
    inner = size * 0.5
    points2 = [(cx, cy - inner), (cx + inner, cy), (cx, cy + inner), (cx - inner, cy)]
    draw.polygon(points2, fill=BG_COLOR)


def draw_icon_star(draw, cx, cy, size, color):
    s = size * 0.4
    points = [
        (cx, cy - size), (cx + s, cy - s),
        (cx + size, cy), (cx + s, cy + s),
        (cx, cy + size), (cx - s, cy + s),
        (cx - size, cy), (cx - s, cy - s),
    ]
    draw.polygon(points, fill=color)


def draw_icon_circle_dot(draw, cx, cy, size, color):
    draw.ellipse([cx - size, cy - size, cx + size, cy + size], outline=color, width=3)
    inner = size * 0.45
    draw.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=color)


def draw_dog_icon(draw, cx, cy, size, color):
    """Simple dog face icon."""
    s = size
    # Head circle
    draw.ellipse([cx - s, cy - s * 0.8, cx + s, cy + s * 0.8], fill=color)
    # Ears (triangles)
    ear_w = s * 0.5
    draw.polygon([(cx - s * 0.7, cy - s * 0.6), (cx - s * 1.1, cy - s * 1.3), (cx - s * 0.2, cy - s * 0.9)], fill=color)
    draw.polygon([(cx + s * 0.7, cy - s * 0.6), (cx + s * 1.1, cy - s * 1.3), (cx + s * 0.2, cy - s * 0.9)], fill=color)
    # Eyes
    eye_r = s * 0.12
    draw.ellipse([cx - s * 0.35 - eye_r, cy - s * 0.15 - eye_r, cx - s * 0.35 + eye_r, cy - s * 0.15 + eye_r], fill=BG_COLOR)
    draw.ellipse([cx + s * 0.35 - eye_r, cy - s * 0.15 - eye_r, cx + s * 0.35 + eye_r, cy - s * 0.15 + eye_r], fill=BG_COLOR)
    # Nose
    nose_r = s * 0.15
    draw.ellipse([cx - nose_r, cy + s * 0.1, cx + nose_r, cy + s * 0.1 + nose_r * 1.5], fill=BG_COLOR)


# ============================================================
# LANDSCAPE BANNERS (1200x630) — sniffer_*.png
# ============================================================

LANDSCAPE_BANNERS = [
    {
        "file": "sniffer_welcome",
        "badge": "SNIFFER",
        "badge_color": ORANGE,
        "title": "Your Deal-Hunting\nAgent is Ready.",
        "subtitle": "Shopping. Travel. Health. Learning.\nAll in one conversation.",
        "icon": "star",
    },
    {
        "file": "sniffer_finance",
        "badge": "NEW FEATURE",
        "badge_color": ORANGE,
        "title": "Your finances,\nunder control.",
        "subtitle": "Spending patterns. Savings opportunities.\nMonthly intelligence report.",
        "icon": "diamond",
    },
    {
        "file": "sniffer_travel",
        "badge": "UNLOCKED",
        "badge_color": ORANGE,
        "title": "Full trip planning,\none conversation.",
        "subtitle": "Flights. Hotels. Restaurants.\nComplete itinerary in minutes.",
        "icon": "diamond",
    },
    {
        "file": "sniffer_health",
        "badge": "NEW CAPABILITY",
        "badge_color": ORANGE,
        "title": "Sniffer now tracks\nyour health.",
        "subtitle": "Nutrition plans. Workout routines.\nPersonal metrics.",
        "icon": "diamond",
    },
    {
        "file": "sniffer_intelligence",
        "badge": "FINAL UPGRADE",
        "badge_color": ORANGE,
        "title": "Market intelligence,\ndelivered weekly.",
        "subtitle": "Industry news. Opportunities.\nYour sector, always monitored.",
        "icon": "star",
    },
    {
        "file": "sniffer_learning",
        "badge": "UNLOCKED",
        "badge_color": ORANGE,
        "title": "Your personal tutor\nis now active.",
        "subtitle": "Entrepreneurship. Finance. Languages.\nAny subject. Any time.",
        "icon": "diamond",
    },
    {
        "file": "sniffer_news",
        "badge": "DAILY BRIEFING",
        "badge_color": ORANGE,
        "title": "Your morning briefing,\ncurated by Sniffer.",
        "subtitle": "Tech. Business. Your industry.\nEvery day. Zero noise.",
        "icon": "circle_dot",
    },
    {
        "file": "sniffer_documents",
        "badge": "UPGRADE",
        "badge_color": ORANGE,
        "title": "Sniffer handles\nyour documents.",
        "subtitle": "Contracts. Proposals. Emails.\nOrganization made effortless.",
        "icon": "circle_dot",
    },
]


def generate_landscape(banner, out_dir):
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG_COLOR)
    draw = ImageDraw.Draw(img)

    draw_grid(draw, W, H)

    # Large circle left
    draw_circle(img, 200, 300, 280, ORANGE_DIM, alpha=35)
    draw = ImageDraw.Draw(img)

    # Small circle right with icon
    draw_circle(img, 990, 230, 80, ORANGE_DIM, alpha=40)
    draw = ImageDraw.Draw(img)

    icon_fn = {
        "star": draw_icon_star,
        "diamond": draw_icon_diamond,
        "circle_dot": draw_icon_circle_dot,
    }
    icon_fn.get(banner["icon"], draw_icon_star)(draw, 990, 230, 28, ORANGE)

    # Badge
    draw_badge(draw, 70, 50, banner["badge"], banner["badge_color"])

    # Title
    title_font = ImageFont.truetype(FONT_BOLD, 62)
    draw.text((70, 120), banner["title"], fill=WHITE, font=title_font)

    # Subtitle
    sub_font = ImageFont.truetype(FONT_LIGHT, 22)
    # Calculate Y position based on title lines
    title_lines = banner["title"].count("\n") + 1
    sub_y = 120 + title_lines * 75 + 10
    draw.text((70, sub_y), banner["subtitle"], fill=GRAY, font=sub_font)

    # Footer: SNIFFER + sniffershop.com
    footer_bold = ImageFont.truetype(FONT_REGULAR, 16)
    footer_light = ImageFont.truetype(FONT_LIGHT, 14)
    draw.text((W - 180, H - 60), "SNIFFER", fill=WHITE, font=footer_bold)
    draw.text((W - 180, H - 38), "sniffershop.com", fill=GRAY, font=footer_light)

    path = os.path.join(out_dir, f"{banner['file']}.png")
    img.save(path, "PNG", optimize=True)
    print(f"  OK: {path}")


# ============================================================
# SQUARE BANNERS (1080x1080) — banner_day*.png
# ============================================================

SQUARE_BANNERS = [
    {
        "file": "banner_day0_welcome",
        "day_badge": "DIA 0  \u2014  BEM-VINDO",
        "title": "Seu Farejador de Ofertas\nest\u00e1 Pronto!",
        "subtitle": "Shopping \u2022 Travel \u2022 Health \u2022 Learning \u2022 Tudo em uma conversa",
        "cta": "Manda um 'Oi' pra come\u00e7ar",
        "icon": "dog",
    },
    {
        "file": "banner_day3_voice",
        "day_badge": "DIA 3  \u2014  VOZ",
        "title": "Fale com o Sniffer\npor \u00c1udio",
        "subtitle": "Mande um \u00e1udio e receba a resposta em voz \u2014\ncomo falar com um amigo",
        "cta": "Testa agora: grave um \u00e1udio!",
        "icon": "mic",
    },
    {
        "file": "banner_day5_shopping",
        "day_badge": "DIA 5  \u2014  COMPRAS",
        "title": "Sniffer encontra\no melhor pre\u00e7o pra voc\u00ea",
        "subtitle": "Amazon \u2022 Walmart \u2022 Target \u2022 Macy's\nCompara\u00e7\u00e3o instant\u00e2nea",
        "cta": "Pede: 'compara pre\u00e7os de...'",
        "icon": "cart",
    },
    {
        "file": "banner_day8_location",
        "day_badge": "DIA 8  \u2014  LOCALIZA\u00c7\u00c3O",
        "title": "Sniffer sabe onde\nvoc\u00ea est\u00e1",
        "subtitle": "Restaurantes, lojas e servi\u00e7os\nperto de voc\u00ea \u2014 com um clique",
        "cta": "Ativa sua localiza\u00e7\u00e3o!",
        "icon": "pin",
    },
    {
        "file": "banner_day11_restaurants",
        "day_badge": "DIA 11  \u2014  RESTAURANTES",
        "title": "Sniffer encontra\no restaurante ideal",
        "subtitle": "Reservas \u2022 Avalia\u00e7\u00f5es \u2022 Card\u00e1pios\nTudo na conversa",
        "cta": "Pede: 'restaurante italiano perto'",
        "icon": "fork",
    },
    {
        "file": "banner_day14_travel",
        "day_badge": "DIA 14  \u2014  VIAGENS",
        "title": "Planeje sua viagem\ncom o Sniffer",
        "subtitle": "V\u00f4os \u2022 Hot\u00e9is \u2022 Roteiros\nTudo organizado pra voc\u00ea",
        "cta": "Pede: 'v\u00f4os pra Miami'",
        "icon": "plane",
    },
    {
        "file": "banner_day18_documents",
        "day_badge": "DIA 18  \u2014  DOCUMENTOS",
        "title": "Sniffer cuida dos\nseus documentos",
        "subtitle": "Contratos \u2022 Propostas \u2022 Emails\nOrganiza\u00e7\u00e3o sem esfor\u00e7o",
        "cta": "Pede: 'gera um contrato de...'",
        "icon": "doc",
    },
    {
        "file": "banner_day21_fullpower",
        "day_badge": "DIA 21  \u2014  PODER TOTAL",
        "title": "Sniffer no m\u00e1ximo\npoder \ud83d\udc15",
        "subtitle": "Todas as ferramentas ativas\nVoc\u00ea tem um assistente completo",
        "cta": "Aproveite tudo!",
        "icon": "dog",
    },
]


def draw_simple_icon(draw, cx, cy, icon_type, size, color):
    if icon_type == "dog":
        draw_dog_icon(draw, cx, cy, size, color)
    elif icon_type == "mic":
        # Microphone
        w, h = size * 0.4, size * 0.8
        draw.rounded_rectangle([cx - w, cy - h, cx + w, cy + h * 0.3], radius=int(w), fill=color)
        draw.ellipse([cx - size * 0.15, cy - h * 0.5, cx + size * 0.15, cy - h * 0.2], fill=WHITE)
        draw.arc([cx - w * 1.3, cy - h * 0.2, cx + w * 1.3, cy + h * 0.7], 0, 180, fill=color, width=3)
        draw.line([(cx, cy + h * 0.7), (cx, cy + h)], fill=color, width=3)
    elif icon_type == "cart":
        draw.rounded_rectangle([cx - size * 0.6, cy - size * 0.4, cx + size * 0.6, cy + size * 0.3], radius=8, outline=color, width=3)
        draw.ellipse([cx - size * 0.4, cy + size * 0.4, cx - size * 0.2, cy + size * 0.6], fill=color)
        draw.ellipse([cx + size * 0.2, cy + size * 0.4, cx + size * 0.4, cy + size * 0.6], fill=color)
    elif icon_type == "pin":
        draw.ellipse([cx - size * 0.5, cy - size * 0.7, cx + size * 0.5, cy + size * 0.1], fill=color)
        draw.polygon([(cx - size * 0.3, cy), (cx, cy + size * 0.8), (cx + size * 0.3, cy)], fill=color)
        draw.ellipse([cx - size * 0.2, cy - size * 0.45, cx + size * 0.2, cy - size * 0.15], fill=BG_COLOR)
    elif icon_type == "fork":
        for dx in [-size * 0.3, 0, size * 0.3]:
            draw.line([(cx + dx, cy - size * 0.6), (cx + dx, cy - size * 0.1)], fill=color, width=3)
        draw.rounded_rectangle([cx - size * 0.45, cy - size * 0.15, cx + size * 0.45, cy + size * 0.05], radius=5, fill=color)
        draw.line([(cx, cy + size * 0.05), (cx, cy + size * 0.7)], fill=color, width=4)
    elif icon_type == "plane":
        # Simple plane silhouette
        draw.polygon([
            (cx, cy - size * 0.7),
            (cx + size * 0.8, cy + size * 0.1),
            (cx + size * 0.15, cy + size * 0.1),
            (cx + size * 0.2, cy + size * 0.5),
            (cx, cy + size * 0.35),
            (cx - size * 0.2, cy + size * 0.5),
            (cx - size * 0.15, cy + size * 0.1),
            (cx - size * 0.8, cy + size * 0.1),
        ], fill=color)
    elif icon_type == "doc":
        draw.rounded_rectangle([cx - size * 0.4, cy - size * 0.6, cx + size * 0.4, cy + size * 0.6], radius=6, outline=color, width=3)
        for i, dy in enumerate([-0.25, -0.05, 0.15]):
            w = size * (0.5 if i == 0 else 0.4)
            draw.line([(cx - w * 0.8, cy + size * dy), (cx + w * 0.8, cy + size * dy)], fill=color, width=2)
    else:
        draw_icon_star(draw, cx, cy, size, color)


def generate_square(banner, out_dir):
    W, H = 1080, 1080
    img = Image.new("RGB", (W, H), BG_COLOR)
    draw = ImageDraw.Draw(img)

    draw_grid(draw, W, H, spacing=60)

    # Day badge at top
    badge_font = ImageFont.truetype(FONT_REGULAR, 18)
    bbox = draw.textbbox((0, 0), banner["day_badge"], font=badge_font)
    tw = bbox[2] - bbox[0]
    bx = (W - tw - 30) // 2
    draw.rounded_rectangle([bx, 40, bx + tw + 30, 80], radius=20, outline=GRAY, width=1)
    draw.text((bx + 15, 47), banner["day_badge"], fill=GRAY, font=badge_font)

    # "S N I F F E R" spaced title
    title_font = ImageFont.truetype(FONT_BOLD, 36)
    spaced = "S  N  I  F  F  E  R"
    bbox2 = draw.textbbox((0, 0), spaced, font=title_font)
    tw2 = bbox2[2] - bbox2[0]
    draw.text(((W - tw2) // 2, 95), spaced, fill=ORANGE, font=title_font)

    # Icon in circle
    icon_cx, icon_cy = W // 2, 260
    icon_r = 75

    # Glow
    draw_circle(img, icon_cx, icon_cy, icon_r + 20, ORANGE_DIM, alpha=25)
    draw = ImageDraw.Draw(img)

    # Circle bg
    draw.ellipse([icon_cx - icon_r, icon_cy - icon_r, icon_cx + icon_r, icon_cy + icon_r], fill=ORANGE)

    # Icon
    draw_simple_icon(draw, icon_cx, icon_cy, banner["icon"], 40, WHITE)

    # Main title
    main_font = ImageFont.truetype(FONT_BOLD, 42)
    lines = banner["title"].split("\n")
    total_h = len(lines) * 55
    start_y = 390
    for i, line in enumerate(lines):
        bbox3 = draw.textbbox((0, 0), line, font=main_font)
        tw3 = bbox3[2] - bbox3[0]
        draw.text(((W - tw3) // 2, start_y + i * 55), line, fill=WHITE, font=main_font)

    # Subtitle
    sub_font = ImageFont.truetype(FONT_LIGHT, 22)
    sub_lines = banner["subtitle"].split("\n")
    sub_y = start_y + len(lines) * 55 + 20
    for i, line in enumerate(sub_lines):
        bbox4 = draw.textbbox((0, 0), line, font=sub_font)
        tw4 = bbox4[2] - bbox4[0]
        draw.text(((W - tw4) // 2, sub_y + i * 32), line, fill=GRAY, font=sub_font)

    # CTA button
    cta_font = ImageFont.truetype(FONT_REGULAR, 22)
    bbox5 = draw.textbbox((0, 0), banner["cta"], font=cta_font)
    cta_w = bbox5[2] - bbox5[0]
    cta_h = bbox5[3] - bbox5[1]
    cta_x = (W - cta_w - 50) // 2
    cta_y = H - 170

    # Gradient-ish button (orange)
    draw.rounded_rectangle(
        [cta_x, cta_y, cta_x + cta_w + 50, cta_y + cta_h + 24],
        radius=8, fill=ORANGE
    )
    draw.text((cta_x + 25, cta_y + 10), banner["cta"], fill=WHITE, font=cta_font)

    # Footer
    footer_font = ImageFont.truetype(FONT_LIGHT, 18)
    ft = "sniffershop.com"
    bbox6 = draw.textbbox((0, 0), ft, font=footer_font)
    ftw = bbox6[2] - bbox6[0]
    draw.text(((W - ftw) // 2, H - 65), ft, fill=GRAY, font=footer_font)

    path = os.path.join(out_dir, f"{banner['file']}.png")
    img.save(path, "PNG", optimize=True)
    print(f"  OK: {path}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(OUT_DIR_PUBLIC, exist_ok=True)

    print("Generating landscape banners (sniffer_*.png)...")
    for b in LANDSCAPE_BANNERS:
        generate_landscape(b, OUT_DIR)
        generate_landscape(b, OUT_DIR_PUBLIC)

    print("\nGenerating square banners (banner_day*.png)...")
    for b in SQUARE_BANNERS:
        generate_square(b, OUT_DIR)
        generate_square(b, OUT_DIR_PUBLIC)

    print(f"\nDone! Generated {len(LANDSCAPE_BANNERS) * 2} landscape + {len(SQUARE_BANNERS) * 2} square = {(len(LANDSCAPE_BANNERS) + len(SQUARE_BANNERS)) * 2} total banners.")


if __name__ == "__main__":
    main()
