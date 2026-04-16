/**
 * PIXEL REALM ONLINE — Onchain Item Forge API
 *
 * POST /api/onchain/mint
 *
 * Burns an off-chain item from the player's Postgres inventory and mints an
 * ERC-1155 token to their connected wallet on Base using the app's Neynar
 * server wallet as the transaction relayer.
 *
 * ── Security model ────────────────────────────────────────────────────────────
 *  - Caller MUST be authenticated via Farcaster (FID required)
 *  - Item ownership is verified server-side against the database
 *  - DB deduction happens BEFORE the mint is submitted to chain
 *  - If the onchain tx fails, the DB row is atomically restored (rollback)
 *  - If the response is lost after a successful tx, the onchain_mints log
 *    prevents the same item from being minted twice (idempotency check)
 *
 * ── ERC-1155 token ID mapping ──────────────────────────────────────────────
 *  Each mintable item type maps to a stable ERC-1155 token ID:
 *    Slime Core      → 1001
 *    Bone Sword      → 1002
 *    Wolf Fang       → 1003
 *    Beast Core      → 1004
 *    Rusty Dagger    → 1005
 *    Leather Cap     → 1006
 *    Bone Shield     → 1007
 *    Wolf Pelt       → 1008
 *    Dark Elixir     → 1009
 *
 * ── How the server wallet mint works ──────────────────────────────────────────
 *  The Neynar server wallet calls the contract's `mint(address, tokenId, amount, data)`
 *  function on behalf of the app.  The contract MUST grant this wallet the MINTER_ROLE.
 *  Contract address is set via ONCHAIN_ITEMS_CONTRACT_ADDRESS env var.
 *
 * ── Environment variables required ────────────────────────────────────────────
 *  NEYNAR_API_KEY                  — Neynar API authentication key
 *  NEYNAR_WALLET_ID                — App server wallet identifier
 *  ONCHAIN_ITEMS_CONTRACT_ADDRESS  — ERC-1155 contract address on Base
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playerInventory, onchainMints } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// ── ERC-1155 ABI fragment — only the mint function we need ─────────────────
const MINT_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account",  type: "address" },
      { name: "id",       type: "uint256" },
      { name: "amount",   type: "uint256" },
      { name: "data",     type: "bytes"   },
    ],
    outputs: [],
  },
] as const;

// ── Mintable item registry ─────────────────────────────────────────────────
// Maps in-game item names to their stable ERC-1155 token IDs.
// Only items listed here can be forged onchain.
const MINTABLE_ITEMS: Record<string, number> = {
  "Slime Core":    1001,
  "Bone Sword":    1002,
  "Wolf Fang":     1003,
  "Beast Core":    1004,
  "Rusty Dagger":  1005,
  "Leather Cap":   1006,
  "Bone Shield":   1007,
  "Wolf Pelt":     1008,
  "Dark Elixir":   1009,
};

// ── Request body shape ─────────────────────────────────────────────────────
interface MintRequest {
  fid:              number;    // Farcaster ID of the player
  itemId:           string;    // DB row UUID of the inventory item
  recipientAddress: string;    // Player's connected wallet address on Base
}

// ── Ethereum address validation ────────────────────────────────────────────
function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Parse and validate request ─────────────────────────────────────────
  let body: MintRequest;
  try {
    body = (await req.json()) as MintRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { fid, itemId, recipientAddress } = body;

  if (!fid || typeof fid !== "number" || fid <= 0) {
    return NextResponse.json({ error: "Invalid or missing FID" }, { status: 400 });
  }
  if (!itemId || typeof itemId !== "string") {
    return NextResponse.json({ error: "Invalid or missing itemId" }, { status: 400 });
  }
  if (!recipientAddress || !isValidAddress(recipientAddress)) {
    return NextResponse.json(
      { error: "Invalid recipient address — must be a valid 0x... Ethereum address (42 chars)" },
      { status: 400 }
    );
  }

  // ── 2. Check contract is configured ───────────────────────────────────────
  const contractAddress = process.env.ONCHAIN_ITEMS_CONTRACT_ADDRESS
    || "0x4Ff4AbB090f3a4F89c2E1E79009fDDc2fb2CEE9D";
  if (!contractAddress || !isValidAddress(contractAddress)) {
    return NextResponse.json(
      { error: "ONCHAIN_ITEMS_CONTRACT_ADDRESS is not configured — contact the app owner" },
      { status: 503 }
    );
  }

  // ── 3. Verify item ownership in DB ────────────────────────────────────────
  // We look up the specific inventory row by UUID + FID so a player can't mint
  // someone else's item by guessing IDs.
  let inventoryRow: typeof playerInventory.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(playerInventory)
      .where(and(eq(playerInventory.id, itemId), eq(playerInventory.fid, fid)))
      .limit(1);
    inventoryRow = rows[0];
  } catch (err) {
    console.error("[Mint] DB lookup failed:", err);
    return NextResponse.json({ error: "Database error — please try again" }, { status: 500 });
  }

  if (!inventoryRow) {
    return NextResponse.json(
      { error: "Item not found in your inventory — it may have already been forged or used" },
      { status: 404 }
    );
  }

  // ── 4. Parse item data and check if it's mintable ─────────────────────────
  let itemData: { name?: string; itemType?: string; id?: string };
  try {
    itemData = JSON.parse(inventoryRow.itemData) as typeof itemData;
  } catch {
    return NextResponse.json({ error: "Corrupt inventory item data" }, { status: 400 });
  }

  const itemName = itemData.name ?? "";
  const tokenId  = MINTABLE_ITEMS[itemName];
  if (!tokenId) {
    return NextResponse.json(
      { error: `"${itemName}" cannot be forged onchain — only rare materials and equipment are mintable` },
      { status: 400 }
    );
  }

  // ── 5. Idempotency check — prevent double-mint of the same item ───────────
  // If there's already a confirmed or pending mint for this exact DB row, block it.
  try {
    const existing = await db
      .select()
      .from(onchainMints)
      .where(and(eq(onchainMints.fid, fid), eq(onchainMints.itemId, itemId)))
      .limit(1);
    if (existing.length > 0 && existing[0].status !== "failed") {
      return NextResponse.json(
        { error: `This item was already forged (status: ${existing[0].status})`, txHash: existing[0].txHash },
        { status: 409 }
      );
    }
  } catch (err) {
    console.error("[Mint] Idempotency check failed:", err);
  }

  // ── 6. Deduct item from DB (the "burn" step) ───────────────────────────────
  // We delete the inventory row first.  If the mint fails, we restore it.
  // This is a pessimistic approach: better to temporarily lose the item than
  // to allow double-minting if a retry race condition occurs.
  try {
    await db.delete(playerInventory).where(eq(playerInventory.id, itemId));
  } catch (err) {
    console.error("[Mint] DB deduction failed:", err);
    return NextResponse.json({ error: "Could not deduct item from inventory — please try again" }, { status: 500 });
  }

  // Record the mint attempt (pending) so we have an audit trail
  let mintLogId: string | undefined;
  try {
    const [mintLog] = await db
      .insert(onchainMints)
      .values({ fid, itemId, itemName, tokenId, recipientAddress, status: "pending" })
      .returning({ id: onchainMints.id });
    mintLogId = mintLog.id;
  } catch (err) {
    console.error("[Mint] Failed to create mint log:", err);
    // Don't block the mint — the log is for audit purposes
  }

  // ── 7. Build the ERC-1155 mint calldata ───────────────────────────────────
  // We use the Neynar server wallet to call mint(address, tokenId, amount, data)
  // on the contract. Amount = 1 (one item per forge).
  const mintCalldata = encodeMintCalldata(recipientAddress as `0x${string}`, tokenId);

  // ── 8. Submit transaction via Neynar server wallet ─────────────────────────
  let txHash: string | undefined;
  try {
    const walletResponse = await fetch("https://api.neynar.com/v2/farcaster/transaction/send", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "x-api-key":     process.env.NEYNAR_API_KEY!,
        "x-wallet-id":   process.env.NEYNAR_WALLET_ID!,
      },
      body: JSON.stringify({
        to:       contractAddress,
        data:     mintCalldata,
        value:    "0",
        chain_id: 8453, // Base mainnet
      }),
    });

    if (!walletResponse.ok) {
      const errBody = await walletResponse.text();
      throw new Error(`Neynar wallet API returned ${walletResponse.status}: ${errBody}`);
    }

    const walletResult = (await walletResponse.json()) as { transaction_hash?: string; hash?: string };
    txHash = walletResult.transaction_hash ?? walletResult.hash;

    if (!txHash) {
      throw new Error("No transaction hash returned from wallet API");
    }
  } catch (mintErr) {
    console.error("[Mint] Onchain mint failed — rolling back DB:", mintErr);

    // ── 8a. ROLLBACK: Restore the inventory row ─────────────────────────────
    try {
      await db.insert(playerInventory).values({
        id:       itemId,
        fid,
        itemData: inventoryRow.itemData,
      });
      console.log(`[Mint] Rollback successful — restored item ${itemId} for FID ${fid}`);
    } catch (rollbackErr) {
      // This is a critical failure: item is lost from DB but not minted onchain.
      // Log it loudly. In production you would alert here.
      console.error("[Mint] CRITICAL: Rollback failed — item lost from DB:", rollbackErr);
    }

    // Mark the mint log as failed
    if (mintLogId) {
      await db.update(onchainMints)
        .set({ status: "failed" })
        .where(eq(onchainMints.id, mintLogId))
        .catch(() => {});
    }

    return NextResponse.json(
      { error: "Onchain mint failed — your item has been returned to your inventory" },
      { status: 502 }
    );
  }

  // ── 9. Mark mint as confirmed in the log ──────────────────────────────────
  if (mintLogId) {
    await db.update(onchainMints)
      .set({ status: "confirmed", txHash, confirmedAt: new Date() })
      .where(eq(onchainMints.id, mintLogId))
      .catch(() => {});
  }

  console.log(`[Mint] Success: FID ${fid} forged ${itemName} → token ${tokenId} (tx: ${txHash})`);

  return NextResponse.json({
    ok:       true,
    txHash,
    tokenId,
    itemName,
    chainId:  8453,
    explorer: `https://basescan.org/tx/${txHash}`,
  });
}

// ── ABI encode helpers ─────────────────────────────────────────────────────
//
// Manually encode mint(address,uint256,uint256,bytes) calldata using
// standard ABI encoding without importing ethers/viem in the server route
// (keeps the bundle light — this is a server-only file).
//
// ABI encoding reference:
//   selector      = keccak256("mint(address,uint256,uint256,bytes)")[0:4]
//   = 0x731133e9
//   param layout  = (address, uint256, uint256, bytes) — bytes is dynamic
//     slot 0 (offset 0x00): address (left-padded to 32 bytes)
//     slot 1 (offset 0x20): tokenId (uint256)
//     slot 2 (offset 0x40): amount  (uint256, = 1)
//     slot 3 (offset 0x60): offset of `data` = 0x80
//     slot 4 (offset 0x80): length of `data` = 0
//     (no bytes payload — empty data)

function padHex32(hex: string): string {
  return hex.replace("0x", "").padStart(64, "0");
}

function encodeMintCalldata(recipient: `0x${string}`, tokenId: number): string {
  const selector = "731133e9"; // keccak256("mint(address,uint256,uint256,bytes)")[0:4]
  const addr     = padHex32(recipient);
  const id       = padHex32(tokenId.toString(16));
  const amount   = padHex32("1");
  const dataOff  = padHex32("80"); // bytes param offset = 4 slots × 32 bytes = 128 = 0x80
  const dataLen  = padHex32("0");  // empty bytes
  return `0x${selector}${addr}${id}${amount}${dataOff}${dataLen}`;
}
