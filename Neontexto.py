from PIL import Image, ImageDraw, ImageFont, ImageFilter

# --- CONFIG ---
TEXT = "Skulls"
FONT_PATH = "arialbd.ttf"        # change if needed
FONT_SIZE = 160

# Add alpha channel to your colors
TEXT_COLOR = (255, 120, 120, 255)
GLOW_COLOR = (255, 0, 0, 255)
OUTLINE_COLOR = (180, 50, 50, 255)

OUTPUT = "neon_skulls.png"

# --- CREATE TRANSPARENT BASE IMAGE ---
img = Image.new("RGBA", (700, 300), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
font = ImageFont.truetype(FONT_PATH, FONT_SIZE)

# --- GET TEXT SIZE (modern Pillow) ---
bbox = draw.textbbox((0, 0), TEXT, font=font)
w = bbox[2] - bbox[0]
h = bbox[3] - bbox[1]

# Center
x = (img.width - w) // 2
y = (img.height - h) // 2

# --- CREATE SUPER WIDE GLOW ---
glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
gdraw = ImageDraw.Draw(glow)

# Bright core glow
for _ in range(12):
    gdraw.text((x, y), TEXT, font=font, fill=GLOW_COLOR)

# Expanding blurred halo
for r in [0, 10, 20]:
    glow = glow.filter(ImageFilter.GaussianBlur(r))

# --- MERGE GLOW + BASE (alpha composite) ---
combined = Image.alpha_composite(img, glow)
cdraw = ImageDraw.Draw(combined)

# --- FINAL TEXT WITH OUTLINE ---
cdraw.text(
    (x, y),
    TEXT,
    font=font,
    fill=TEXT_COLOR,
    stroke_width=2,
    stroke_fill=OUTLINE_COLOR
)

combined.save(OUTPUT)
print(f"Saved: {OUTPUT}")