/**
 * PIXEL REALM ONLINE — ERC-1155 Token Image
 *
 * GET /api/nft/image/{id}
 *
 * Returns an SVG pixel-art card image for each token ID.
 * Served as image/svg+xml, cached for 24h.
 */

import { NextRequest, NextResponse } from "next/server";

interface ItemVisual {
  name:    string;
  emoji:   string;
  rarity:  string;
  bgColor: string;
  fgColor: string;
}

const ITEM_VISUALS: Record<number, ItemVisual> = {
  1001: { name: "Slime Core",   emoji: "💚", rarity: "Common",   bgColor: "#0d1a0d", fgColor: "#22c55e" },
  1002: { name: "Bone Sword",   emoji: "⚔️",  rarity: "Uncommon", bgColor: "#1a1a0d", fgColor: "#eab308" },
  1003: { name: "Wolf Fang",    emoji: "🐺", rarity: "Common",   bgColor: "#1a0d0d", fgColor: "#f87171" },
  1004: { name: "Beast Core",   emoji: "💎", rarity: "Rare",     bgColor: "#0d0d1a", fgColor: "#60a5fa" },
  1005: { name: "Rusty Dagger", emoji: "🗡️",  rarity: "Common",   bgColor: "#1a110d", fgColor: "#fb923c" },
  1006: { name: "Leather Cap",  emoji: "🪖", rarity: "Common",   bgColor: "#130d0d", fgColor: "#d97706" },
  1007: { name: "Bone Shield",  emoji: "🛡️",  rarity: "Uncommon", bgColor: "#0d1219", fgColor: "#94a3b8" },
  1008: { name: "Wolf Pelt",    emoji: "🐾", rarity: "Common",   bgColor: "#110d0d", fgColor: "#a78bfa" },
  1009: { name: "Dark Elixir",  emoji: "🌑", rarity: "Epic",     bgColor: "#0a0014", fgColor: "#c084fc" },
};

const RARITY_BADGE: Record<string, string> = {
  Common:   "#6b7280",
  Uncommon: "#22c55e",
  Rare:     "#3b82f6",
  Epic:     "#a855f7",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: idStr } = await params;
  const tokenId = parseInt(idStr, 10);
  const item = ITEM_VISUALS[tokenId];

  if (!item) {
    return new NextResponse("Not found", { status: 404 });
  }

  const badgeColor = RARITY_BADGE[item.rarity] ?? "#6b7280";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="${item.bgColor}"/>
      <stop offset="100%" stop-color="#0a0a14"/>
    </radialGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="400" height="400" fill="url(#bg)"/>

  <!-- Border frame -->
  <rect x="8" y="8" width="384" height="384" rx="16" fill="none"
        stroke="${item.fgColor}" stroke-width="1.5" stroke-opacity="0.4"/>
  <rect x="14" y="14" width="372" height="372" rx="12" fill="none"
        stroke="${item.fgColor}" stroke-width="0.5" stroke-opacity="0.2"/>

  <!-- Corner decorations -->
  <rect x="8"   y="8"   width="20" height="3" fill="${item.fgColor}" opacity="0.7"/>
  <rect x="8"   y="8"   width="3"  height="20" fill="${item.fgColor}" opacity="0.7"/>
  <rect x="372" y="8"   width="20" height="3" fill="${item.fgColor}" opacity="0.7"/>
  <rect x="389" y="8"   width="3"  height="20" fill="${item.fgColor}" opacity="0.7"/>
  <rect x="8"   y="389" width="20" height="3" fill="${item.fgColor}" opacity="0.7"/>
  <rect x="8"   y="372" width="3"  height="20" fill="${item.fgColor}" opacity="0.7"/>
  <rect x="372" y="389" width="20" height="3" fill="${item.fgColor}" opacity="0.7"/>
  <rect x="389" y="372" width="3"  height="20" fill="${item.fgColor}" opacity="0.7"/>

  <!-- Pixel Realm logo text -->
  <text x="200" y="46" text-anchor="middle" font-family="monospace"
        font-size="11" fill="${item.fgColor}" opacity="0.5" letter-spacing="4">
    PIXEL REALM ONLINE
  </text>

  <!-- Item emoji (large center) -->
  <text x="200" y="210" text-anchor="middle" font-size="100"
        filter="url(#glow)">${item.emoji}</text>

  <!-- Glow circle behind emoji -->
  <circle cx="200" cy="185" r="80" fill="${item.fgColor}" opacity="0.04"/>
  <circle cx="200" cy="185" r="60" fill="${item.fgColor}" opacity="0.04"/>

  <!-- Item name -->
  <text x="200" y="270" text-anchor="middle" font-family="monospace"
        font-size="22" font-weight="bold" fill="#ffffff" letter-spacing="1">
    ${item.name}
  </text>

  <!-- Rarity badge -->
  <rect x="140" y="285" width="120" height="24" rx="12"
        fill="${badgeColor}" opacity="0.25"/>
  <rect x="140" y="285" width="120" height="24" rx="12"
        fill="none" stroke="${badgeColor}" stroke-width="1" opacity="0.6"/>
  <text x="200" y="301" text-anchor="middle" font-family="monospace"
        font-size="11" fill="${badgeColor}" font-weight="bold" letter-spacing="2">
    ${item.rarity.toUpperCase()}
  </text>

  <!-- Token ID -->
  <text x="200" y="340" text-anchor="middle" font-family="monospace"
        font-size="10" fill="${item.fgColor}" opacity="0.45" letter-spacing="1">
    TOKEN #${tokenId}
  </text>

  <!-- ERC-1155 / Base label -->
  <text x="200" y="375" text-anchor="middle" font-family="monospace"
        font-size="9" fill="#4a4a6a" letter-spacing="2">
    ERC-1155 · BASE
  </text>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      "Content-Type":  "image/svg+xml",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
