"use client";

/**
 * PIXEL REALM ONLINE — Game HUD
 * HP bar, XP bar, Gold counter, Level, Chat log, Kill feed
 * Ragnarok-inspired parchment/brown panel style
 */

import { useEffect, useState, useRef } from "react";
import type { PlayerEntity, Entity, TileMap } from "../types";
import { WalletWidget } from "./wallet-widget";
import { Minimap } from "./minimap";
import { MuteButton } from "@/neynar-farcaster-sdk/audio";
import { ZoneBadge } from "./zone-portal";

interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

interface KillFeedEntry {
  id: string;
  killerName: string;
  targetName: string;
  timestamp: number;
}

interface GameHUDProps {
  player: PlayerEntity | null;
  entities: Entity[];
  tilemap: TileMap | null;
  localPlayerId: string | null;
  connectedPlayers: number;
  ping: number;
  chatMessages: ChatMessage[];
  killFeed: KillFeedEntry[];
  onSendChat: (text: string) => void;
  zone: string;
}

export function GameHUD({
  player,
  entities,
  tilemap,
  localPlayerId,
  connectedPlayers,
  ping,
  chatMessages,
  killFeed,
  onSendChat,
  zone,
}: GameHUDProps) {
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  if (!player) {
    return (
      <div style={styles.connectingOverlay}>
        <div style={styles.connectingBox}>
          <div style={styles.pixelText}>Connecting to Pixel Realm...</div>
          <div style={styles.loadingDots}>
            <span>•</span><span>•</span><span>•</span>
          </div>
        </div>
      </div>
    );
  }

  const hpRatio = player.stats.hp / player.stats.maxHp;
  const xpRatio = (player.stats.xp || 0) / (player.stats.level * 100);

  return (
    <div style={styles.hudRoot}>
      {/* ── Top HUD panel ── */}
      <div style={styles.topPanel}>
        {/* Player info */}
        <div style={styles.playerInfo}>
          <div style={styles.levelBadge}>Lv.{player.stats.level}</div>
          <div style={styles.playerName}>{player.name}</div>
        </div>

        {/* Bars */}
        <div style={styles.barsGroup}>
          {/* HP */}
          <div style={styles.barRow}>
            <span style={{ ...styles.barLabel, color: "#ff6666" }}>HP</span>
            <div style={styles.barTrack}>
              <div
                style={{
                  ...styles.barFill,
                  width: `${hpRatio * 100}%`,
                  background: hpRatio > 0.5 ? "#22cc22" : hpRatio > 0.25 ? "#ffaa00" : "#ff2222",
                  boxShadow: `0 0 6px ${hpRatio > 0.5 ? "#22cc2260" : "#ff222260"}`,
                }}
              />
            </div>
            <span style={styles.barValue}>{player.stats.hp}/{player.stats.maxHp}</span>
          </div>

          {/* XP */}
          <div style={styles.barRow}>
            <span style={{ ...styles.barLabel, color: "#66aaff" }}>XP</span>
            <div style={styles.barTrack}>
              <div
                style={{
                  ...styles.barFill,
                  width: `${xpRatio * 100}%`,
                  background: "#4488ff",
                  boxShadow: "0 0 6px #4488ff60",
                }}
              />
            </div>
            <span style={styles.barValue}>{player.stats.xp || 0}/{player.stats.level * 100}</span>
          </div>
        </div>

        {/* Gold + stats + wallet */}
        <div style={styles.statsRow}>
          <span style={styles.goldDisplay}>💰 {player.gold || 0}g</span>
          <span style={styles.statBadge}>ATK {player.stats.attack}</span>
          <span style={styles.statBadge}>DEF {player.stats.defense}</span>
          <div style={{ marginLeft: "auto", pointerEvents: "all" }}>
            <WalletWidget />
          </div>
        </div>
      </div>

      {/* ── Kill feed (top right) ── */}
      <div style={styles.killFeed}>
        {killFeed.slice(-4).map((kf) => (
          <div key={kf.id} style={styles.killEntry}>
            <span style={{ color: "#ffdd44" }}>{kf.killerName}</span>
            <span style={{ color: "#aaaaaa" }}> defeated </span>
            <span style={{ color: "#ff8888" }}>{kf.targetName}</span>
          </div>
        ))}
      </div>

      {/* ── Server info + mute ── */}
      <div style={styles.serverInfo}>
        <span style={{ color: ping < 100 ? "#44ff44" : ping < 200 ? "#ffaa00" : "#ff4444" }}>
          ⚡{ping}ms
        </span>
        <span style={{ color: "#aaaaaa", marginLeft: 6 }}>👥{connectedPlayers}</span>
        <span style={{ marginLeft: 6 }}><ZoneBadge zoneId={zone} /></span>
        <span style={{ marginLeft: 8, pointerEvents: "all" }}>
          <MuteButton />
        </span>
      </div>

      {/* ── Minimap ── */}
      <Minimap
        tilemap={tilemap}
        entities={entities}
        localPlayerId={localPlayerId}
      />

      {/* ── Chat ── */}
      <div style={styles.chatArea}>
        {showChat && (
          <div style={styles.chatLog}>
            {chatMessages.slice(-8).map((msg) => (
              <div key={msg.id} style={styles.chatLine}>
                <span style={{ color: "#88ccff" }}>{msg.playerName}: </span>
                <span style={{ color: "#e0e0e0" }}>{msg.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}

        <div style={styles.chatInputRow}>
          <button
            style={styles.chatToggle}
            onClick={() => setShowChat(p => !p)}
          >
            💬
          </button>
          {showChat && (
            <>
              <input
                style={styles.chatInput}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && chatInput.trim()) {
                    onSendChat(chatInput.trim());
                    setChatInput("");
                  }
                }}
                placeholder="Say something..."
                maxLength={80}
              />
              <button
                style={styles.chatSend}
                onClick={() => {
                  if (chatInput.trim()) {
                    onSendChat(chatInput.trim());
                    setChatInput("");
                  }
                }}
              >
                ➤
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Styles (inline — avoids Tailwind conflicts in PixiJS layer) --------

const styles: Record<string, React.CSSProperties> = {
  hudRoot: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    fontFamily: "monospace",
    zIndex: 200,
  },

  topPanel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    background: "rgba(20, 10, 5, 0.88)",
    borderBottom: "2px solid #8b6914",
    padding: "8px 12px 6px",
    pointerEvents: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  playerInfo: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },

  levelBadge: {
    background: "#d4a017",
    color: "#1a0a00",
    fontSize: 10,
    fontWeight: "bold",
    padding: "1px 6px",
    borderRadius: 3,
    border: "1px solid #8b6914",
  },

  playerName: {
    color: "#f5e6c8",
    fontSize: 13,
    fontWeight: "bold",
    letterSpacing: 1,
  },

  barsGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },

  barRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },

  barLabel: {
    fontSize: 9,
    fontWeight: "bold",
    width: 16,
    textAlign: "right",
    letterSpacing: 0.5,
  },

  barTrack: {
    flex: 1,
    height: 7,
    background: "rgba(0,0,0,0.6)",
    borderRadius: 2,
    border: "1px solid #4a3a1a",
    overflow: "hidden",
  },

  barFill: {
    height: "100%",
    borderRadius: 2,
    transition: "width 0.2s ease",
  },

  barValue: {
    fontSize: 8,
    color: "#aaaaaa",
    width: 54,
    textAlign: "right",
  },

  statsRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    marginTop: 2,
  },

  goldDisplay: {
    color: "#d4a017",
    fontSize: 11,
    fontWeight: "bold",
  },

  statBadge: {
    color: "#aaaaaa",
    fontSize: 9,
    background: "rgba(255,255,255,0.06)",
    padding: "1px 5px",
    borderRadius: 2,
    border: "1px solid rgba(255,255,255,0.1)",
  },

  killFeed: {
    position: "absolute",
    top: 8,
    right: 8,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    pointerEvents: "none",
    maxWidth: 180,
  },

  killEntry: {
    fontSize: 9,
    background: "rgba(0,0,0,0.6)",
    padding: "2px 6px",
    borderRadius: 3,
    border: "1px solid rgba(255,255,255,0.1)",
  },

  serverInfo: {
    position: "absolute",
    top: 100,
    right: 8,
    fontSize: 9,
    background: "rgba(0,0,0,0.5)",
    padding: "2px 6px",
    borderRadius: 3,
    border: "1px solid rgba(255,255,255,0.1)",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
  },

  chatArea: {
    position: "absolute",
    bottom: 160,
    left: 8,
    maxWidth: 200,
    pointerEvents: "all",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  chatLog: {
    background: "rgba(0,0,0,0.65)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 4,
    padding: "4px 6px",
    maxHeight: 100,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },

  chatLine: {
    fontSize: 9,
    lineHeight: 1.4,
  },

  chatInputRow: {
    display: "flex",
    gap: 4,
  },

  chatToggle: {
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 4,
    color: "white",
    fontSize: 14,
    width: 28,
    height: 28,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },

  chatInput: {
    flex: 1,
    background: "rgba(0,0,0,0.7)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 4,
    color: "white",
    fontSize: 10,
    padding: "2px 6px",
    outline: "none",
    fontFamily: "monospace",
  },

  chatSend: {
    background: "rgba(100,150,255,0.3)",
    border: "1px solid rgba(100,150,255,0.5)",
    borderRadius: 4,
    color: "white",
    fontSize: 12,
    width: 28,
    height: 28,
    cursor: "pointer",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  connectingOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(15, 8, 32, 0.95)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
    fontFamily: "monospace",
  },

  connectingBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  },

  pixelText: {
    color: "#f0b429",
    fontSize: 16,
    fontWeight: "bold",
    letterSpacing: 2,
    textShadow: "0 0 10px #f0b42960",
  },

  loadingDots: {
    display: "flex",
    gap: 8,
    color: "#888888",
    fontSize: 20,
    animation: "pulse 1s infinite",
  },
};
