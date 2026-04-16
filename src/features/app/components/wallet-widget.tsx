"use client";

/**
 * PIXEL REALM ONLINE — Wallet Widget
 *
 * Shows connected wallet address + Base ETH balance in the game HUD.
 * Uses Farcaster's built-in wagmi connector (auto-connected inside Farcaster app).
 * Also shows a compact connect button for browser access.
 */

import { useAccount, useConnect, useDisconnect, useBalance } from "wagmi";
import { truncateAddress } from "@/neynar-web-sdk/blockchain";

export function WalletWidget() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });

  if (isConnected && address) {
    return (
      <div style={styles.connected}>
        {/* Chain badge */}
        <span style={{
          ...styles.chainBadge,
          background: chain?.id === 8453 ? "rgba(0,82,255,0.2)" : "rgba(124,58,237,0.2)",
          borderColor: chain?.id === 8453 ? "rgba(0,82,255,0.5)" : "rgba(124,58,237,0.5)",
          color: chain?.id === 8453 ? "#60a5fa" : "#a78bfa",
        }}>
          {chain?.name ?? "Chain"}
        </span>

        {/* Address */}
        <span style={styles.address}>{truncateAddress(address)}</span>

        {/* Balance */}
        {balance && (
          <span style={styles.balance}>
            {parseFloat(balance.formatted).toFixed(4)} {balance.symbol}
          </span>
        )}

        {/* Disconnect */}
        <button
          onClick={() => disconnect()}
          style={styles.disconnectBtn}
          title="Disconnect wallet"
        >
          ✕
        </button>
      </div>
    );
  }

  // Not connected — show connect button
  return (
    <button
      onClick={() => {
        // Try farcaster connector first, then first available
        const fc = connectors.find(c => c.id === "farcasterMiniApp") ?? connectors[0];
        if (fc) connect({ connector: fc });
      }}
      disabled={isPending}
      style={styles.connectBtn}
    >
      {isPending ? "Connecting..." : "🔗 Connect Wallet"}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  connected: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(0,0,0,0.5)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    padding: "3px 8px",
    fontFamily: "monospace",
  },

  chainBadge: {
    fontSize: 8,
    fontWeight: "bold",
    letterSpacing: 0.5,
    padding: "1px 5px",
    borderRadius: 3,
    border: "1px solid",
  },

  address: {
    fontSize: 10,
    color: "#e0e0e0",
    fontFamily: "monospace",
    letterSpacing: 0.5,
  },

  balance: {
    fontSize: 9,
    color: "#aaaaaa",
    fontFamily: "monospace",
  },

  disconnectBtn: {
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.3)",
    cursor: "pointer",
    fontSize: 10,
    padding: "0 2px",
    lineHeight: 1,
  },

  connectBtn: {
    background: "rgba(124, 58, 237, 0.2)",
    border: "1px solid rgba(124, 58, 237, 0.5)",
    borderRadius: 6,
    color: "#c4b5fd",
    fontSize: 10,
    fontFamily: "monospace",
    padding: "5px 10px",
    cursor: "pointer",
    minHeight: 28,
    letterSpacing: 0.5,
    transition: "background 0.15s",
  },
};
