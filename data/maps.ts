import { GameMap } from "@/types";

/** Counter-Strike maps — from counterstrike.toml game profile */
export const MAPS: GameMap[] = [
  { id: "inferno", name: "Inferno" },
  { id: "dust2", name: "Dust II" },
  { id: "overpass", name: "Overpass" },
  { id: "mirage", name: "Mirage" },
  { id: "vertigo", name: "Vertigo" },
  { id: "cache", name: "Cache" },
  { id: "nuke", name: "Nuke" },
];

export const MAP_NAMES = MAPS.map((m) => m.name);
