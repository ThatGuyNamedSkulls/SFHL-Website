import google.generativeai as genai
from PIL import Image
import os
import json
from dotenv import load_dotenv

# Load secrets from .env (gitignored). Never hardcode keys in source.
load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key."
    )

genai.configure(api_key=API_KEY)

# model
model = genai.GenerativeModel('gemini-2.5-flash')


DEFAULT_PROMPT = """You are an AI assistant specialized in data extraction from video game scoreboards.

Analyze the provided image of a Counter-Strike match scoreboard and extract the
statistics for every player.

Output ONLY a single JSON object — no markdown fences, no commentary.

Per-player keys — each is an ARRAY with one entry per player, all the same
length and in the SAME player order:

- "player_names": array of strings (the player names, in case the is name (@playername), only worry about the "playername" part)
- "match_results": array of "W" or "L" (the winning team — 15 rounds — gets "W"; the losing team gets "L")
- "match_points": array of integers (the "Score" column)
- "kills":  array of integers (the "K" column)
- "deaths": array of integers (the "D" column)
- "assists": array of integers (the "A" column)
- "mvps":   array of integers (the "MVP" column)
- "scores": array of integers (same values and order as match_points)
- "hs":     array of numbers (the "HS%" column WITHOUT the % sign, e.g. "83.4%" -> 83.4)

Match-level keys — each is a SINGLE value (NOT an array), describing the match:

- "map_name":  string (the name of the map)
- "region":    string (the region of the server)
- "play_time": string (the match duration in MM:SS format)

Player order: top team (Counter-Terrorists) first, top to bottom; then the
bottom team (Terrorists), top to bottom.

Example output (values are illustrative only):
{"player_names":["zeflexive","Viqc","guilhermessjk"],"match_results":["W","W","L"],"match_points":[65,61,38],"kills":[31,26,17],"deaths":[13,10,11],"assists":[3,1,0],"mvps":[5,7,5],"scores":[65,61,38],"hs":[93.6,84.7,88.3],"map_name":"de_mirage","region":"EU-West-2","play_time":"25:21"}

In case theres a type of value missing, dont write that type of value. If a player is missing a value, write NONE on the place of that value.
"""
def ocr_image_to_json(image_path: str, prompt_override: str = None) -> dict:
    """Process an image using the Gemini model and return parsed JSON (as dict).

    image_path: local path to the scoreboard image
    prompt_override: optional prompt string to override the default

    Returns: dict parsed from model response. Raises Exception on failure.
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found: {image_path}")

    img = Image.open(image_path)

    prompt_text = prompt_override if prompt_override is not None else DEFAULT_PROMPT

    # Prepare parts - keep the same format used previously
    prompt_parts = [prompt_text, img]

    response = model.generate_content(prompt_parts)

    json_output = response.text.strip().replace("```json", "").replace("```", "")

    # Try to parse the JSON. The model may output surrounding text, so find the first { and last }
    try:
        start = json_output.find('{')
        end = json_output.rfind('}')
        if start != -1 and end != -1:
            candidate = json_output[start:end+1]
        else:
            candidate = json_output

        parsed = json.loads(candidate)
        return parsed
    except Exception as e:
        # If parsing fails, raise a helpful error containing the raw output
        raise ValueError(f"{json_output}")


if __name__ == '__main__':
    # Preserve original one-shot behavior for quick debugging
    NOME_ARQUIVO_IMAGEM = "scoreboard.png"
    try:
        parsed = ocr_image_to_json(NOME_ARQUIVO_IMAGEM)
        print("\n--- Resposta da API (JSON) ---")
        print(json.dumps(parsed, indent=4, ensure_ascii=False))
    except Exception as e:
        print(f"{e}")