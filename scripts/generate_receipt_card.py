#!/usr/bin/env python3
"""
Sniffer Receipt Card Generator — 400x500 PNG
Generates shareable savings cards after price comparison.
Callable as: python3 generate_receipt_card.py --product "..." --price 189.90 --avg 262.90 --currency BRL --referral "https://..." --output /tmp/card.png
Or as module: generate_receipt_card(product, price, avg_price, currency, referral_url) → bytes
"""

from PIL import Image, ImageDraw, ImageFont
import os, sys, argparse

W, H = 400, 500

FONT_BOLD = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
FONT_SEMI = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
FONT_REG  = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"

ORANGE  = (255, 107, 43)   # #ff6b2b
GREEN   = (34, 197, 94)    # savings green
GRAY    = (156, 163, 175)
DARK    = (31, 41, 55)
WHITE   = (255, 255, 255)
LIGHT   = (249, 250, 251)

def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except:
        return ImageFont.load_default()

def text_cx(draw, text, fnt, y, fill, img_w=W):
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    draw.text(((img_w - tw) / 2, y), text, font=fnt, fill=fill)

def draw_strikethrough(draw, text, fnt, y, fill, img_w=W):
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (img_w - tw) / 2
    draw.text((x, y), text, font=fnt, fill=fill)
    mid_y = y + th // 2 + 2
    draw.line([(x - 2, mid_y), (x + tw + 2, mid_y)], fill=fill, width=2)

def format_price(price, currency):
    if currency == "BRL":
        return f"R$ {price:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    elif currency == "EUR":
        return f"\u20ac{price:,.2f}"
    else:
        return f"${price:,.2f}"

def generate_card(product, price, avg_price, currency="USD", referral_url="sniffershop.com", level=None):
    """Generate a receipt card and return as PIL Image."""
    img = Image.new("RGBA", (W, H), WHITE)
    draw = ImageDraw.Draw(img)

    # Orange top border
    draw.rectangle([0, 0, W, 6], fill=ORANGE)

    # Bottom orange accent
    draw.rectangle([0, H - 4, W, H], fill=ORANGE)

    # Sniffer logo area
    fnt_logo = font(FONT_BOLD, 28)
    text_cx(draw, "\U0001F415 Sniffer", fnt_logo, 24, ORANGE)

    # Subtitle
    fnt_sub = font(FONT_REG, 13)
    text_cx(draw, "Farejou o melhor preço pra você", fnt_sub, 60, GRAY)

    # Divider
    draw.line([(30, 90), (W - 30, 90)], fill=(229, 231, 235), width=1)

    # Product name (truncate if too long)
    display_product = product if len(product) <= 32 else product[:29] + "..."
    fnt_product = font(FONT_SEMI, 18)
    text_cx(draw, display_product, fnt_product, 108, DARK)

    # If product name is long, show second line
    if len(product) > 32:
        line2 = product[29:58] + ("..." if len(product) > 58 else "")
        fnt_p2 = font(FONT_REG, 14)
        text_cx(draw, line2, fnt_p2, 134, GRAY)

    # Price found (big, green)
    price_str = format_price(price, currency)
    fnt_price = font(FONT_BOLD, 42)
    text_cx(draw, price_str, fnt_price, 165, GREEN)

    # Average price (strikethrough, gray)
    avg_str = f"Preço médio: {format_price(avg_price, currency)}"
    fnt_avg = font(FONT_REG, 16)
    draw_strikethrough(draw, avg_str, fnt_avg, 225, GRAY)

    # Divider
    draw.line([(50, 260), (W - 50, 260)], fill=(229, 231, 235), width=1)

    # Savings box
    savings = avg_price - price
    pct = (savings / avg_price) * 100 if avg_price > 0 else 0
    savings_str = format_price(savings, currency)

    # Orange rounded rect background for savings
    box_y = 275
    box_h = 70
    draw.rounded_rectangle(
        [30, box_y, W - 30, box_y + box_h],
        radius=12,
        fill=(255, 247, 237)  # orange-50
    )
    draw.rounded_rectangle(
        [30, box_y, W - 30, box_y + box_h],
        radius=12,
        outline=ORANGE,
        width=2
    )

    fnt_savings_label = font(FONT_SEMI, 14)
    text_cx(draw, "Você economizou", fnt_savings_label, box_y + 10, ORANGE)

    fnt_savings_val = font(FONT_BOLD, 26)
    savings_text = f"{savings_str} ({pct:.0f}%)"
    text_cx(draw, savings_text, fnt_savings_val, box_y + 32, ORANGE)

    # Level badge (if provided)
    if level:
        level_labels = {
            'puppy': '\U0001F436 Puppy', 'sniffer': '\U0001F415 Sniffer',
            'hunter': '\U0001F9AE Hunter', 'master': '\U0001F3C5 Master', 'legend': '\U0001F3C6 Legend'
        }
        level_text = level_labels.get(level, level)
        fnt_level = font(FONT_SEMI, 11)
        text_cx(draw, f"Farejador {level_text}", fnt_level, 355, GRAY)

    # Share CTA
    cta_y = 370 if level else 365
    fnt_cta = font(FONT_SEMI, 13)
    text_cx(draw, "Compartilha pra mostrar que", fnt_cta, cta_y, DARK)
    text_cx(draw, "você compra melhor!", fnt_cta, cta_y + 18, DARK)

    # Footer
    draw.rectangle([0, 430, W, H], fill=(31, 41, 55))
    fnt_footer = font(FONT_BOLD, 14)
    fnt_footer_sm = font(FONT_REG, 11)
    text_cx(draw, "\U0001F415 sniffershop.com", fnt_footer, 442, WHITE)
    text_cx(draw, "Fareja o melhor preço", fnt_footer_sm, 464, (156, 163, 175))

    return img


def generate_card_bytes(product, price, avg_price, currency="USD", referral_url="sniffershop.com", level=None):
    """Generate card and return as PNG bytes."""
    import io
    img = generate_card(product, price, avg_price, currency, referral_url, level)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Sniffer receipt card")
    parser.add_argument("--product", required=True, help="Product name")
    parser.add_argument("--price", type=float, required=True, help="Best price found")
    parser.add_argument("--avg", type=float, required=True, help="Average market price")
    parser.add_argument("--currency", default="USD", help="Currency: USD, BRL, EUR")
    parser.add_argument("--referral", default="sniffershop.com", help="Referral URL")
    parser.add_argument("--level", default=None, help="User level: puppy, sniffer, hunter, master, legend")
    parser.add_argument("--output", default="/tmp/sniffer_receipt.png", help="Output path")
    args = parser.parse_args()

    img = generate_card(args.product, args.price, args.avg, args.currency, args.referral, args.level)
    img.save(args.output, "PNG", optimize=True)
    print(f"Card saved: {args.output}")
