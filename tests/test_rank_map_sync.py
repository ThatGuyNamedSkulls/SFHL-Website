"""The website's RANK_DB_MAP must list exactly the bot's rank names.

HL website/hyperleague/lib/db.ts hardcodes the DB rank strings; if a rank is
renamed or re-banded in the game profile TOML without updating the website,
mapRank() silently maps every player to UNRANKED with no error anywhere. Both
files live in this repo, so this test pins them together.
"""

import os
import re

import pytest

from core.game_profile import ACTIVE

_WEBSITE_DB_TS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "HL website", "hyperleague", "lib", "db.ts",
)


@pytest.mark.skipif(
    not os.path.exists(_WEBSITE_DB_TS), reason="website checkout not present"
)
def test_rank_map_matches_game_profile():
    with open(_WEBSITE_DB_TS, encoding="utf-8") as f:
        src = f.read()

    m = re.search(r"RANK_DB_MAP[^{]*\{(.*?)\}", src, re.DOTALL)
    assert m, "RANK_DB_MAP not found in lib/db.ts"

    # Keys of the map: every quoted string followed by a colon.
    web_ranks = set(re.findall(r'"([^"]+)"\s*:', m.group(1)))
    bot_ranks = {ACTIVE.unranked_name} | {r.name for r in ACTIVE.ranks}

    assert web_ranks == bot_ranks, (
        "Website RANK_DB_MAP and the game profile's rank names differ.\n"
        f"Only in website: {sorted(web_ranks - bot_ranks)}\n"
        f"Only in profile: {sorted(bot_ranks - web_ranks)}\n"
        "Update lib/db.ts RANK_DB_MAP or the profile TOML so they match."
    )
