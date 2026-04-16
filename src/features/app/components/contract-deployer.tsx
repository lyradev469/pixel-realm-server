"use client";

/**
 * PIXEL REALM ONLINE — Contract Deployer Panel
 *
 * Admin-only component shown to the app creator (FID matches NEXT_PUBLIC_USER_FID).
 * Lets them deploy the PixelRealmItems ERC-1155 contract to Base with one click.
 *
 * After deployment, the contract address is displayed so it can be added to .env.local
 * as ONCHAIN_ITEMS_CONTRACT_ADDRESS.
 *
 * Usage:
 *   <ContractDeployer fid={user.fid} />
 */

import { useState } from "react";

interface ContractDeployerProps {
  fid: number;
}

type DeployState = "idle" | "deploying" | "pending" | "success" | "error";

interface DeployResult {
  ok?: boolean;
  alreadyDeployed?: boolean;
  pending?: boolean;
  contractAddress?: string;
  txHash?: string;
  basescan?: string;
  instruction?: string;
  message?: string;
  error?: string;
}

export function ContractDeployer({ fid }: ContractDeployerProps) {
  const creatorFid = parseInt(process.env.NEXT_PUBLIC_USER_FID ?? "0", 10);

  // Hooks must come before any early return
  const [state, setState]   = useState<DeployState>("idle");
  const [result, setResult] = useState<DeployResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Only show to the app creator
  if (!fid || fid !== creatorFid) return null;

  // If contract is already configured, show the address
  const existingContract = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS
    || "0x4Ff4AbB090f3a4F89c2E1E79009fDDc2fb2CEE9D";

  const handleDeploy = async () => {
    setState("deploying");
    setResult(null);

    try {
      const res = await fetch("/api/onchain/deploy-contract", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fid }),
      });
      const data = (await res.json()) as DeployResult;
      setResult(data);

      if (data.ok && data.alreadyDeployed) setState("success");
      else if (data.ok && data.pending)    setState("pending");
      else if (data.ok && data.contractAddress) setState("success");
      else setState("error");
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Network error" });
      setState("error");
    }
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const panelStyle: React.CSSProperties = {
    background: "linear-gradient(135deg, rgba(124,58,237,0.08), rgba(79,70,229,0.05))",
    border: "1px solid rgba(124,58,237,0.3)",
    borderRadius: 12,
    padding: "16px 18px",
    margin: "12px 0",
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  };

  const labelStyle: React.CSSProperties = {
    color: "#a78bfa",
    fontSize: 10,
    fontFamily: "monospace",
    fontWeight: "bold",
    letterSpacing: 2,
  };

  const badgeStyle: React.CSSProperties = {
    background: "rgba(16,185,129,0.15)",
    border: "1px solid rgba(16,185,129,0.3)",
    borderRadius: 4,
    color: "#34d399",
    fontSize: 9,
    fontFamily: "monospace",
    padding: "2px 7px",
  };

  const deployBtn: React.CSSProperties = {
    width: "100%",
    background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
    border: "1px solid rgba(167,139,250,0.4)",
    borderRadius: 8,
    color: "#fff",
    fontSize: 12,
    fontFamily: "monospace",
    fontWeight: "bold",
    letterSpacing: 1,
    padding: "11px 0",
    cursor: "pointer",
    marginTop: 10,
    transition: "opacity 0.15s",
    minHeight: 42,
  };

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <div style={labelStyle}>⚙ ONCHAIN CONTRACT</div>
          <div style={{ color: "#4a3a6a", fontSize: 9, fontFamily: "monospace", marginTop: 2 }}>
            ERC-1155 Item Forge · Base Mainnet
          </div>
        </div>
        <div style={badgeStyle}>ADMIN</div>
      </div>

      {/* Already configured via env var */}
      {existingContract && (
        <div style={{
          background: "rgba(16,185,129,0.08)",
          border: "1px solid rgba(16,185,129,0.2)",
          borderRadius: 8,
          padding: "10px 12px",
        }}>
          <div style={{ color: "#34d399", fontSize: 10, fontFamily: "monospace", marginBottom: 4 }}>
            ✓ Contract configured
          </div>
          <div style={{ color: "#c4b5fd", fontSize: 9, fontFamily: "monospace", letterSpacing: 0.5 }}>
            {existingContract}
          </div>
        </div>
      )}

      {/* Not yet deployed */}
      {!existingContract && state === "idle" && (
        <>
          <div style={{ color: "#9ca3af", fontSize: 10, fontFamily: "monospace", lineHeight: 1.6, marginBottom: 4 }}>
            Deploy the PixelRealmItems ERC-1155 contract to Base.
            Your server wallet will be granted MINTER_ROLE automatically.
          </div>
          <div style={{
            background: "rgba(251,191,36,0.06)",
            border: "1px solid rgba(251,191,36,0.2)",
            borderRadius: 6,
            padding: "7px 10px",
            color: "#fbbf24",
            fontSize: 9,
            fontFamily: "monospace",
            lineHeight: 1.5,
          }}>
            ⚠️ Ensure your server wallet has ETH on Base for gas before deploying.
          </div>
          <button onClick={handleDeploy} style={deployBtn}>
            🚀 Deploy Contract to Base
          </button>
        </>
      )}

      {/* Deploying spinner */}
      {state === "deploying" && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          color: "#a78bfa", fontSize: 11, fontFamily: "monospace",
          padding: "12px 0",
        }}>
          <Spinner /> Submitting deployment transaction...
        </div>
      )}

      {/* Pending (tx sent but not confirmed yet) */}
      {state === "pending" && result && (
        <div style={{
          background: "rgba(251,191,36,0.06)",
          border: "1px solid rgba(251,191,36,0.2)",
          borderRadius: 8,
          padding: "12px 14px",
        }}>
          <div style={{ color: "#fbbf24", fontSize: 11, fontFamily: "monospace", marginBottom: 8 }}>
            ⏳ Transaction submitted — awaiting confirmation
          </div>
          {result.txHash && (
            <a
              href={result.basescan}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#60a5fa", fontSize: 9, fontFamily: "monospace", display: "block", marginBottom: 8 }}
            >
              View on BaseScan ↗
            </a>
          )}
          <div style={{ color: "#9ca3af", fontSize: 9, fontFamily: "monospace", lineHeight: 1.5 }}>
            Once confirmed, add the contract address to your .env.local as
            ONCHAIN_ITEMS_CONTRACT_ADDRESS and redeploy.
          </div>
        </div>
      )}

      {/* Success */}
      {state === "success" && result && (
        <div style={{
          background: "rgba(16,185,129,0.08)",
          border: "1px solid rgba(16,185,129,0.2)",
          borderRadius: 8,
          padding: "12px 14px",
        }}>
          <div style={{ color: "#34d399", fontSize: 11, fontFamily: "monospace", marginBottom: 8 }}>
            {result.alreadyDeployed ? "✓ Already deployed" : "✓ Contract deployed!"}
          </div>

          {result.contractAddress && (
            <>
              <div style={{ color: "#9ca3af", fontSize: 9, fontFamily: "monospace", marginBottom: 4 }}>
                CONTRACT ADDRESS
              </div>
              <div
                style={{
                  color: "#c4b5fd", fontSize: 10, fontFamily: "monospace",
                  letterSpacing: 0.5, cursor: "pointer",
                  background: "rgba(255,255,255,0.04)", borderRadius: 4,
                  padding: "6px 8px", marginBottom: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                onClick={() => copyToClipboard(result.contractAddress!)}
                title="Click to copy"
              >
                {result.contractAddress}
                <span style={{ marginLeft: 8, color: "#6b7280" }}>
                  {copied ? "✓ copied" : "(click to copy)"}
                </span>
              </div>

              <div style={{
                background: "rgba(124,58,237,0.08)",
                border: "1px solid rgba(124,58,237,0.2)",
                borderRadius: 6,
                padding: "8px 10px",
                color: "#c4b5fd",
                fontSize: 9,
                fontFamily: "monospace",
                lineHeight: 1.6,
              }}>
                Add to .env.local:<br />
                <span style={{ color: "#f0b429" }}>
                  ONCHAIN_ITEMS_CONTRACT_ADDRESS=&quot;{result.contractAddress}&quot;
                </span>
              </div>

              {result.basescan && (
                <a
                  href={result.basescan}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#60a5fa", fontSize: 9, fontFamily: "monospace", display: "block", marginTop: 8 }}
                >
                  View contract on BaseScan ↗
                </a>
              )}
            </>
          )}
        </div>
      )}

      {/* Error */}
      {state === "error" && result && (
        <div style={{
          background: "rgba(239,68,68,0.06)",
          border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 8,
          padding: "12px 14px",
        }}>
          <div style={{ color: "#f87171", fontSize: 10, fontFamily: "monospace", marginBottom: 8 }}>
            ✗ {result.error ?? "Deployment failed"}
          </div>
          <button
            onClick={() => setState("idle")}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: "#888",
              fontSize: 10,
              fontFamily: "monospace",
              padding: "5px 12px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <>
      <style>{`@keyframes deploySpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <span style={{
        display: "inline-block",
        width: 12, height: 12,
        border: "2px solid #a78bfa",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "deploySpin 0.8s linear infinite",
        flexShrink: 0,
      }} />
    </>
  );
}
