"""Profile-card image builder (PIL).

``build_profile_image`` is synchronous and CPU-bound — the profile cog calls it
via ``asyncio.to_thread`` so the ~hundreds of PIL operations don't freeze the bot.
All data it needs is passed in via a dict (no DB/Discord access here).
"""

import logging
import os
from typing import Optional

from PIL import Image, ImageDraw, ImageFont, ImageFilter

from core.ranks import get_rank, get_expected_range

logger = logging.getLogger(__name__)

_FONT = "ArialBold.ttf"


def calculate_rating(actual_score, rank_min, rank_max, kills, deaths, mvps, matches_played):
    """HL rating from average recent performance vs the rank's expected score."""
    expected_score = (rank_min + rank_max) / 2
    score_diff = actual_score - expected_score
    kd_diff = kills - deaths
    mvp_avg = mvps / matches_played if matches_played > 0 else 0
    rating = 500 + (score_diff * 15) + (kd_diff * 10) + (mvp_avg * 40)
    return max(0, min(1000, int(rating)))


def get_rank_image_path(rank_name: str, folder: str = "RankPNGs") -> Optional[str]:
    """Path to a rank's PNG, sanitizing the rank name for the filename."""
    sanitized = (
        rank_name.replace("[", "").replace("]", "").replace("|", " ")
        .replace("?", "").replace("★", "Star").strip()
    )
    sanitized = " ".join(sanitized.split())
    path = os.path.join(folder, f"{sanitized}.png")
    return path if os.path.exists(path) else None


def _hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _draw_gradient_text(image, text, font, center_x, center_y, start_hex, end_hex):
    """Draw `text` centered at (center_x, center_y) filled with a horizontal gradient."""
    start_rgb, end_rgb = _hex_to_rgb(start_hex), _hex_to_rgb(end_hex)
    temp_draw = ImageDraw.Draw(Image.new("L", (1, 1)))
    left, top, right, bottom = temp_draw.textbbox((0, 0), text, font=font)
    tw, th = right - left, bottom - top
    if tw <= 0 or th <= 0:
        return
    gradient = Image.new("RGBA", (tw, th), color=0)
    gdraw = ImageDraw.Draw(gradient)
    for x in range(tw):
        r = int(start_rgb[0] + (end_rgb[0] - start_rgb[0]) * (x / tw))
        g = int(start_rgb[1] + (end_rgb[1] - start_rgb[1]) * (x / tw))
        b = int(start_rgb[2] + (end_rgb[2] - start_rgb[2]) * (x / tw))
        gdraw.line([(x, 0), (x, th)], fill=(r, g, b, 255))
    mask = Image.new("L", (tw, th), 0)
    ImageDraw.Draw(mask).text((-left, -top), text, font=font, fill=255)
    image.paste(gradient, (center_x - tw // 2, center_y - th // 2 - top), mask)


def _perf_colors(value, good_at, avg_at):
    if value >= good_at:
        return "#079aac", "#77d55c"
    if value >= avg_at:
        return "#ffda58", "#ff934e"
    return "#ff3633", "#e38047"


def _draw_neon_text(image, text, font, x, y, glow_color, text_color, outline_color):
    """Draw `text` with a blurred neon aura. Returns the (possibly new) image."""
    outer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(outer)
    for _ in range(5):
        od.text((x, y), text, font=font, fill=glow_color, anchor="ma")
    outer = outer.filter(ImageFilter.GaussianBlur(15))

    inner = Image.new("RGBA", image.size, (0, 0, 0, 0))
    idr = ImageDraw.Draw(inner)
    for _ in range(10):
        idr.text((x, y), text, font=font, fill=glow_color, anchor="ma")
    inner = inner.filter(ImageFilter.GaussianBlur(5))

    image = Image.alpha_composite(image, outer)
    image = Image.alpha_composite(image, inner)
    ImageDraw.Draw(image).text(
        (x, y), text, font=font, fill=text_color, stroke_width=1,
        stroke_fill=outline_color, anchor="ma",
    )
    return image


def build_profile_image(d: dict, output_path: str = "output_image.png") -> Optional[str]:
    """Composite the profile card from `d` and save it. Returns the path or None.

    Expected keys in `d`: name, elo, rank, peak_elo, total_kills, total_deaths,
    total_assists, total_mvps, avg_hs_percent, matches_played, matches_won,
    total_play_time, kd_ratio, win_percent, avg_score_per_game, hl_rating,
    match_history, local_avatar_path, graph_path.
    """
    try:
        image = Image.open("RedGUI.png").copy().convert("RGBA")
    except FileNotFoundError:
        logger.error("RedGUI.png template not found")
        return None

    rank = d["rank"]

    # Rank + peak-rank badges.
    for rank_name, pos in [(rank, (32, 65)), (get_rank(d["peak_elo"]), (382, 65))]:
        path = get_rank_image_path(rank_name)
        if path:
            try:
                img = Image.open(path).convert("RGBA").resize((120, 120), Image.Resampling.LANCZOS)
                image.paste(img, pos, mask=img)
            except Exception as e:
                logger.error(f"Failed to paste rank image for {rank_name}: {e}")

    draw = ImageDraw.Draw(image)

    # --- Match history table ---
    history_font = ImageFont.truetype(_FONT, size=20)
    history_color, win_color, loss_color = "rgb(255,255,255)", "rgb(127,255,127)", "rgb(255,83,83)"
    start_y, line_height = 450, 33
    columns = {"id": 33, "region": 128, "map": 249, "result": 370,
               "kda": 498, "kdr": 617, "hs": 712, "elo": 800}
    for i, match in enumerate(d["match_history"]):
        match_id, result, elo_change, map_name, region, kills, deaths, assists, hs_percentage = match
        y = start_y + i * line_height
        result_str = str(result or "N/A")
        result_color = win_color if result_str == "W" else (loss_color if result_str == "L" else history_color)
        kdr = (kills or 0) / (deaths or 1)
        if elo_change is not None:
            elo_text, elo_color = str(abs(elo_change)), (win_color if elo_change >= 0 else loss_color)
        else:
            elo_text, elo_color = "N/A", history_color
        draw.text((columns["id"], y), str(match_id or "N/A"), fill=history_color, font=history_font, anchor="ma")
        draw.text((columns["region"], y), str(region or "N/A"), fill=history_color, font=history_font, anchor="ma")
        draw.text((columns["map"], y), str(map_name or "N/A"), fill=history_color, font=history_font, anchor="ma")
        draw.text((columns["kda"], y), f"{kills or 0}/{deaths or 0}/{assists or 0}", fill=history_color, font=history_font, anchor="ma")
        draw.text((columns["result"], y), result_str, fill=result_color, font=history_font, anchor="ma")
        draw.text((columns["kdr"], y), f"{kdr:.2f}", fill=history_color, font=history_font, anchor="ma")
        draw.text((columns["hs"], y), f"{hs_percentage or 0}%", fill=history_color, font=history_font, anchor="ma")
        draw.text((columns["elo"], y), elo_text, fill=elo_color, font=history_font, anchor="ma")

    # --- Player name (dynamic font size) ---
    player_name_text = str(d["name"])
    font_size = 35
    font = ImageFont.truetype(_FONT, size=font_size)
    while font.getbbox(player_name_text)[2] > 180 and font_size > 14:
        font_size -= 1
        font = ImageFont.truetype(_FONT, size=font_size)
    draw.text((265, 252), player_name_text, fill="rgb(255,255,255)", font=font, anchor="ma")

    # --- Avatar ---
    if d.get("local_avatar_path"):
        try:
            avatar_img = Image.open(d["local_avatar_path"]).convert("RGBA").resize((120, 120))
            image.paste(avatar_img, (207, 100), mask=avatar_img)
        except Exception as e:
            logger.error(f"Failed to paste avatar image: {e}")

    # --- Elo graph ---
    if d.get("graph_path") and os.path.exists(d["graph_path"]):
        try:
            graph_img = Image.open(d["graph_path"]).convert("RGBA")
            image.paste(graph_img, (30, 720), mask=graph_img)
        except Exception as e:
            logger.error(f"Failed to paste ELO graph image: {e}")

    # --- Gradient stat texts ---
    stat_font = ImageFont.truetype(_FONT, size=32)
    win_percent = d["win_percent"]
    s, e = _perf_colors(win_percent, 60, 40)
    _draw_gradient_text(image, f"{win_percent:.2f}%", stat_font, 642, 205, s, e)

    kd_ratio = d["kd_ratio"]
    s, e = _perf_colors(kd_ratio, 1.2, 0.8)
    _draw_gradient_text(image, f"{kd_ratio:.2f}", stat_font, 920, 205, s, e)

    avg_hs = d["avg_hs_percent"]
    s, e = _perf_colors(avg_hs, 35, 20)
    _draw_gradient_text(image, f"{avg_hs:.2f}%", stat_font, 1250, 205, s, e)

    avg_score = d["avg_score_per_game"]
    expected_min, expected_max = get_expected_range(rank)
    if avg_score > expected_max:
        s, e = "#079aac", "#77d55c"
    elif avg_score >= expected_min:
        s, e = "#ffda58", "#ff934e"
    else:
        s, e = "#ff3633", "#e38047"
    _draw_gradient_text(image, f"{avg_score:.2f}", stat_font, 1530, 205, s, e)

    # --- Plain stat numbers ---
    big_font = ImageFont.truetype(_FONT, size=30)
    draw.text((860, 302), str(d["matches_played"]), fill="rgb(255,255,255)", font=big_font, anchor="la")
    if d["total_play_time"]:
        hours = d["total_play_time"] // 3600
        minutes = (d["total_play_time"] % 3600) // 60
        play_time_str = f"{hours}h {minutes}m"
    else:
        play_time_str = "0h 0m"
    draw.text((1523, 302), play_time_str, fill="rgb(255,255,255)", font=big_font, anchor="la")

    # --- Neon Elo text ---
    elo_font = ImageFont.truetype(_FONT, size=37)
    image = _draw_neon_text(
        image, str(d["elo"]), elo_font, 93, 235,
        (255, 255, 255, 255), (255, 255, 255, 255), (220, 220, 220, 150),
    )
    draw = ImageDraw.Draw(image)

    matches_lost = d["matches_played"] - d["matches_won"]
    draw.text((950, 730), str(d["hl_rating"]), fill="rgb(255,255,255)", font=ImageFont.truetype(_FONT, size=36), anchor="ma")
    draw.text((582, 302), str(d["matches_won"]), fill="rgb(255,255,255)", font=big_font, anchor="la")
    draw.text((710, 302), str(matches_lost), fill="rgb(255,255,255)", font=big_font, anchor="la")
    draw.text((1040, 302), str(d["total_kills"]), fill="rgb(255,255,255)", font=big_font, anchor="ma")
    draw.text((1240, 302), str(d["total_deaths"]), fill="rgb(255,255,255)", font=big_font, anchor="ma")
    draw.text((1386, 302), str(d["total_assists"]), fill="rgb(255,255,255)", font=big_font, anchor="ma")

    # --- Neon peak-Elo text (gold) ---
    image = _draw_neon_text(
        image, str(d["peak_elo"]), ImageFont.truetype(_FONT, size=37), 440, 235,
        (218, 198, 123, 255), (255, 245, 210, 255), (180, 150, 80, 150),
    )

    image.save(output_path)
    return output_path
