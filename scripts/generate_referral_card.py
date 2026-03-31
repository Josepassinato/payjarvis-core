#!/usr/bin/env python3
"""
Referral Invite Card Generator — 1080x1080 (EN + PT)
Generates personalized invite cards with [NAME] placeholder replaced dynamically.
Also callable as module: generate_card(name, lang) → bytes
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math, random, os, sys

W, H = 1080, 1080
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "banners")

FONT_BOLD = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
FONT_SEMI = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
FONT_REG  = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
FONT_DISP = "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf"

def font(path, size):
    return ImageFont.truetype(path, size)

def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(len(c1)))

def draw_gradient(draw, bbox, c1, c2, vertical=True):
    x0, y0, x1, y1 = bbox
    steps = y1 - y0 if vertical else x1 - x0
    for i in range(max(1, steps)):
        t = i / max(1, steps - 1)
        c = lerp_color(c1, c2, t)
        if vertical:
            draw.line([(x0, y0 + i), (x1, y0 + i)], fill=c)
        else:
            draw.line([(x0 + i, y0), (x0 + i, y1)], fill=c)

def draw_radial_glow(img, cx, cy, radius, color, alpha=80):
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for r in range(radius, 0, -3):
        a = int(alpha * (r / radius) ** 0.5)
        od.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*color, a))
    return Image.alpha_composite(img, overlay)

def draw_sparkles(img, n=30, color=(255, 255, 255)):
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for _ in range(n):
        x, y = random.randint(30, W - 30), random.randint(30, H - 30)
        size = random.randint(1, 4)
        a = random.randint(80, 180)
        od.ellipse([x - size, y - size, x + size, y + size], fill=(*color, a))
        if random.random() > 0.5:
            l = size * 3
            od.line([(x - l, y), (x + l, y)], fill=(*color, a // 3), width=1)
            od.line([(x, y - l), (x, y + l)], fill=(*color, a // 3), width=1)
    return Image.alpha_composite(img, overlay)

def draw_circles_pattern(img, color, n=15):
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for _ in range(n):
        x, y = random.randint(-80, W + 80), random.randint(-80, H + 80)
        r = random.randint(40, 200)
        a = random.randint(8, 20)
        od.ellipse([x - r, y - r, x + r, y + r], outline=(*color, a), width=2)
    return Image.alpha_composite(img, overlay)

def draw_confetti(img, n=35):
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    colors = [(255, 100, 150), (100, 200, 255), (255, 220, 50),
              (150, 255, 150), (255, 150, 50), (200, 100, 255)]
    for _ in range(n):
        x, y = random.randint(20, W - 20), random.randint(20, H - 20)
        w, h = random.randint(4, 12), random.randint(10, 28)
        a = random.randint(120, 200)
        od.rectangle([x, y, x + w, y + h], fill=(*random.choice(colors), a))
    return Image.alpha_composite(img, overlay)

def text_cx(draw, text, fnt):
    bb = draw.textbbox((0, 0), text, font=fnt)
    return (W - (bb[2] - bb[0])) // 2

def draw_glow_text(img, x, y, text, fnt, glow_color, text_color=(255, 255, 255)):
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.text((x, y), text, font=fnt, fill=(*glow_color, 80))
    glow = glow.filter(ImageFilter.GaussianBlur(12))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)
    draw.text((x, y), text, font=fnt, fill=text_color)
    return img, draw

def wrap_text(draw, text, fnt, max_width):
    """Word-wrap text to fit within max_width."""
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        bb = draw.textbbox((0, 0), test, font=fnt)
        if bb[2] - bb[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


# ─── Card content by language ───
CONTENT = {
    "en": {
        "badge": "You're Invited!",
        "headline": "Your friend {name}\nis giving you a smart\nshopping agent \u2014 for FREE!",
        "subtitle": "Finds the best price, monitors deals\nand buys for you",
        "icons": "SHOP  .  DEALS  .  COMPARE  .  TRACK  .  VOICE  .  SAVE",
        "cta": "Tap the link below to get started",
        "trust": "Zero-Knowledge Encryption",
        "domain": "payjarvis.com",
        "filename": "referral_invite_en.png",
    },
    "pt": {
        "badge": "Voce foi Convidado!",
        "headline": "Seu amigo {name}\nesta te dando um agente\nde compras inteligente \u2014 DE GRACA!",
        "subtitle": "Acha o melhor preco, monitora\npromocoes e compra pra voce",
        "icons": "COMPRAS  .  OFERTAS  .  COMPARA  .  RASTREIA  .  VOZ  .  ECONOMIA",
        "cta": "Toque no link abaixo para comecar",
        "trust": "Criptografia Zero-Knowledge",
        "domain": "payjarvis.com",
        "filename": "referral_invite_pt.png",
    },
}

# Colors — same family as onboarding banners (purple/violet)
BG1 = (75, 20, 120)
BG2 = (25, 5, 55)
ACCENT = (180, 120, 255)
GLOW = (150, 60, 255)
BADGE_BG = (130, 60, 200)
CTA_BG = (140, 60, 220)


def generate_card(name="[NAME]", lang="en"):
    """Generate a referral invite card. Returns PIL Image."""
    random.seed(42)  # deterministic sparkles
    c = CONTENT[lang]

    # Background
    img = Image.new("RGBA", (W, H), BG2)
    draw = ImageDraw.Draw(img)
    draw_gradient(draw, (0, 0, W, H), BG1, BG2)

    # Glow + pattern
    img = draw_radial_glow(img, W // 2, 300, 500, GLOW, alpha=50)
    img = draw_circles_pattern(img, ACCENT)
    img = draw_confetti(img, n=25)
    img = draw_sparkles(img, n=25, color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    y = 60

    # ─── JARVIS logo text ───
    fnt_logo = font(FONT_DISP, 48)
    logo_text = "JARVIS"
    lx = text_cx(draw, logo_text, fnt_logo)
    draw.text((lx, y), logo_text, font=fnt_logo, fill=(255, 255, 255))
    y += 70

    # ─── Badge pill ───
    fnt_badge = font(FONT_SEMI, 32)
    badge_text = c["badge"]
    bb = draw.textbbox((0, 0), badge_text, font=fnt_badge)
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    pad_x, pad_y = 30, 12
    pill_x = (W - bw - pad_x * 2) // 2
    draw.rounded_rectangle(
        [pill_x, y, pill_x + bw + pad_x * 2, y + bh + pad_y * 2],
        radius=24, fill=(*BADGE_BG, 220)
    )
    draw.text((pill_x + pad_x, y + pad_y), badge_text, font=fnt_badge, fill=(255, 255, 255))
    y += bh + pad_y * 2 + 50

    # ─── Headline ───
    fnt_head = font(FONT_BOLD, 52)
    headline = c["headline"].replace("{name}", name)
    for line in headline.split("\n"):
        lx = text_cx(draw, line, fnt_head)
        img, draw = draw_glow_text(img, lx, y, line, fnt_head, GLOW)
        y += 64
    y += 30

    # ─── Subtitle ───
    fnt_sub = font(FONT_REG, 30)
    for line in c["subtitle"].split("\n"):
        lx = text_cx(draw, line, fnt_sub)
        draw.text((lx, y), line, font=fnt_sub, fill=(200, 200, 220))
        y += 40
    y += 30

    # ─── Icons row ───
    fnt_icons = font(FONT_SEMI, 22)
    icons_text = c["icons"]
    ix = text_cx(draw, icons_text, fnt_icons)
    draw.text((ix, y), icons_text, font=fnt_icons, fill=ACCENT)
    y += 50

    # ─── CTA pill ───
    fnt_cta = font(FONT_SEMI, 30)
    cta_text = c["cta"]
    bb = draw.textbbox((0, 0), cta_text, font=fnt_cta)
    cw, ch = bb[2] - bb[0], bb[3] - bb[1]
    pad_x, pad_y = 40, 16
    pill_x = (W - cw - pad_x * 2) // 2
    draw.rounded_rectangle(
        [pill_x, y, pill_x + cw + pad_x * 2, y + ch + pad_y * 2],
        radius=28, fill=(*CTA_BG, 240)
    )
    draw.text((pill_x + pad_x, y + pad_y), cta_text, font=fnt_cta, fill=(255, 255, 255))
    y += ch + pad_y * 2 + 40

    # ─── Trust badge with lock icon ───
    fnt_trust = font(FONT_REG, 24)
    trust_line = c["trust"]
    # Draw a small lock shape
    bb_t = draw.textbbox((0, 0), trust_line, font=fnt_trust)
    tw = bb_t[2] - bb_t[0]
    total_w = 20 + 8 + tw  # lock_w + gap + text
    start_x = (W - total_w) // 2
    # Lock body
    lx, ly = start_x, y + 4
    draw.rounded_rectangle([lx, ly + 8, lx + 16, ly + 22], radius=3, fill=(160, 160, 180))
    # Lock shackle (arc)
    draw.arc([lx + 2, ly, lx + 14, ly + 14], start=180, end=0, fill=(160, 160, 180), width=2)
    # Text
    draw.text((start_x + 24, y), trust_line, font=fnt_trust, fill=(160, 160, 180))
    y += 40

    # ─── Domain ───
    fnt_domain = font(FONT_SEMI, 28)
    dx = text_cx(draw, c["domain"], fnt_domain)
    draw.text((dx, y), c["domain"], font=fnt_domain, fill=(200, 200, 220))

    return img


def generate_card_bytes(name="[NAME]", lang="en", fmt="PNG"):
    """Generate card and return as bytes (for sending via API)."""
    import io
    img = generate_card(name, lang)
    buf = io.BytesIO()
    img.save(buf, format=fmt, optimize=True)
    buf.seek(0)
    return buf.read()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate referral invite card")
    parser.add_argument("--name", default="[NAME]", help="Inviter name")
    parser.add_argument("--lang", default="en", choices=["en", "pt"], help="Language")
    parser.add_argument("--output", default=None, help="Output file path (if omitted, generates all defaults)")
    args = parser.parse_args()

    if args.output:
        # Single card generation (called by bot)
        img = generate_card(args.name, args.lang)
        img.save(args.output, "PNG", optimize=True)
        print(args.output)
    else:
        # Batch: generate placeholder + example versions
        os.makedirs(OUT, exist_ok=True)
        for lang in ("en", "pt"):
            c = CONTENT[lang]
            img = generate_card("[NAME]", lang)
            path = os.path.join(OUT, c["filename"])
            img.save(path, "PNG", optimize=True)
            print(f"Saved {path} ({os.path.getsize(path) // 1024}KB)")

        for lang, name in [("en", "Jose"), ("pt", "Jose")]:
            img = generate_card(name, lang)
            path = os.path.join(OUT, f"referral_invite_{lang}_example.png")
            img.save(path, "PNG", optimize=True)
            print(f"Saved {path} ({os.path.getsize(path) // 1024}KB)")
