"use client";

/**
 * PIXEL REALM ONLINE — Item Forge Component
 *
 * Lets players burn an off-chain inventory item and mint it as an ERC-1155
 * token on Base. The transaction is sent via the app's server wallet so the
 * player pays no gas.
 *
 * Usage:
 *   <ForgeButton item={selectedItem} fid={player.fid} onSuccess={refresh} />
 */

import { useState } from "react";
import { useAccount } from "wagmi";
import type { Item } from "../types";

// Items that can be forged — must match the server-side MINTABLE_ITEMS registry
const FORGEABLE_ITEM_TYPES = new Set([
  "Slime Core", "Bone Sword", "Wolf Fang", "Beast Core",
  "Rusty Dagger", "Leather Cap", "Bone Shield", "Wolf Pelt", "Dark Elixir",
]);

export function isItemForgeable(item: Item): boolean {
  return FORGEABLE_ITEM_TYPES.has(item.name);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ForgeButtonProps {
  item:       Item;
  fid:        number;
  /** Called with the tx hash after a successful mint */
  onSuccess?: (txHash: string, itemName: string) => void;
  /** Called after item is removed from inventory (success or failure) */
  onItemConsumed?: (itemId: string) => void;
}

type ForgeState = "idle" | "waiting_wallet" | "minting" | "success" | "error";

// ── Component ────────────────────────────────────────────────────────────────

export function ForgeButton({ item, fid, onSuccess, onItemConsumed }: ForgeButtonProps) {
  const { address: walletAddress, isConnected } = useAccount();
  const [state, setState]     = useState<ForgeState>("idle");
  const [txHash, setTxHash]   = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const forgeable = isItemForgeable(item);

  if (!forgeable) return null;

  const handleForge = async () => {
    if (!isConnected || !walletAddress) {
      setErrorMsg("Connect your wallet first to forge items onchain");
      setState("error");
      return;
    }
    if (!fid || fid <= 0) {
      setErrorMsg("You need a Farcaster account to forge items");
      setState("error");
      return;
    }

    setState("minting");
    setErrorMsg(null);
    setTxHash(null);

    try {
      const res = await fetch("/api/onchain/mint", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fid, itemId: item.id, recipientAddress: walletAddress }),
      });

      const data = await res.json() as {
        ok?: boolean;
        txHash?: string;
        tokenId?: number;
        itemName?: string;
        explorer?: string;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Forge failed — please try again");
      }

      setTxHash(data.txHash ?? null);
      setState("success");
      onItemConsumed?.(item.id);
      onSuccess?.(data.txHash ?? "", item.name);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  };

  const reset = () => { setState("idle"); setErrorMsg(null); setTxHash(null); };

  // ── Render ────────────────────────────────────────────────────────────────

  if (state === "success") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", gap: 6,
        background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.35)",
        borderRadius: 8, padding: "10px 12px",
      }}>
        <div style={{ color: "#34d399", fontSize: 11, fontFamily: "monospace", fontWeight: "bold" }}>
          ✓ Forged onchain!
        </div>
        {txHash && (
          <a
            href={`https://basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#60a5fa", fontSize: 9, fontFamily: "monospace",
              textDecoration: "underline", overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap", display: "block",
            }}
          >
            View on BaseScan ↗
          </a>
        )}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", gap: 6,
        background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: 8, padding: "10px 12px",
      }}>
        <div style={{ color: "#f87171", fontSize: 10, fontFamily: "monospace" }}>
          ✗ {errorMsg ?? "Forge failed"}
        </div>
        <button onClick={reset} style={ghostBtn}>
          Try again
        </button>
      </div>
    );
  }

  const busy = state === "minting";

  return (
    <button
      onClick={handleForge}
      disabled={busy || !isConnected}
      style={{
        ...forgeBtn,
        opacity: busy || !isConnected ? 0.55 : 1,
        cursor:  busy || !isConnected ? "not-allowed" : "pointer",
      }}
    >
      {busy ? (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <SpinnerDot /> Forging...
        </span>
      ) : (
        <>⚒ Forge Onchain</>
      )}
    </button>
  );
}

// ── Forge panel — full item card with forge CTA ───────────────────────────────

interface ForgePanelProps {
  item:      Item;
  fid:       number;
  onSuccess?: (txHash: string, itemName: string) => void;
  onForged?:  (itemId: string) => void;
  onClose?:  () => void;
}

export function ForgePanel({ item, fid, onSuccess, onForged, onClose }: ForgePanelProps) {
  const { isConnected, address } = useAccount();

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 700,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(3px)",
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div style={{
        width: "100%", maxWidth: 424,
        background: "linear-gradient(180deg, #1a0a2e 0%, #0d0520 100%)",
        border: "1px solid rgba(240,180,41,0.2)", borderRadius: "16px 16px 0 0",
        padding: "20px 20px 32px",
        boxShadow: "0 -12px 40px rgba(124,58,237,0.3)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ color: "#f0b429", fontSize: 14, fontFamily: "monospace", fontWeight: "bold", letterSpacing: 2 }}>
              ⚒ ITEM FORGE
            </div>
            <div style={{ color: "#4a3a6a", fontSize: 9, fontFamily: "monospace", marginTop: 2 }}>
              Burn off-chain item → Mint ERC-1155 on Base
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} style={{ ...ghostBtn, width: 28, height: 28, padding: 0 }}>✕</button>
          )}
        </div>

        {/* Item card */}
        <div style={{
          background: "rgba(240,180,41,0.05)", border: "1px solid rgba(240,180,41,0.2)",
          borderRadius: 10, padding: "12px 14px", marginBottom: 16,
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ color: "#fff", fontSize: 13, fontFamily: "monospace", fontWeight: "bold" }}>
            {item.name}
          </div>
          <div style={{ color: "#9ca3af", fontSize: 10, fontFamily: "monospace" }}>
            {item.description || "A rare material from the realm."}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <span style={tagStyle}>{item.itemType}</span>
            <span style={tagStyle}>Value: {item.value}g</span>
            <span style={{ ...tagStyle, background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.4)", color: "#c084fc" }}>
              Mintable ✓
            </span>
          </div>
        </div>

        {/* Wallet state */}
        {!isConnected && (
          <div style={{
            background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: 8, padding: "10px 12px", marginBottom: 14,
            color: "#fbbf24", fontSize: 10, fontFamily: "monospace",
          }}>
            ⚠️ Connect your wallet to forge items onchain
          </div>
        )}

        {isConnected && address && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#4a3a6a", fontSize: 8, fontFamily: "monospace", marginBottom: 4 }}>MINTING TO</div>
            <div style={{ color: "#c4b5fd", fontSize: 10, fontFamily: "monospace", letterSpacing: 0.5 }}>
              {address.slice(0, 8)}...{address.slice(-6)}
            </div>
          </div>
        )}

        {/* Warning */}
        <div style={{
          background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 8, padding: "8px 12px", marginBottom: 16,
          color: "#fca5a5", fontSize: 9, fontFamily: "monospace", lineHeight: 1.5,
        }}>
          ⚠️ Forging permanently removes this item from your in-game inventory.
          The minted NFT will be in your wallet on Base. This cannot be undone.
        </div>

        <ForgeButton
          item={item}
          fid={fid}
          onSuccess={onSuccess}
          onItemConsumed={onForged}
        />
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const forgeBtn: React.CSSProperties = {
  width: "100%",
  background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
  border: "1px solid rgba(167,139,250,0.5)",
  borderRadius: 8,
  color: "#fff",
  fontSize: 13,
  fontFamily: "monospace",
  fontWeight: "bold",
  letterSpacing: 1.5,
  padding: "12px 0",
  transition: "all 0.15s ease",
  minHeight: 46,
};

const ghostBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  color: "#888",
  fontSize: 10,
  fontFamily: "monospace",
  padding: "5px 12px",
  cursor: "pointer",
};

const tagStyle: React.CSSProperties = {
  fontSize: 8,
  fontFamily: "monospace",
  color: "#fbbf24",
  background: "rgba(251,191,36,0.1)",
  border: "1px solid rgba(251,191,36,0.25)",
  borderRadius: 4,
  padding: "2px 6px",
};

function SpinnerDot() {
  return (
    <>
      <style>{`@keyframes forgeSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid #a78bfa", borderTopColor: "transparent", borderRadius: "50%", animation: "forgeSpin 0.8s linear infinite" }} />
    </>
  );
}
