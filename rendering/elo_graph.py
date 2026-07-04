"""Neon Elo-trend graph (matplotlib), rendered off the event loop.

matplotlib's pyplot uses global state and isn't thread-safe, so a lock serializes
renders while ``render_elo_graph`` offloads the work via asyncio.to_thread.
"""

import asyncio
import threading

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, Normalize  # noqa: E402
import matplotlib.patheffects as pe  # noqa: E402

from core import db  # noqa: E402

_elo_graph_lock = threading.Lock()


async def render_elo_graph(player_name: str, output_path: str = "elo_graph.png") -> bool:
    """Fetch the player's Elo history (async DB) then render off the event loop.

    The DB read happens here in the event loop because the libsql client is async;
    only the matplotlib rendering (pure CPU) is offloaded to a worker thread.
    """
    elo_changes = [
        row[0] for row in await db.fetchall(
            "SELECT elo_change FROM match_history WHERE player_name = ? "
            "ORDER BY timestamp DESC LIMIT 15",
            (player_name,),
        )
    ]
    current_elo_row = await db.fetchone(
        "SELECT elo FROM players WHERE name = ?", (player_name,)
    )
    if not current_elo_row:
        return False
    current_elo = current_elo_row[0]

    def _locked():
        with _elo_graph_lock:
            return generate_elo_graph(elo_changes, current_elo, output_path)
    return await asyncio.to_thread(_locked)


def generate_elo_graph(elo_changes, current_elo, output_path: str = "elo_graph.png") -> bool:
    """Render an Elo-trend graph from pre-fetched data. False if not enough data."""
    if len(elo_changes) < 2:
        return False

    elo_history = [current_elo]
    temp_elo = current_elo
    for change in elo_changes:
        temp_elo -= change
        elo_history.append(temp_elo)

    elo = np.array(elo_history[::-1])
    x = np.arange(len(elo))

    upsample_per_segment = 12
    x_dense_list, y_dense_list = [], []
    for i in range(len(x) - 1):
        xs = np.linspace(x[i], x[i + 1], upsample_per_segment + 1)
        ys = np.linspace(elo[i], elo[i + 1], upsample_per_segment + 1)
        if i < len(x) - 2:
            xs, ys = xs[:-1], ys[:-1]
        x_dense_list.append(xs)
        y_dense_list.append(ys)

    if not x_dense_list:
        return False

    x_dense = np.concatenate(x_dense_list)
    y_dense = np.concatenate(y_dense_list)

    points = np.array([x_dense, y_dense]).T.reshape(-1, 1, 2)
    segments = np.concatenate([points[:-1], points[1:]], axis=1)

    slope_dense = np.diff(y_dense)
    max_s = np.max(np.abs(slope_dense)) if slope_dense.size > 0 else 1.0
    slope_norm = slope_dense / max_s if max_s != 0 else slope_dense

    window = 15
    kernel = np.ones(window) / window
    color_array = np.convolve(slope_norm, kernel, mode="same")
    max_abs = np.max(np.abs(color_array)) if color_array.size > 0 else 1.0
    if max_abs != 0:
        color_array = color_array / max_abs

    cmap = LinearSegmentedColormap.from_list(
        "elo_slope", [(0.0, "#ff3333"), (0.5, "#ffff66"), (1.0, "#33ff33")]
    )
    norm = Normalize(vmin=-1, vmax=1)

    fig, ax = plt.subplots(figsize=(10, 2.1))
    ax.set_facecolor("#0E1114")
    ax.set_xlim(x.min() - 0.6, x.max() + 0.3)
    ax.set_ylim(elo.min() - 20, elo.max() + 20)
    ax.axis("off")

    for glow_width, alpha in [(8, 0.05), (5, 0.1), (3, 0.2), (2, 0.3)]:
        lc_glow = LineCollection(segments, cmap=cmap, norm=norm)
        lc_glow.set_array(color_array)
        lc_glow.set_linewidth(glow_width)
        lc_glow.set_alpha(alpha)
        try:
            lc_glow.set_joinstyle("round")
            lc_glow.set_capstyle("round")
        except Exception:
            pass
        lc_glow.set_antialiaseds(True)
        ax.add_collection(lc_glow)

    lc = LineCollection(segments, cmap=cmap, norm=norm)
    lc.set_array(color_array)
    lc.set_linewidth(2)
    try:
        lc.set_joinstyle("round")
        lc.set_capstyle("round")
    except Exception:
        pass
    lc.set_antialiaseds(True)
    ax.add_collection(lc)

    x_seg = (x_dense[:-1] + x_dense[1:]) / 2.0
    x_seg_ext = np.concatenate(([x_dense[0]], x_seg, [x_dense[-1]]))
    color_ext = np.concatenate(([color_array[0]], color_array, [color_array[-1]]))
    marker_vals = np.interp(x, x_seg_ext, color_ext)
    sm = plt.cm.ScalarMappable(norm=norm, cmap=cmap)
    marker_rgba = sm.to_rgba(marker_vals)
    for size, a in [(220, 0.06), (120, 0.05)]:
        ax.scatter(x, elo, s=size, color=marker_rgba, alpha=a, linewidths=0, zorder=2)
    ax.scatter(x, elo, s=20, c=marker_rgba, linewidths=0.8, zorder=4)

    font_config = {"color": "white", "fontsize": 10, "fontweight": "bold"}
    min_elo_idx = np.argmin(elo)
    max_elo_idx = np.argmax(elo)
    ax.text(
        x[min_elo_idx], elo.min() + 8, f"min: {int(elo.min())}", **font_config,
        ha="center", va="bottom", path_effects=[pe.withStroke(linewidth=3, foreground="black")],
    )
    ax.text(
        x[max_elo_idx], elo.max() + 8, f"max: {int(elo.max())}", **font_config,
        ha="center", va="bottom", path_effects=[pe.withStroke(linewidth=3, foreground="black")],
    )

    plt.savefig(output_path, transparent=True, bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    return True
