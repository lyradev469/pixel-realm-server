"use client";

/**
 * PIXEL REALM ONLINE — Main App Orchestrator
 *
 * Wires together:
 * - PixiJS game engine (WebGL renderer)
 * - WebSocket network client
 * - Procedural asset generation
 * - Game HUD
 * - Farcaster identity
 * - Share functionality
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Script from "next/script";
import { useFarcasterUser, ShareButton } from "@/neynar-farcaster-sdk/mini";
import dynamic from "next/dynamic";
import type {
  Entity,
  PlayerEntity,
  TileMap,
  Direction,
  WorldPosition,
  EntityId,
  DamageEvent,
  DroppedItem,
} from "./types";
import type { GameAssets } from "./pixi-loader";
import { GameNetworkClient } from "./network";
import { GameSimulator } from "./game-sim";
import { GameHUD } from "./components/game-hud";
import { WalletWidget } from "./components/wallet-widget";

// Dynamic import for PixiJS game (client-only)
const PixiGame = dynamic(
  () => import("./pixi-game").then(m => ({ default: m.PixiGame })),
  { ssr: false }
);

// ---- Game Server Config ------------------------------------------------

const WS_URL = process.env.NEXT_PUBLIC_GAME_WS_URL || "ws://localhost:8080";

// ---- Types -------------------------------------------------------------

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

// ---- Mini-App Root -----------------------------------------------------

export function MiniApp() {
  const { data: user } = useFarcasterUser();

  // Game state
  const [pixiReady, setPixiReady] = useState(false);
  const [assets, setAssets] = useState<GameAssets | null>(null);
  const [tilemap, setTilemap] = useState<TileMap | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [droppedItems, setDroppedItems] = useState<DroppedItem[]>([]);
  const [localPlayerId, setLocalPlayerId] = useState<string | null>(null);
  const [damages, setDamages] = useState<DamageEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [ping, setPing] = useState(0);
  const [connectedPlayers, setConnectedPlayers] = useState(0);
  const [zone, setZone] = useState("zone_start");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [killFeed, setKillFeed] = useState<KillFeedEntry[]>([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [showTitleScreen, setShowTitleScreen] = useState(true);

  // Network
  const networkRef = useRef<GameNetworkClient | null>(null);
  const simRef = useRef<GameSimulator | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingStartRef = useRef(0);

  // Entity name lookup
  const entityNameMap = useRef<Map<string, string>>(new Map());

  // ---- Generate assets when PixiJS is ready --------------------------

  useEffect(() => {
    if (!pixiReady) return;
    if (typeof window === "undefined" || !window.PIXI) return;

    import("./pixi-loader").then(({ generateAssets }) => {
      const generatedAssets = generateAssets();
      setAssets(generatedAssets);
    });
  }, [pixiReady]);

  // ---- Shared message handler -----------------------------------------

  const handleSimMessage = useCallback((msg: { type: string; [key: string]: unknown }) => {
    if (msg.type === "init") {
      const m = msg as unknown as { playerId: string; tilemap: TileMap; entities: Entity[]; zoneId: string; droppedItems?: DroppedItem[] };
      setLocalPlayerId(m.playerId);
      setTilemap(m.tilemap);
      setEntities(m.entities);
      setZone(m.zoneId);
      setDroppedItems(m.droppedItems || []);
      setConnected(true);
      for (const e of m.entities) entityNameMap.current.set(e.id, e.name);
    } else if (msg.type === "state_snapshot") {
      const m = msg as unknown as { entities: Entity[]; droppedItems: DroppedItem[]; damages: DamageEvent[] };
      setEntities(m.entities);
      setDroppedItems(m.droppedItems);
      setPing(Math.round(1000 / 15));
      setConnectedPlayers(m.entities.filter((e: Entity) => e.type === "player" || e.type === "agent").length);
      for (const e of m.entities) entityNameMap.current.set(e.id, e.name);
      if (m.damages.length > 0) {
        setDamages(m.damages);
        setTimeout(() => setDamages([]), 200);
      }
    } else if (msg.type === "damage") {
      const m = msg as unknown as { event: DamageEvent };
      setDamages([m.event]);
      setTimeout(() => setDamages([]), 200);
    } else if (msg.type === "entity_died") {
      const m = msg as unknown as { entityId: string; killerId: string };
      const killerName = entityNameMap.current.get(m.killerId) || "World";
      const targetName = entityNameMap.current.get(m.entityId) || "Someone";
      setKillFeed(prev => [...prev.slice(-10), {
        id: `${m.entityId}-${Date.now()}`,
        killerName,
        targetName,
        timestamp: Date.now(),
      }]);
    }
  }, []);

  // ---- Connect to game server (with sim fallback) ---------------------

  const connect = useCallback(() => {
    if (networkRef.current || simRef.current) return;

    // No real server configured → go straight to sim
    const useRealServer = Boolean(process.env.NEXT_PUBLIC_GAME_WS_URL);

    if (!useRealServer) {
      const sim = new GameSimulator();
      simRef.current = sim;
      sim.on(handleSimMessage);
      sim.start();
      return;
    }

    // Try real WebSocket server
    const client = new GameNetworkClient(WS_URL);
    if (user?.username || user?.fid) {
      client.setIdentity(user?.username || null, user?.fid || null);
    }

    let serverConnected = false;
    const fallbackTimer = setTimeout(() => {
      if (!serverConnected) {
        console.log("[Network] Server unreachable — switching to local simulation");
        client.disconnect();
        networkRef.current = null;
        const sim = new GameSimulator();
        simRef.current = sim;
        sim.on(handleSimMessage);
        sim.start();
      }
    }, 4000);

    client.on("connected", () => {
      serverConnected = true;
      clearTimeout(fallbackTimer);
      setConnected(true);
      pingTimerRef.current = setInterval(() => {
        pingStartRef.current = Date.now();
        client.sendChat("");
      }, 5000);
    });

    client.on("disconnected", () => {
      setConnected(false);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    });

    client.on("init", (msg) => {
      handleSimMessage({ type: "init", ...(msg as unknown as Record<string, unknown>) });
    });

    client.on("state_snapshot", (msg) => {
      handleSimMessage({ type: "state_snapshot", ...(msg as unknown as Record<string, unknown>) });
    });

    client.on("damage", (msg) => {
      handleSimMessage({ type: "damage", ...(msg as unknown as Record<string, unknown>) });
    });

    client.on("entity_died", (msg) => {
      handleSimMessage({ type: "entity_died", ...(msg as unknown as Record<string, unknown>) });
    });

    client.on("chat", (msg) => {
      const senderName = entityNameMap.current.get(msg.playerId) || msg.playerId.slice(0, 8);
      setChatMessages(prev => [...prev.slice(-50), {
        id: `${msg.playerId}-${msg.timestamp}`,
        playerId: msg.playerId,
        playerName: senderName,
        text: msg.text,
        timestamp: msg.timestamp,
      }]);
      if (pingStartRef.current > 0) {
        setPing(Date.now() - pingStartRef.current);
        pingStartRef.current = 0;
      }
    });

    client.connect();
    networkRef.current = client;
  }, [user, handleSimMessage]);

  // ---- Disconnect on unmount -----------------------------------------

  useEffect(() => {
    return () => {
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      networkRef.current?.disconnect();
      networkRef.current = null;
      simRef.current?.stop();
      simRef.current = null;
    };
  }, []);

  // ---- Game handlers -------------------------------------------------

  const handleMove = useCallback((direction: Direction | null, position: WorldPosition) => {
    if (networkRef.current) {
      networkRef.current.sendMove(direction, position);
    } else if (simRef.current) {
      simRef.current.setPlayerMove(direction, position);
    }
  }, []);

  const handleAttack = useCallback((targetId: EntityId) => {
    if (networkRef.current) {
      networkRef.current.sendAttack(targetId);
    } else if (simRef.current) {
      simRef.current.setPlayerAttack(targetId);
    }
  }, []);

  const handleEntityClick = useCallback((entityId: EntityId) => {
    // Could open entity info panel in future
  }, []);

  const handleSendChat = useCallback((text: string) => {
    networkRef.current?.sendChat(text);
  }, []);

  // ---- Local player --------------------------------------------------

  const localPlayer = useMemo(
    () => entities.find(e => e.id === localPlayerId) as PlayerEntity | undefined,
    [entities, localPlayerId]
  );

  // ---- Start game ----------------------------------------------------

  const handleStartGame = useCallback(() => {
    setShowTitleScreen(false);
    setGameStarted(true);
    connect();
  }, [connect]);

  // ---- Render --------------------------------------------------------

  return (
    <div
      style={{
        width: "100vw",
        maxWidth: 424,
        height: "100dvh",
        background: "#0f0820",
        overflow: "hidden",
        position: "relative",
        fontFamily: "monospace",
        margin: "0 auto",
      }}
    >
      {/* PixiJS CDN */}
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.4.2/pixi.min.js"
        strategy="beforeInteractive"
        onLoad={() => setPixiReady(true)}
        onError={() => {
          // Fallback CDN
          const script = document.createElement("script");
          script.src = "https://pixijs.download/v7.4.2/pixi.min.js";
          script.onload = () => setPixiReady(true);
          document.head.appendChild(script);
        }}
      />

      {/* Title Screen */}
      {showTitleScreen && (
        <TitleScreen
          onStart={handleStartGame}
          isPixiReady={pixiReady}
          username={user?.username}
        />
      )}

      {/* Game */}
      {gameStarted && pixiReady && assets && (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {/* PixiJS Renderer */}
          {tilemap && (
            <PixiGame
              assets={assets}
              tilemap={tilemap}
              entities={entities}
              droppedItems={droppedItems}
              localPlayerId={localPlayerId}
              damages={damages}
              onMove={handleMove}
              onAttack={handleAttack}
              onEntityClick={handleEntityClick}
            />
          )}

          {/* HUD overlay */}
          <GameHUD
            player={localPlayer || null}
            connectedPlayers={connectedPlayers}
            ping={ping}
            chatMessages={chatMessages}
            killFeed={killFeed}
            onSendChat={handleSendChat}
            zone={zone}
          />

          {/* Connection status badge */}
          {!connected && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                background: "rgba(15,8,32,0.92)",
                border: "2px solid #8b6914",
                borderRadius: 8,
                padding: "20px 32px",
                textAlign: "center",
                zIndex: 500,
              }}
            >
              <div style={{ color: "#f0b429", fontSize: 14, fontWeight: "bold", marginBottom: 8 }}>
                Entering the Realm...
              </div>
              <div style={{ color: "#888", fontSize: 10 }}>
                Spawning world & entities
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading assets */}
      {gameStarted && pixiReady && !assets && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 16,
            background: "#0f0820",
          }}
        >
          <div style={{ color: "#f0b429", fontSize: 16, fontWeight: "bold", letterSpacing: 2 }}>
            Generating Assets...
          </div>
          <div style={{ color: "#666", fontSize: 11 }}>
            Crafting pixel art world
          </div>
          <PixelLoadingBar />
        </div>
      )}

      {/* Waiting for PixiJS */}
      {gameStarted && !pixiReady && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0f0820",
          }}
        >
          <div style={{ color: "#f0b429", fontSize: 14 }}>Loading PixiJS engine...</div>
        </div>
      )}
    </div>
  );
}

// ---- Title Screen ------------------------------------------------------

function TitleScreen({ onStart, isPixiReady, username }: { onStart: () => void; isPixiReady: boolean; username?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setFrame(f => f + 1), 600);
    return () => clearInterval(t);
  }, []);

  const stars = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => ({
      x: ((i * 137.5) % 100),
      y: ((i * 73.1) % 100),
      size: (i % 3) + 1,
      opacity: 0.3 + (i % 5) * 0.1,
    })), []
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(180deg, #0f0820 0%, #1a0a2e 40%, #0d1a3a 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        overflow: "hidden",
      }}
    >
      {/* Stars */}
      {stars.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            background: "white",
            borderRadius: "50%",
            opacity: s.opacity,
          }}
        />
      ))}

      {/* Logo area */}
      <div style={{ textAlign: "center", marginBottom: 32, position: "relative" }}>
        {/* Glow orb */}
        <div
          style={{
            width: 90,
            height: 90,
            borderRadius: "50%",
            background: "radial-gradient(circle, #7c3aed 0%, #4a1a8a 60%, transparent 100%)",
            margin: "0 auto 16px",
            boxShadow: "0 0 40px #7c3aed80, 0 0 80px #7c3aed40",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 40,
          }}
        >
          ⚔️
        </div>

        <div
          style={{
            fontSize: 26,
            fontWeight: "bold",
            color: "#f0b429",
            letterSpacing: 3,
            textShadow: "0 0 20px #f0b42980, 0 2px 4px rgba(0,0,0,0.8)",
            lineHeight: 1.1,
            fontFamily: "monospace",
          }}
        >
          PIXEL REALM
        </div>
        <div
          style={{
            fontSize: 14,
            color: "#d4a017",
            letterSpacing: 8,
            marginTop: 4,
            fontFamily: "monospace",
          }}
        >
          ONLINE
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#888",
            marginTop: 8,
            letterSpacing: 2,
            fontFamily: "monospace",
          }}
        >
          Browser MMORPG • Multiplayer
        </div>
      </div>

      {/* Feature badges */}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 320,
          marginBottom: 32,
          padding: "0 16px",
        }}
      >
        {["⚔ Combat", "🧠 AI Agents", "🌍 Multiplayer", "🎮 Real-time", "✨ WebGL"].map((feat) => (
          <div
            key={feat}
            style={{
              background: "rgba(124, 58, 237, 0.15)",
              border: "1px solid rgba(124, 58, 237, 0.4)",
              borderRadius: 4,
              padding: "3px 8px",
              fontSize: 9,
              color: "#c4b5fd",
              fontFamily: "monospace",
              letterSpacing: 0.5,
            }}
          >
            {feat}
          </div>
        ))}
      </div>

      {/* Wallet connect */}
      <div style={{ marginBottom: 20, pointerEvents: "all" }}>
        <WalletWidget />
      </div>

      {/* Play button */}
      <button
        onClick={onStart}
        style={{
          background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
          border: "2px solid #a78bfa",
          borderRadius: 8,
          color: "white",
          fontSize: 18,
          fontWeight: "bold",
          fontFamily: "monospace",
          letterSpacing: 3,
          padding: "14px 48px",
          cursor: "pointer",
          boxShadow: "0 0 24px #7c3aed80, 0 4px 16px rgba(0,0,0,0.6)",
          transition: "transform 0.1s",
          minWidth: 200,
          minHeight: 56,
        }}
        onMouseEnter={e => ((e.target as HTMLButtonElement).style.transform = "scale(1.04)")}
        onMouseLeave={e => ((e.target as HTMLButtonElement).style.transform = "scale(1)")}
      >
        {frame % 2 === 0 ? "▶ ENTER REALM" : "▶ ENTER REALM"}
      </button>

      {/* Loading hint */}
      {!isPixiReady && (
        <div style={{ color: "#555", fontSize: 9, marginTop: 12, fontFamily: "monospace" }}>
          Loading PixiJS engine...
        </div>
      )}

      {/* Share button */}
      <div style={{ marginTop: 16 }}>
        <ShareButton
          text="Come play Pixel Realm Online with me — a browser MMORPG built on Farcaster! ⚔️"
          queryParams={username ? { username } : undefined}
          variant="outline"
        >
          ⚔ Share Pixel Realm
        </ShareButton>
      </div>

      {/* Version */}
      <div style={{ color: "#333", fontSize: 8, marginTop: 20, fontFamily: "monospace" }}>
        v1.0.0 • PixiJS 7 • Ragnarok-inspired
      </div>
    </div>
  );
}

// ---- Pixel Loading Bar -------------------------------------------------

function PixelLoadingBar() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(t); return 100; }
        return p + Math.random() * 15;
      });
    }, 80);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      style={{
        width: 200,
        height: 8,
        background: "rgba(255,255,255,0.1)",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.min(100, progress)}%`,
          height: "100%",
          background: "linear-gradient(90deg, #7c3aed, #a78bfa)",
          borderRadius: 4,
          transition: "width 0.08s ease",
          boxShadow: "0 0 8px #7c3aed",
        }}
      />
    </div>
  );
}
