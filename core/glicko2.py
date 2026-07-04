"""Glicko-2 rating system (Mark Glickman's algorithm).

A player has a rating, a rating deviation (RD, uncertainty) and a volatility.
Beating a confident strong opponent moves you more; your RD shrinks as you play
and widens during inactivity (decay). This is the principled upgrade over Elo for
a small, intermittently-active league.

Implementation follows "Example of the Glicko-2 system" (Glickman, 2013). The
public rating is on the same scale as the bot's existing Elo (1500-anchored), so
the rank bands in core.ranks still apply.
"""

import math

SCALE = 173.7178          # converts between Elo scale and Glicko-2 internal scale
ANCHOR = 1500.0           # rating the internal scale is centered on
DEFAULT_RATING = 1500.0
DEFAULT_RD = 350.0
DEFAULT_VOL = 0.06
DEFAULT_TAU = 0.5         # system constant: constrains volatility change


def _g(phi):
    return 1.0 / math.sqrt(1.0 + 3.0 * phi**2 / math.pi**2)


def _expected(mu, mu_j, phi_j):
    return 1.0 / (1.0 + math.exp(-_g(phi_j) * (mu - mu_j)))


def apply_decay(rd, vol, periods):
    """Widen RD for `periods` of inactivity: φ' = sqrt(φ² + σ²·periods), capped."""
    if periods <= 0:
        return rd
    phi = rd / SCALE
    phi = math.sqrt(phi**2 + (vol**2) * periods)
    return min(SCALE * phi, DEFAULT_RD)


def update(rating, rd, vol, opponents, tau=DEFAULT_TAU):
    """Return (new_rating, new_rd, new_vol) after games vs `opponents`.

    `opponents` is a list of (opp_rating, opp_rd, score) with score in {1, 0.5, 0}.
    With no opponents, RD simply widens by one period of volatility.
    """
    mu = (rating - ANCHOR) / SCALE
    phi = rd / SCALE

    if not opponents:
        new_phi = math.sqrt(phi**2 + vol**2)
        return rating, min(SCALE * new_phi, DEFAULT_RD), vol

    v_inv = 0.0
    delta_sum = 0.0
    for opp_rating, opp_rd, score in opponents:
        mu_j = (opp_rating - ANCHOR) / SCALE
        phi_j = opp_rd / SCALE
        g = _g(phi_j)
        e = _expected(mu, mu_j, phi_j)
        v_inv += g * g * e * (1.0 - e)
        delta_sum += g * (score - e)
    v = 1.0 / v_inv
    delta = v * delta_sum

    # --- iterate to the new volatility (Illinois algorithm) ---
    a = math.log(vol**2)

    def f(x):
        ex = math.exp(x)
        num = ex * (delta**2 - phi**2 - v - ex)
        den = 2.0 * (phi**2 + v + ex) ** 2
        return num / den - (x - a) / (tau**2)

    A = a
    if delta**2 > phi**2 + v:
        B = math.log(delta**2 - phi**2 - v)
    else:
        k = 1
        while f(a - k * tau) < 0:
            k += 1
        B = a - k * tau

    fA, fB = f(A), f(B)
    while abs(B - A) > 1e-6:
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB <= 0:
            A, fA = B, fB
        else:
            fA = fA / 2.0
        B, fB = C, fC
    new_vol = math.exp(A / 2.0)

    phi_star = math.sqrt(phi**2 + new_vol**2)
    new_phi = 1.0 / math.sqrt(1.0 / (phi_star**2) + 1.0 / v)
    new_mu = mu + new_phi**2 * delta_sum

    return SCALE * new_mu + ANCHOR, SCALE * new_phi, new_vol
