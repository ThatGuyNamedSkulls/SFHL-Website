import { RankTier, RankTierLetter } from "@/types";

/**
 * 10 real SFHL rank tiers from counterstrike.toml, plus Unranked.
 * Ordered low → high.
 */
export const RANK_TIERS: RankTier[] = [
  {
    letter: "UNRANKED",
    name: "Unranked",
    dbName: "[?] Unranked",
    minElo: 0,
    maxElo: 0,
    color: "#555555",
    glowClass: "rank-glow-unranked",
  },
  {
    letter: "D",
    name: "D",
    dbName: "[D | 1-799]",
    minElo: 1,
    maxElo: 799,
    color: "#83888D",
    glowClass: "rank-glow-d",
  },
  {
    letter: "C",
    name: "C",
    dbName: "[C | 800-949]",
    minElo: 800,
    maxElo: 949,
    color: "#6B8A47",
    glowClass: "rank-glow-c",
  },
  {
    letter: "B",
    name: "B",
    dbName: "[B | 950-1099]",
    minElo: 950,
    maxElo: 1099,
    color: "#18A39F",
    glowClass: "rank-glow-b",
  },
  {
    letter: "A1",
    name: "A1",
    dbName: "[A1 | 1100-1249]",
    minElo: 1100,
    maxElo: 1249,
    color: "#3AB587",
    glowClass: "rank-glow-a1",
  },
  {
    letter: "A2",
    name: "A2",
    dbName: "[A2 | 1250-1449]",
    minElo: 1250,
    maxElo: 1449,
    color: "#4A90D9",
    glowClass: "rank-glow-a2",
  },
  {
    letter: "A3",
    name: "A3",
    dbName: "[A3 | 1450-1649]",
    minElo: 1450,
    maxElo: 1649,
    color: "#9B59B6",
    glowClass: "rank-glow-a3",
  },
  {
    letter: "S1",
    name: "S1",
    dbName: "[S1 | 1650-1899]",
    minElo: 1650,
    maxElo: 1899,
    color: "#B0533C",
    glowClass: "rank-glow-s1",
  },
  {
    letter: "S2",
    name: "S2",
    dbName: "[S2 | 1900-2199]",
    minElo: 1900,
    maxElo: 2199,
    color: "#E67E22",
    glowClass: "rank-glow-s2",
  },
  {
    letter: "S3",
    name: "S3",
    dbName: "[S3 | 2200-2499]",
    minElo: 2200,
    maxElo: 2499,
    color: "#FFB753",
    glowClass: "rank-glow-s3",
  },
  {
    letter: "STAR",
    name: "★",
    dbName: "[★ | 2500+]",
    minElo: 2500,
    maxElo: 9999,
    color: "#FFD700",
    glowClass: "rank-glow-star",
  },
];

/** Get rank tier for a given ELO */
export function getRankForElo(elo: number): RankTier {
  if (elo === 0) return RANK_TIERS[0]; // Unranked
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (elo >= RANK_TIERS[i].minElo) return RANK_TIERS[i];
  }
  return RANK_TIERS[0];
}

/** Get rank tier by its letter code */
export function getRankByLetter(letter: RankTierLetter): RankTier {
  return RANK_TIERS.find((r) => r.letter === letter) ?? RANK_TIERS[0];
}

/** Get rank tier by its DB name (e.g. "[D | 1-799]") */
export function getRankByDbName(dbName: string): RankTier {
  return RANK_TIERS.find((r) => r.dbName === dbName) ?? RANK_TIERS[0];
}

/** Get next rank tier (or null if already ★) */
export function getNextRank(currentLetter: RankTierLetter): RankTier | null {
  const idx = RANK_TIERS.findIndex((r) => r.letter === currentLetter);
  if (idx < RANK_TIERS.length - 1) return RANK_TIERS[idx + 1];
  return null;
}
