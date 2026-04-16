/**
 * PIXEL REALM ONLINE — Zone Definitions
 *
 * Four explorable zones, each with:
 *  - Unique tilemap generation parameters
 *  - Zone-specific monster pool
 *  - Portal positions linking zones together
 *  - Distinct visual theme
 */

import type { TileType, WorldPosition } from "./types";

// ── Zone IDs ─────────────────────────────────────────────────────────────────

export type ZoneKey = "greenfields" | "forest" | "dungeon" | "town";

// ── Zone config ───────────────────────────────────────────────────────────────

export interface ZoneDefinition {
  id:          ZoneKey;
  name:        string;
  subtitle:    string;
  icon:        string;
  bgColor:     string;        // CSS color for loading screen
  ambientColor:string;        // HUD zone badge color
  monsterPool: string[];      // monster kinds that spawn here
  monsterCount:number;
  difficulty:  "easy" | "medium" | "hard" | "safe";
  portals:     PortalDefinition[];
  /** tilemap generation seed modifiers */
  tileWeights: Partial<Record<TileType, number>>;
}

export interface PortalDefinition {
  id:        string;
  targetZone:ZoneKey;
  /** Tile coords of the portal on this zone's map */
  tileX:     number;
  tileY:     number;
  label:     string;
  icon:      string;
}

// ── Zone registry ─────────────────────────────────────────────────────────────

export const ZONES: Record<ZoneKey, ZoneDefinition> = {

  greenfields: {
    id:          "greenfields",
    name:        "Greenfields",
    subtitle:    "A peaceful meadow — but danger lurks",
    icon:        "🌿",
    bgColor:     "#0d2b1a",
    ambientColor:"#4ade80",
    monsterPool: ["slime", "goblin"],
    monsterCount:14,
    difficulty:  "easy",
    tileWeights: { grass: 3, dirt: 1, path: 1, stone: 0.3, water: 0.4 },
    portals: [
      { id: "gf_to_forest", targetZone: "forest",  tileX: 48, tileY: 25, label: "Dark Forest →", icon: "🌲" },
      { id: "gf_to_town",   targetZone: "town",    tileX: 25, tileY: 2,  label: "↑ Market Town",  icon: "🏪" },
    ],
  },

  forest: {
    id:          "forest",
    name:        "Dark Forest",
    subtitle:    "Ancient trees hide ancient horrors",
    icon:        "🌲",
    bgColor:     "#0a1a0a",
    ambientColor:"#22c55e",
    monsterPool: ["wolf", "goblin", "skeleton"],
    monsterCount:16,
    difficulty:  "medium",
    tileWeights: { grass: 2, dirt: 0.5, path: 0.5, stone: 0.8, water: 0.2 },
    portals: [
      { id: "forest_to_gf",      targetZone: "greenfields", tileX: 2,  tileY: 25, label: "← Greenfields",  icon: "🌿" },
      { id: "forest_to_dungeon", targetZone: "dungeon",     tileX: 25, tileY: 48, label: "↓ Dungeon",       icon: "⛏" },
    ],
  },

  dungeon: {
    id:          "dungeon",
    name:        "Stone Dungeon",
    subtitle:    "Ancient crypts — skeletons walk again",
    icon:        "⛏",
    bgColor:     "#111118",
    ambientColor:"#a78bfa",
    monsterPool: ["skeleton", "wolf"],
    monsterCount:18,
    difficulty:  "hard",
    tileWeights: { grass: 0, dirt: 0.3, path: 1.5, stone: 3, water: 0.1 },
    portals: [
      { id: "dungeon_to_forest", targetZone: "forest",      tileX: 25, tileY: 2,  label: "↑ Dark Forest",  icon: "🌲" },
      { id: "dungeon_to_town",   targetZone: "town",        tileX: 48, tileY: 25, label: "Town Exit →",    icon: "🏪" },
    ],
  },

  town: {
    id:          "town",
    name:        "Market Town",
    subtitle:    "A hub of traders and adventurers",
    icon:        "🏪",
    bgColor:     "#1a1208",
    ambientColor:"#fbbf24",
    monsterPool: ["slime"],    // mostly safe — only slimes wander in
    monsterCount:4,
    difficulty:  "safe",
    tileWeights: { grass: 0.5, dirt: 2, path: 3, stone: 1.5, water: 0.1 },
    portals: [
      { id: "town_to_gf",      targetZone: "greenfields", tileX: 25, tileY: 48, label: "↓ Greenfields",  icon: "🌿" },
      { id: "town_to_dungeon", targetZone: "dungeon",     tileX: 2,  tileY: 25, label: "← Dungeon Path", icon: "⛏" },
    ],
  },
};

export const ZONE_LIST = Object.values(ZONES);

// ── Portal proximity threshold (pixels) ──────────────────────────────────────

export const PORTAL_TRIGGER_RADIUS = 52;  // how close player must be to prompt

// ── Tilemap generator ─────────────────────────────────────────────────────────
// Generates a deterministic-ish tilemap for each zone using its tileWeights.

export interface ZoneTilemap {
  zoneId:    ZoneKey;
  width:     number;
  height:    number;
  tileSize:  number;
  tiles:     TileType[][];
  portals:   Array<PortalDefinition & { worldX: number; worldY: number }>;
}

export function generateZoneTilemap(zone: ZoneDefinition, tileSize = 32, w = 50, h = 50): ZoneTilemap {
  const tiles: TileType[][] = [];

  // Build a weighted random tile selector from the zone's weights
  const pool: TileType[] = [];
  const entries = Object.entries(zone.tileWeights) as Array<[TileType, number]>;
  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
  for (const [tile, weight] of entries) {
    const count = Math.round((weight / totalWeight) * 100);
    for (let i = 0; i < count; i++) pool.push(tile);
  }
  if (pool.length === 0) pool.push("grass");

  for (let y = 0; y < h; y++) {
    tiles[y] = [];
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        tiles[y][x] = "wall";
        continue;
      }
      // Noise-based tile selection
      const n = Math.sin(x * 0.37 + zone.id.charCodeAt(0) * 0.1) *
                Math.cos(y * 0.29 + zone.id.charCodeAt(1) * 0.1);
      const idx = Math.abs(Math.round(n * pool.length * 3)) % pool.length;
      tiles[y][x] = pool[idx];
    }
  }

  // Carve cross-paths for navigability
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  for (let i = 1; i < w - 1; i++) tiles[cy][i] = "path";
  for (let i = 1; i < h - 1; i++) tiles[i][cx] = "path";

  // Place portal tiles (make walkable)
  const enrichedPortals = zone.portals.map(p => {
    const wx = p.tileX * tileSize + tileSize / 2;
    const wy = p.tileY * tileSize + tileSize / 2;
    // Make a 3×3 path patch around portal
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = p.tileX + dx, ty = p.tileY + dy;
        if (tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1) tiles[ty][tx] = "path";
      }
    }
    return { ...p, worldX: wx, worldY: wy };
  });

  return { zoneId: zone.id, width: w, height: h, tileSize, tiles, portals: enrichedPortals };
}

// ── Prebuilt tilemaps (generated once) ───────────────────────────────────────

export const ZONE_TILEMAPS: Record<ZoneKey, ZoneTilemap> = {
  greenfields: generateZoneTilemap(ZONES.greenfields),
  forest:      generateZoneTilemap(ZONES.forest),
  dungeon:     generateZoneTilemap(ZONES.dungeon),
  town:        generateZoneTilemap(ZONES.town),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getZone(id: string): ZoneDefinition | undefined {
  return ZONES[id as ZoneKey];
}

export function getNearbyPortal(
  position: WorldPosition,
  zoneId: ZoneKey,
  tileSize = 32
): (PortalDefinition & { worldX: number; worldY: number }) | null {
  const tilemap = ZONE_TILEMAPS[zoneId];
  if (!tilemap) return null;
  for (const portal of tilemap.portals) {
    const dx = position.x - portal.worldX;
    const dy = position.y - portal.worldY;
    if (Math.sqrt(dx * dx + dy * dy) < PORTAL_TRIGGER_RADIUS) {
      return portal;
    }
  }
  return null;
}
