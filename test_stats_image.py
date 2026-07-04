from PIL import Image, ImageDraw, ImageFont

def generate_player_stats_image(player_name, stats):
    # Load your base template image (the one you uploaded)
    base = Image.open("template.png").convert("RGBA")

    draw = ImageDraw.Draw(base)

    # Load any font you have locally (or use default)
    try:
        font = ImageFont.truetype("arial.ttf", 24)
    except:
        font = ImageFont.load_default()

    # Draw text (positions are examples — adjust to fit your template)
    draw.text((140, 40), player_name, font=font, fill=(255, 255, 255))
    draw.text((140, 80), f"ELO: {stats['ELO']}", font=font, fill=(0, 255, 0))
    draw.text((140, 120), f"KDA: {stats['KDA']}", font=font, fill=(255, 255, 255))
    draw.text((140, 160), f"HS%: {stats['HS%']}", font=font, fill=(255, 255, 255))
    draw.text((140, 200), f"WIN%: {stats['WIN%']}", font=font, fill=(255, 255, 255))

    # Save or show image
    output_path = "output_stats.png"
    base.save(output_path)
    print(f"✅ Image saved as {output_path}")
    base.show()

# Example data
player_name = "iNahilC"
stats = {
    "ELO": 1450,
    "Play Time": "04:32",
    "KDA": "12 - 8 - 2",
    "Ratio": "1.50",
    "HS%": "48%",
    "W-L-T": "4 - 3 - 1",
    "WIN%": "57%"
}

generate_player_stats_image(player_name, stats)