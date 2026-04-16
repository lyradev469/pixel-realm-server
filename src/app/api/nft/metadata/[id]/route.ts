/**
 * PIXEL REALM ONLINE — ERC-1155 Token Metadata
 *
 * GET /api/nft/metadata/{id}
 *
 * Serves ERC-1155 metadata JSON for Pixel Realm Items.
 * The contract's URI is set to:
 *   https://pixel-realm.vercel.app/api/nft/metadata/{id}
 *
 * Token ID → Item mapping:
 *   1001  Slime Core
 *   1002  Bone Sword
 *   1003  Wolf Fang
 *   1004  Beast Core
 *   1005  Rusty Dagger
 *   1006  Leather Cap
 *   1007  Bone Shield
 *   1008  Wolf Pelt
 *   1009  Dark Elixir
 */

import { NextRequest, NextResponse } from "next/server";

// ── Item registry ────────────────────────────────────────────────────────────

interface ItemMeta {
  name:        string;
  description: string;
  itemType:    "Material" | "Weapon" | "Armor" | "Consumable";
  rarity:      "Common" | "Uncommon" | "Rare" | "Epic";
  value:       number; // in-game gold value
  attributes:  { trait_type: string; value: string | number }[];
}

const ITEM_REGISTRY: Record<number, ItemMeta> = {
  1001: {
    name:        "Slime Core",
    description: "A gelatinous core extracted from a defeated slime. Pulses faintly with residual magic.",
    itemType:    "Material",
    rarity:      "Common",
    value:       15,
    attributes: [
      { trait_type: "Type",   value: "Material" },
      { trait_type: "Rarity", value: "Common"   },
      { trait_type: "Source", value: "Slime"    },
      { trait_type: "Value",  value: 15          },
    ],
  },
  1002: {
    name:        "Bone Sword",
    description: "A crude sword carved from monster bones. Surprisingly durable for its appearance.",
    itemType:    "Weapon",
    rarity:      "Uncommon",
    value:       80,
    attributes: [
      { trait_type: "Type",       value: "Weapon"   },
      { trait_type: "Rarity",     value: "Uncommon" },
      { trait_type: "Weapon Type",value: "Sword"    },
      { trait_type: "Value",      value: 80          },
    ],
  },
  1003: {
    name:        "Wolf Fang",
    description: "A sharp fang taken from a forest wolf. Sought after by craftsmen for its hardness.",
    itemType:    "Material",
    rarity:      "Common",
    value:       20,
    attributes: [
      { trait_type: "Type",   value: "Material" },
      { trait_type: "Rarity", value: "Common"   },
      { trait_type: "Source", value: "Wolf"     },
      { trait_type: "Value",  value: 20          },
    ],
  },
  1004: {
    name:        "Beast Core",
    description: "A crystallized essence of a powerful beast. Contains untamed magical energy.",
    itemType:    "Material",
    rarity:      "Rare",
    value:       150,
    attributes: [
      { trait_type: "Type",   value: "Material" },
      { trait_type: "Rarity", value: "Rare"     },
      { trait_type: "Source", value: "Boss Beast"},
      { trait_type: "Value",  value: 150         },
    ],
  },
  1005: {
    name:        "Rusty Dagger",
    description: "A weathered iron dagger. The blade is notched but still capable of drawing blood.",
    itemType:    "Weapon",
    rarity:      "Common",
    value:       35,
    attributes: [
      { trait_type: "Type",       value: "Weapon"  },
      { trait_type: "Rarity",     value: "Common"  },
      { trait_type: "Weapon Type",value: "Dagger"  },
      { trait_type: "Condition",  value: "Rusty"   },
      { trait_type: "Value",      value: 35         },
    ],
  },
  1006: {
    name:        "Leather Cap",
    description: "A simple helmet stitched from cured leather. Offers modest protection for new adventurers.",
    itemType:    "Armor",
    rarity:      "Common",
    value:       25,
    attributes: [
      { trait_type: "Type",      value: "Armor"   },
      { trait_type: "Rarity",    value: "Common"  },
      { trait_type: "Armor Slot",value: "Head"    },
      { trait_type: "Material",  value: "Leather" },
      { trait_type: "Value",     value: 25         },
    ],
  },
  1007: {
    name:        "Bone Shield",
    description: "A makeshift shield assembled from the bones of fallen creatures. Sturdier than it looks.",
    itemType:    "Armor",
    rarity:      "Uncommon",
    value:       60,
    attributes: [
      { trait_type: "Type",      value: "Armor"    },
      { trait_type: "Rarity",    value: "Uncommon" },
      { trait_type: "Armor Slot",value: "Off-hand" },
      { trait_type: "Material",  value: "Bone"     },
      { trait_type: "Value",     value: 60          },
    ],
  },
  1008: {
    name:        "Wolf Pelt",
    description: "A thick pelt stripped from a forest wolf. Warm, durable, and worth a fair price at market.",
    itemType:    "Material",
    rarity:      "Common",
    value:       30,
    attributes: [
      { trait_type: "Type",   value: "Material" },
      { trait_type: "Rarity", value: "Common"   },
      { trait_type: "Source", value: "Wolf"     },
      { trait_type: "Value",  value: 30          },
    ],
  },
  1009: {
    name:        "Dark Elixir",
    description: "A vial of shimmering obsidian liquid. Its origins are unknown; its power is undeniable.",
    itemType:    "Consumable",
    rarity:      "Epic",
    value:       500,
    attributes: [
      { trait_type: "Type",   value: "Consumable" },
      { trait_type: "Rarity", value: "Epic"       },
      { trait_type: "Effect", value: "Unknown"    },
      { trait_type: "Value",  value: 500           },
    ],
  },
};

// ── Rarity colour mapping for the image background ──────────────────────────
const RARITY_COLOR: Record<string, string> = {
  Common:   "#6b7280",
  Uncommon: "#22c55e",
  Rare:     "#3b82f6",
  Epic:     "#a855f7",
};

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: idStr } = await params;
  const tokenId = parseInt(idStr, 10);

  const item = ITEM_REGISTRY[tokenId];
  if (!item) {
    return NextResponse.json(
      { error: `Token ID ${tokenId} not found` },
      { status: 404 }
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL
      ? `https://${process.env.NEXT_PUBLIC_BASE_URL}`
      : "https://miniapp-generator-fid-1149407-260415225045711.neynar.app";

  // ERC-1155 metadata JSON spec
  const metadata = {
    name:        item.name,
    description: item.description,
    image:       `${baseUrl}/api/nft/image/${tokenId}`,
    external_url:`${baseUrl}`,
    background_color: RARITY_COLOR[item.rarity]?.replace("#", "") ?? "1a0a2e",
    attributes: [
      ...item.attributes,
      { trait_type: "Game",    value: "Pixel Realm Online" },
      { trait_type: "Chain",   value: "Base"               },
      { trait_type: "Standard",value: "ERC-1155"           },
    ],
  };

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
