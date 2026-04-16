"use client";

/**
 * PIXEL REALM ONLINE — Minimap
 *
 * Canvas-based minimap in the bottom-right corner.
 * Shows terrain tiles, all entities, and highlights the local player.
 */

import { useEffect, useRef } from "react";
import type { Entity, TileMap } from "../types";

interface MinimapProps {
  tilemap: TileMap | null;
  entities: Entity[];
  localPlayerId: string | null;
}

const MAP_SIZE = 110; // px — the rendered square size
const BORDER = 2;

// Tile colors — dark muted tones for minimap aesthetic
const TILE_COLORS: Record<string, string> = {
  grass:  "#2a4a1e",
  dirt:   "#4a3820",
  path:   "#5a4e38",
  stone:  "#2e2e3a",
  water:  "#1a2e4a",
  wall:   "#111118",
};

// Entity dot colors
const ENTITY_COLORS: Record<string, string> = {
  player:  "#ffffff",
  agent:   "#4ecdc4",
  monster: "#ff5555",
  npc:     "#ffdd44",
};

export function Minimap({ tilemap, entities, localPlayerId }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tilemap) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = tilemap.width;
    const H = tilemap.height;
    const cellW = MAP_SIZE / W;
    const cellH = MAP_SIZE / H;

    // Clear
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Draw tiles
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const tile = tilemap.tiles[y]?.[x] ?? "grass";
        ctx.fillStyle = TILE_COLORS[tile] ?? TILE_COLORS.grass;
        ctx.fillRect(
          Math.floor(x * cellW),
          Math.floor(y * cellH),
          Math.ceil(cellW),
          Math.ceil(cellH)
        );
      }
    }

    // Draw entities (monsters + agents first, then players on top)
    const tileSize = 32; // pixels per tile in world space
    const worldW = W * tileSize;
    const worldH = H * tileSize;

    const sorted = [...entities].sort((a, b) => {
      // draw local player last (on top)
      if (a.id === localPlayerId) return 1;
      if (b.id === localPlayerId) return -1;
      return 0;
    });

    for (const entity of sorted) {
      const mx = (entity.position.x / worldW) * MAP_SIZE;
      const my = (entity.position.y / worldH) * MAP_SIZE;
      const isLocal = entity.id === localPlayerId;
      const color = isLocal ? "#ffffff" : ENTITY_COLORS[entity.type] ?? "#888888";
      const radius = isLocal ? 3.5 : entity.type === "monster" ? 2 : 2.5;

      // Outer glow for local player
      if (isLocal) {
        ctx.beginPath();
        ctx.arc(mx, my, radius + 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fill();
      }

      // Dot
      ctx.beginPath();
      ctx.arc(mx, my, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // View border
    ctx.strokeStyle = "rgba(212,160,23,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, MAP_SIZE - 1, MAP_SIZE - 1);

  }, [tilemap, entities, localPlayerId]);

  if (!tilemap) return null;

  return (
    <div style={styles.wrapper}>
      {/* Label */}
      <div style={styles.label}>MAP</div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={MAP_SIZE}
        height={MAP_SIZE}
        style={styles.canvas}
      />

      {/* Legend */}
      <div style={styles.legend}>
        <LegendDot color="#ffffff" label="You" />
        <LegendDot color="#4ecdc4" label="Ally" />
        <LegendDot color="#ff5555" label="Mob" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={styles.legendItem}>
      <div style={{ ...styles.legendDot, background: color }} />
      <span style={styles.legendText}>{label}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "absolute",
    bottom: 160,
    right: 8,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    pointerEvents: "none",
  },

  label: {
    color: "#d4a017",
    fontSize: 8,
    fontFamily: "monospace",
    fontWeight: "bold",
    letterSpacing: 2,
    textShadow: "0 0 6px #d4a01760",
  },

  canvas: {
    display: "block",
    borderRadius: 3,
    border: "1px solid rgba(212,160,23,0.4)",
    boxShadow: "0 0 10px rgba(0,0,0,0.8), inset 0 0 6px rgba(0,0,0,0.5)",
    imageRendering: "pixelated",
  },

  legend: {
    display: "flex",
    gap: 6,
    alignItems: "center",
  },

  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 3,
  },

  legendDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
  },

  legendText: {
    color: "#888888",
    fontSize: 7,
    fontFamily: "monospace",
  },
};
