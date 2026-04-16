"use client";

/**
 * PIXEL REALM ONLINE — Leaderboard Screen
 *
 * Fetches top players from the Railway game server /leaderboard endpoint.
 * Shows rank, name, level, and gold.
 */

import { useEffect, useState } from "react";

const LEADERBOARD_URL = "https://game-serb-production.up.railway.app/leaderboard";

interface LeaderboardEntry {
  rank: number;
  username: string;
  level: number;
  gold: number;
  score: number;
}

interface LeaderboardProps {
  onClose: () => void;
}

const RANK_COLORS = ["#f0b429", "#d1d5db", "#cd7f32", "#a78bfa", "#a78bfa"];
const RANK_ICONS  = ["👑", "🥈", "🥉", "⚔", "⚔"];

export function LeaderboardScreen({ onClose }: LeaderboardProps) {
  const [entries, setEntries]   = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [visible, setVisible]   = useState(false);

  // Slide-in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40);
    return () => clearTimeout(t);
  }, []);

  // Fetch leaderboard
  useEffect(() => {
    let cancelled = false;

    async function fetchLeaderboard() {
      try {
        const res = await fetch(LEADERBOARD_URL, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { leaderboard?: LeaderboardEntry[]; entries?: LeaderboardEntry[] } | LeaderboardEntry[];
        if (cancelled) return;

        // Server may return { leaderboard: [...] } or { entries: [...] } or a raw array
        let list: LeaderboardEntry[] = [];
        if (Array.isArray(data)) {
          list = data;
        } else if (Array.isArray((data as { leaderboard?: LeaderboardEntry[] }).leaderboard)) {
          list = (data as { leaderboard: LeaderboardEntry[] }).leaderboard;
        } else if (Array.isArray((data as { entries?: LeaderboardEntry[] }).entries)) {
          list = (data as { entries: LeaderboardEntry[] }).entries;
        }

        // Ensure rank field is set
        setEntries(list.slice(0, 20).map((e, i) => ({ ...e, rank: e.rank ?? i + 1 })));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLeaderboard();
    return () => { cancelled = true; };
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 220);
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 800,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(6,3,18,0.85)",
        backdropFilter: "blur(4px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.2s ease",
      }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 424,
          maxHeight: "90dvh",
          background: "linear-gradient(180deg, #120828 0%, #0d0520 100%)",
          border: "1px solid rgba(240,180,41,0.25)",
          borderRadius: "16px 16px 0 0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          transform: visible ? "translateY(0)" : "translateY(40px)",
          transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1)",
          boxShadow: "0 -12px 60px rgba(124,58,237,0.25), 0 -4px 20px rgba(0,0,0,0.8)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(240,180,41,0.15)",
            background: "rgba(240,180,41,0.05)",
            flexShrink: 0,
          }}
        >
          <div>
            <div
              style={{
                color: "#f0b429",
                fontSize: 15,
                fontWeight: "bold",
                fontFamily: "monospace",
                letterSpacing: 3,
                textShadow: "0 0 16px #f0b42960",
              }}
            >
              🏆 HALL OF HEROES
            </div>
            <div style={{ color: "#6b5a2a", fontSize: 9, fontFamily: "monospace", letterSpacing: 1, marginTop: 2 }}>
              Top adventurers across all realms
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: "#888",
              fontSize: 13,
              width: 32,
              height: 32,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Column headers */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "36px 1fr 56px 64px",
            gap: 0,
            padding: "8px 16px",
            background: "rgba(0,0,0,0.3)",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            flexShrink: 0,
          }}
        >
          {["#", "PLAYER", "LVL", "GOLD"].map(h => (
            <div
              key={h}
              style={{
                color: "#4a3a6a",
                fontSize: 8,
                fontFamily: "monospace",
                letterSpacing: 1.5,
                textAlign: h === "#" ? "center" : h === "LVL" || h === "GOLD" ? "right" : "left",
              }}
            >
              {h}
            </div>
          ))}
        </div>

        {/* Scrollable list */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading && (
            <LoadingState />
          )}

          {!loading && error && (
            <ErrorState message={error} onRetry={() => { setLoading(true); setError(null); }} />
          )}

          {!loading && !error && entries.length === 0 && (
            <EmptyState />
          )}

          {!loading && !error && entries.map((entry, i) => (
            <LeaderboardRow key={`${entry.username}-${i}`} entry={entry} index={i} />
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 16px",
            textAlign: "center",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            background: "rgba(0,0,0,0.2)",
            flexShrink: 0,
          }}
        >
          <div style={{ color: "#2a1a4a", fontSize: 8, fontFamily: "monospace", letterSpacing: 1 }}>
            UPDATED LIVE • TOP 20 PLAYERS
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function LeaderboardRow({ entry, index }: { entry: LeaderboardEntry; index: number }) {
  const rank = entry.rank ?? index + 1;
  const rankColor = RANK_COLORS[Math.min(rank - 1, RANK_COLORS.length - 1)];
  const rankIcon  = RANK_ICONS[Math.min(rank - 1, RANK_ICONS.length - 1)];
  const isTop3    = rank <= 3;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "36px 1fr 56px 64px",
        gap: 0,
        padding: "10px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        background: isTop3 ? `rgba(240,180,41,0.03)` : "transparent",
        alignItems: "center",
        transition: "background 0.15s",
      }}
    >
      {/* Rank */}
      <div
        style={{
          textAlign: "center",
          color: rankColor,
          fontSize: isTop3 ? 14 : 11,
          fontFamily: "monospace",
          fontWeight: isTop3 ? "bold" : "normal",
        }}
      >
        {isTop3 ? rankIcon : `${rank}`}
      </div>

      {/* Name */}
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            color: isTop3 ? "#fff" : "#c4b5fd",
            fontSize: 12,
            fontFamily: "monospace",
            fontWeight: isTop3 ? "bold" : "normal",
            letterSpacing: 0.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.username || "Adventurer"}
        </div>
        {isTop3 && (
          <div style={{ color: rankColor, fontSize: 8, fontFamily: "monospace", opacity: 0.7, marginTop: 1 }}>
            {"★".repeat(Math.min(rank, 3))} Legend
          </div>
        )}
      </div>

      {/* Level */}
      <div
        style={{
          textAlign: "right",
          color: "#a78bfa",
          fontSize: 11,
          fontFamily: "monospace",
          fontWeight: "bold",
        }}
      >
        {entry.level ?? "—"}
      </div>

      {/* Gold */}
      <div
        style={{
          textAlign: "right",
          color: "#f0b429",
          fontSize: 11,
          fontFamily: "monospace",
        }}
      >
        {(entry.gold ?? 0).toLocaleString()} g
      </div>
    </div>
  );
}

// ── States ────────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "48px 24px",
      }}
    >
      <div style={{ fontSize: 32, animation: "leaderSpin 1.2s linear infinite" }}>⚔️</div>
      <div style={{ color: "#4a3a6a", fontSize: 11, fontFamily: "monospace", letterSpacing: 2 }}>
        Summoning heroes...
      </div>
      <style>{`@keyframes leaderSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 28 }}>⚠️</div>
      <div style={{ color: "#ef4444", fontSize: 12, fontFamily: "monospace" }}>
        Could not reach the realm server
      </div>
      <div style={{ color: "#4a3a6a", fontSize: 9, fontFamily: "monospace" }}>{message}</div>
      <button
        onClick={onRetry}
        style={{
          marginTop: 4,
          background: "rgba(124,58,237,0.2)",
          border: "1px solid rgba(124,58,237,0.4)",
          borderRadius: 6,
          color: "#c4b5fd",
          fontSize: 11,
          fontFamily: "monospace",
          padding: "7px 18px",
          cursor: "pointer",
          letterSpacing: 1,
        }}
      >
        ↺ Retry
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 32 }}>🏜️</div>
      <div style={{ color: "#4a3a6a", fontSize: 12, fontFamily: "monospace" }}>
        No heroes yet — be the first!
      </div>
    </div>
  );
}
