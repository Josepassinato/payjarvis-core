#!/usr/bin/env python3
"""
Generate Sniffer Coupon Hunter banner — landscape (1200x630) + square (1080x1080).
Brand: Sniffer, orange #ff6b2b, coupon hunter theme.
"""

from PIL import Image, ImageDraw, ImageFont
import os

# Brand colors
BG_COLOR = (22, 27, 44)
GRID_COLOR = (35, 42, 65)
WHITE = (255, 255, 255)
GRAY = (160, 165, 180)
ORANGE = (255, 107, 43)       # #ff6b2b
ORANGE_DIM = (180, 75, 30)
ORANGE_LIGHT = (255, 140, 80)
GREEN = (46, 204, 113)        # deal/savings green
RED_URGENT = (231, 76, 60)    # urgent red

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


def draw_dog_icon(draw, cx, cy, size, color):
    s = size
    draw.ellipse([cx - s, cy - s * 0.8, cx + s, cy + s * 0.8], fill=color)
    draw.polygon([(cx - s * 0.7, cy - s * 0.6), (cx - s * 1.1, cy - s * 1.3), (cx - s * 0.2, cy - s * 0.9)], fill=color)
    draw.polygon([(cx + s * 0.7, cy - s * 0.6), (cx + s * 1.1, cy - s * 1.3), (cx + s * 0.2, cy - s * 0.9)], fill=color)
    eye_r = s * 0.12
    draw.ellipse([cx - s * 0.35 - eye_r, cy - s * 0.15 - eye_r, cx - s * 0.35 + eye_r, cy - s * 0.15 + eye_r], fill=BG_COLOR)
    draw.ellipse([cx + s * 0.35 - eye_r, cy - s * 0.15 - eye_r, cx + s * 0.35 + eye_r, cy - s * 0.15 + eye_r], fill=BG_COLOR)
    nose_r = s * 0.15
    draw.ellipse([cx - nose_r, cy + s * 0.1, cx + nose_r, cy + s * 0.1 + nose_r * 1.5], fill=BG_COLOR)


def draw_coupon_icon(draw, cx, cy, size, color):
    """Coupon/ticket icon with dotted line."""
    w, h = size * 1.2, size * 0.7
    # Ticket shape
    draw.rounded_rectangle([cx - w, cy - h, cx + w, cy + h], radius=10, fill=color)
    # Dotted perforation line
    for y_off in range(-int(h * 0.8), int(h * 0.8), 12):
        draw.ellipse([cx + w * 0.3 - 2, cy + y_off - 2, cx + w * 0.3 + 2, cy + y_off + 2], fill=BG_COLOR)
    # Percentage symbol
    pct_font = ImageFont.truetype(FONT_BOLD, int(size * 0.7))
    draw.text((cx - w * 0.55, cy - h * 0.5), "%", fill=BG_COLOR, font=pct_font)
    # Scissors icon (small)
    sc_y = cy + h * 0.3
    draw.ellipse([cx + w * 0.3 - 6, sc_y - 6, cx + w * 0.3 + 6, sc_y + 6], fill=BG_COLOR)


def draw_price_tag(draw, cx, cy, size, color):
    """Price tag icon."""
    s = size
    # Tag body
    points = [
        (cx - s, cy - s * 0.6),
        (cx + s * 0.6, cy - s * 0.6),
        (cx + s, cy),
        (cx + s * 0.6, cy + s * 0.6),
        (cx - s, cy + s * 0.6),
    ]
    draw.polygon(points, fill=color)
    # Hole
    draw.ellipse([cx - s * 0.6, cy - s * 0.15, cx - s * 0.3, cy + s * 0.15], fill=BG_COLOR)


def draw_deal_cards(draw, x, y, w, h):
    """Draw mini deal cards showing different deal types."""
    card_h = int(h * 0.22)
    gap = int(h * 0.06)

    deals = [
        {"emoji": "!", "urgency": "URGENTE", "text": "AirPods Pro", "price": "$189", "was": "$249", "color": RED_URGENT},
        {"emoji": "%", "urgency": "CUPOM", "text": "Amazon 20% OFF", "price": "SAVE20", "was": "", "color": GREEN},
        {"emoji": "$", "urgency": "DEAL", "text": "PS5 Bundle", "price": "$399", "was": "$499", "color": ORANGE},
    ]

    small_font = ImageFont.truetype(FONT_LIGHT, 13)
    bold_small = ImageFont.truetype(FONT_REGULAR, 14)
    price_font = ImageFont.truetype(FONT_BOLD, 16)

    for i, deal in enumerate(deals):
        cy = y + i * (card_h + gap)
        # Card background
        draw.rounded_rectangle(
            [x, cy, x + w, cy + card_h],
            radius=8, fill=(35, 42, 65)
        )
        # Urgency dot
        draw.ellipse([x + 10, cy + card_h // 2 - 4, x + 18, cy + card_h // 2 + 4], fill=deal["color"])
        # Urgency label
        draw.text((x + 24, cy + 5), deal["urgency"], fill=deal["color"], font=bold_small)
        # Product name
        draw.text((x + 24, cy + card_h - 22), deal["text"], fill=WHITE, font=small_font)
        # Price
        draw.text((x + w - 65, cy + 5), deal["price"], fill=GREEN, font=price_font)
        if deal["was"]:
            draw.text((x + w - 65, cy + card_h - 22), deal["was"], fill=GRAY, font=small_font)


def draw_stats_row(draw, x, y, w):
    """Draw stats bar: 3 layers, real-time, BR+USA."""
    font = ImageFont.truetype(FONT_LIGHT, 13)
    bold = ImageFont.truetype(FONT_REGULAR, 15)

    stats = [
        ("3 Camadas", "API + Scraping + Social"),
        ("Real-time", "Push em < 30s"),
        ("BR + USA", "Pelando + Slickdeals"),
    ]

    col_w = w // 3
    for i, (title, sub) in enumerate(stats):
        cx = x + i * col_w + col_w // 2
        draw.text((cx - 40, y), title, fill=ORANGE, font=bold)
        draw.text((cx - 40, y + 22), sub, fill=GRAY, font=font)


# ============================================================
# LANDSCAPE BANNER (1200x630)
# ============================================================

def generate_landscape():
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG_COLOR)
    draw = ImageDraw.Draw(img)

    draw_grid(draw, W, H)

    # Background circles
    draw_circle(img, 180, 280, 250, ORANGE_DIM, alpha=30)
    draw_circle(img, 1050, 150, 120, ORANGE_DIM, alpha=25)
    draw_circle(img, 900, 500, 80, (46, 204, 113), alpha=20)
    draw = ImageDraw.Draw(img)

    # Badge
    draw_badge(draw, 70, 45, "COUPON HUNTER", ORANGE)
    draw_badge(draw, 250, 45, "NEW", GREEN)

    # Title
    title_font = ImageFont.truetype(FONT_BOLD, 56)
    draw.text((70, 110), "Sniffer fareja\nos melhores cupons.", fill=WHITE, font=title_font)

    # Subtitle
    sub_font = ImageFont.truetype(FONT_LIGHT, 20)
    draw.text((70, 270), "Monitoramento 24/7 de ofertas BR + EUA\nAlerta instantaneo quando o preco cai\nWish list personalizada com push < 30s", fill=GRAY, font=sub_font)

    # Stats row
    draw_stats_row(draw, 70, 390, 550)

    # Dog icon with magnifying glass concept
    draw_dog_icon(draw, 1050, 150, 40, ORANGE)

    # Deal cards on the right
    draw_deal_cards(draw, 700, 110, 430, 400)

    # Coupon icon
    draw_coupon_icon(draw, 900, 500, 35, ORANGE_LIGHT)

    # Footer
    footer_bold = ImageFont.truetype(FONT_REGULAR, 16)
    footer_light = ImageFont.truetype(FONT_LIGHT, 14)
    draw.text((70, H - 55), "SNIFFER COUPON HUNTER", fill=ORANGE, font=footer_bold)
    draw.text((70, H - 33), "sniffershop.com", fill=GRAY, font=footer_light)

    # Sniffer logo bottom-right
    draw.text((W - 180, H - 55), "SNIFFER", fill=WHITE, font=footer_bold)
    draw.text((W - 180, H - 33), "sniffershop.com", fill=GRAY, font=footer_light)

    return img


# ============================================================
# SQUARE BANNER (1080x1080) for Telegram/Instagram
# ============================================================

def generate_square():
    W, H = 1080, 1080
    img = Image.new("RGB", (W, H), BG_COLOR)
    draw = ImageDraw.Draw(img)

    draw_grid(draw, W, H, spacing=54)

    # Background circles
    draw_circle(img, 540, 200, 300, ORANGE_DIM, alpha=25)
    draw_circle(img, 900, 800, 150, (46, 204, 113), alpha=20)
    draw = ImageDraw.Draw(img)

    # Badge
    draw_badge(draw, 60, 50, "COUPON HUNTER", ORANGE)
    draw_badge(draw, 260, 50, "NOVO", GREEN)

    # Dog icon (large, centered top)
    draw_dog_icon(draw, 540, 200, 65, ORANGE)

    # Title
    title_font = ImageFont.truetype(FONT_BOLD, 52)
    draw.text((60, 310), "Sniffer fareja\nos melhores\ncupons pra voce.", fill=WHITE, font=title_font)

    # Subtitle
    sub_font = ImageFont.truetype(FONT_LIGHT, 22)
    draw.text((60, 520), "Monitoramento 24/7 de ofertas BR + EUA\nPush em < 30 segundos quando achar", fill=GRAY, font=sub_font)

    # Deal cards
    draw_deal_cards(draw, 60, 610, W - 120, 320)

    # Stats row at bottom
    draw_stats_row(draw, 60, 920, W - 120)

    # CTA
    cta_font = ImageFont.truetype(FONT_REGULAR, 18)
    cta_y = H - 70
    draw.rounded_rectangle([60, cta_y, W - 60, cta_y + 45], radius=8, fill=ORANGE)
    cta_text = "Diz: 'me avisa quando AirPods baixar'"
    bbox = draw.textbbox((0, 0), cta_text, font=cta_font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, cta_y + 12), cta_text, fill=WHITE, font=cta_font)

    return img


# ============================================================
# TELEGRAM CHANNEL CARD (800x418) for @SnifferOfertas
# ============================================================

def generate_channel_card():
    W, H = 800, 418
    img = Image.new("RGB", (W, H), BG_COLOR)
    draw = ImageDraw.Draw(img)

    draw_grid(draw, W, H, spacing=40)

    draw_circle(img, 650, 200, 180, ORANGE_DIM, alpha=30)
    draw = ImageDraw.Draw(img)

    # Badge
    draw_badge(draw, 40, 30, "SNIFFER COUPON HUNTER", ORANGE)

    # Title
    title_font = ImageFont.truetype(FONT_BOLD, 42)
    draw.text((40, 80), "Cupons & Ofertas\nBR + EUA", fill=WHITE, font=title_font)

    # Features
    feat_font = ImageFont.truetype(FONT_LIGHT, 18)
    features = [
        "Monitoramento automatico 24/7",
        "Alertas de preco em < 30 segundos",
        "Wish list com push personalizado",
        "Classificacao de urgencia com IA",
    ]
    for i, feat in enumerate(features):
        y = 210 + i * 30
        draw.ellipse([45, y + 5, 53, y + 13], fill=GREEN)
        draw.text((62, y), feat, fill=GRAY, font=feat_font)

    # Dog icon
    draw_dog_icon(draw, 660, 170, 50, ORANGE)

    # Coupon icon
    draw_coupon_icon(draw, 660, 310, 30, ORANGE_LIGHT)

    # Footer
    footer = ImageFont.truetype(FONT_REGULAR, 14)
    draw.text((40, H - 40), "@SnifferOfertas", fill=ORANGE, font=footer)
    draw.text((W - 180, H - 40), "sniffershop.com", fill=GRAY, font=footer)

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(OUT_DIR_PUBLIC, exist_ok=True)

    print("Generating Coupon Hunter banners...")

    landscape = generate_landscape()
    square = generate_square()
    channel = generate_channel_card()

    # Save to both dirs
    for out_dir in [OUT_DIR, OUT_DIR_PUBLIC]:
        landscape.save(os.path.join(out_dir, "sniffer_coupon_hunter.png"), "PNG", optimize=True)
        square.save(os.path.join(out_dir, "banner_coupon_hunter.png"), "PNG", optimize=True)
        channel.save(os.path.join(out_dir, "sniffer_ofertas_card.png"), "PNG", optimize=True)
        print(f"  Saved to {out_dir}")

    print("Done! 3 banners generated.")


if __name__ == "__main__":
    main()
