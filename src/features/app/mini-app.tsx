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
import { InventoryPanel, BagButton, EMPTY_EQUIPMENT } from "./components/inventory-panel";
import type { Equipment, EquipSlot } from "./components/inventory-panel";
import { ZonePortalPrompt, ZoneTransitionScreen } from "./components/zone-portal";
import { LeaderboardScreen } from "./components/leaderboard";
import { getNearbyPortal, ZONE_TILEMAPS, type ZoneKey } from "./zones";
import type { PortalDefinition } from "./zones";
import { ContractDeployer } from "./components/contract-deployer";
import { useSfx, sfx, MuteButton } from "@/neynar-farcaster-sdk/audio";
import {
  sfxHit,
  sfxCritHit,
  sfxEnemyDie,
  sfxPlayerHurt,
  sfxSwing,
  sfxStep,
  sfxLevelUp,
  sfxGold,
  sfxEnterRealm,
} from "./game-audio";

// Dynamic import for PixiJS game (client-only)
const PixiGame = dynamic(
  () => import("./pixi-game").then(m => ({ default: m.PixiGame })),
  { ssr: false }
);

// ---- Game Server Config ------------------------------------------------

const WS_URL = process.env.NEXT_PUBLIC_GAME_WS_URL || "wss://game-serb-production.up.railway.app";

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
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Inventory state (client-side, synced from snapshot)
  const [inventory, setInventory] = useState<import("./types").Item[]>([]);
  const [equipment, setEquipment] = useState<Equipment>(EMPTY_EQUIPMENT);
  const [showInventory, setShowInventory] = useState(false);

  // Zone state
  const [nearbyPortal, setNearbyPortal] = useState<(PortalDefinition & { worldX: number; worldY: number }) | null>(null);
  const [zoneTraveling, setZoneTraveling] = useState(false);
  const [travelingToZone, setTravelingToZone] = useState<string | null>(null);
  const [dismissedPortal, setDismissedPortal] = useState<string | null>(null);

  // Network
  const networkRef = useRef<GameNetworkClient | null>(null);
  const simRef = useRef<GameSimulator | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingStartRef = useRef(0);

  // Entity name lookup
  const entityNameMap = useRef<Map<string, string>>(new Map());
  const localPlayerIdRef = useRef<string | null>(null);
  const prevLevelRef = useRef(1);
  const stepCountRef = useRef(0);

  // Audio
  const sfxPlayer = useSfx();

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
      localPlayerIdRef.current = m.playerId;
      // Use zone-specific tilemap if available, fall back to server tilemap
      const zKey = m.zoneId as ZoneKey;
      const zoneTilemap = ZONE_TILEMAPS[zKey];
      setTilemap(zoneTilemap ? (zoneTilemap as unknown as TileMap) : m.tilemap);
      setEntities(m.entities);
      setZone(m.zoneId);
      setDroppedItems(m.droppedItems || []);
      setConnected(true);
      setZoneTraveling(false);
      setTravelingToZone(null);
      setNearbyPortal(null);
      setDismissedPortal(null);
      for (const e of m.entities) entityNameMap.current.set(e.id, e.name);
    } else if (msg.type === "state_snapshot") {
      const m = msg as unknown as { entities: Entity[]; droppedItems: DroppedItem[]; damages: DamageEvent[] };
      setEntities(m.entities);
      setDroppedItems(m.droppedItems);
      setPing(Math.round(1000 / 15));
      setConnectedPlayers(m.entities.filter((e: Entity) => e.type === "player" || e.type === "agent").length);
      for (const e of m.entities) entityNameMap.current.set(e.id, e.name);

      // Sync inventory from player entity
      const localEFull = m.entities.find((e: Entity) => e.id === localPlayerIdRef.current) as PlayerEntity | undefined;
      if (localEFull && Array.isArray((localEFull as unknown as { inventory?: unknown[] }).inventory)) {
        setInventory((localEFull as unknown as { inventory: import("./types").Item[] }).inventory);
      }

      // Level-up SFX — detect when local player's level increases
      const localE = m.entities.find((e: Entity) => e.id === localPlayerIdRef.current) as PlayerEntity | undefined;
      if (localE) {
        const newLevel = localE.stats?.level ?? (localE as unknown as { level?: number }).level ?? 1;
        if (newLevel > prevLevelRef.current) {
          prevLevelRef.current = newLevel;
          sfxPlayer.play(sfxLevelUp);
        }
      }

      if (m.damages.length > 0) {
        setDamages(m.damages);
        setTimeout(() => setDamages([]), 200);
      }
    } else if (msg.type === "damage") {
      const m = msg as unknown as { event: DamageEvent };
      setDamages([m.event]);
      setTimeout(() => setDamages([]), 200);
      // Play SFX: crit vs normal, player-hurt vs hit
      if (m.event) {
        if (m.event.entityId === localPlayerIdRef.current) {
          sfxPlayer.play(sfxPlayerHurt);
        } else if (m.event.isCrit) {
          sfxPlayer.play(sfxCritHit);
        } else {
          sfxPlayer.play(sfxHit);
        }
      }
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
      sfxPlayer.play(sfxEnemyDie);
    }
  }, []);

  // ---- Connect to game server (with sim fallback) ---------------------

  const connect = useCallback(() => {
    if (networkRef.current || simRef.current) return;

    // Always try real server first (Railway URL is baked in as default)
    const useRealServer = true;

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
      networkRef.current.sendMove(direction);
    } else if (simRef.current) {
      simRef.current.setPlayerMove(direction, position);
    }
    // Footstep every 6 move events
    if (direction) {
      stepCountRef.current++;
      if (stepCountRef.current % 6 === 0) {
        sfxPlayer.play(sfxStep);
      }
    }
    // Portal proximity detection (check every 4 frames to save cycles)
    if (stepCountRef.current % 4 === 0 && position) {
      const portal = getNearbyPortal(position, zone as ZoneKey);
      if (portal && portal.id !== dismissedPortal) {
        setNearbyPortal(portal);
      } else if (!portal) {
        setNearbyPortal(null);
      }
    }
  }, [sfxPlayer, zone, dismissedPortal]);

  const handleAttack = useCallback((targetId: EntityId) => {
    if (networkRef.current) {
      networkRef.current.sendAttack(targetId);
    } else if (simRef.current) {
      simRef.current.setPlayerAttack(targetId);
    }
    sfxPlayer.play(sfxSwing);
  }, [sfxPlayer]);

  const handleEntityClick = useCallback((entityId: EntityId) => {
    // Could open entity info panel in future
  }, []);

  // ---- Inventory handlers -------------------------------------------

  const handleEquipItem = useCallback((item: import("./types").Item, slot: EquipSlot) => {
    setEquipment(prev => ({ ...prev, [slot]: item }));
    sfxPlayer.play(sfx.menuSelect);
  }, [sfxPlayer]);

  const handleUnequipSlot = useCallback((slot: EquipSlot) => {
    setEquipment(prev => ({ ...prev, [slot]: null }));
    sfxPlayer.play(sfx.click);
  }, [sfxPlayer]);

  const handleUseItem = useCallback((item: import("./types").Item) => {
    // Remove from inventory and apply effect (HP handled via sim)
    setInventory(prev => {
      const idx = prev.findIndex(i => i.id === item.id);
      if (idx === -1) return prev;
      const next = [...prev];
      if (next[idx].quantity > 1) {
        next[idx] = { ...next[idx], quantity: next[idx].quantity - 1 };
      } else {
        next.splice(idx, 1);
      }
      return next;
    });
    sfxPlayer.play(sfx.powerup);
  }, [sfxPlayer]);

  const handleDropItem = useCallback((item: import("./types").Item) => {
    setInventory(prev => prev.filter(i => i.id !== item.id));
    setEquipment(prev => {
      const next = { ...prev };
      for (const slot of Object.keys(next) as EquipSlot[]) {
        if (next[slot]?.id === item.id) next[slot] = null;
      }
      return next;
    });
  }, []);

  const handlePickupItem = useCallback((droppedItemId: string) => {
    if (networkRef.current) {
      networkRef.current.sendPickup(droppedItemId);
    } else {
      simRef.current?.pickUpItem(droppedItemId);
    }
    sfxPlayer.play(sfx.coin);
  }, [sfxPlayer]);

  const handleSendChat = useCallback((text: string) => {
    networkRef.current?.sendChat(text);
  }, []);

  const handleEnterZone = useCallback((targetZoneId: string) => {
    setZoneTraveling(true);
    setTravelingToZone(targetZoneId);
    setNearbyPortal(null);
    if (networkRef.current) {
      networkRef.current.sendChangeZone(targetZoneId);
    } else if (simRef.current) {
      simRef.current.changeZone(targetZoneId);
    }
  }, []);

  // ---- Local player --------------------------------------------------

  const localPlayer = useMemo(
    () => entities.find(e => e.id === localPlayerId) as PlayerEntity | undefined,
    [entities, localPlayerId]
  );

  // ---- Start game ----------------------------------------------------

  const handleStartGame = useCallback(() => {
    sfxPlayer.play(sfxEnterRealm);
    setShowTitleScreen(false);
    setGameStarted(true);
    connect();

    // Safety timeout: if PixiJS still hasn't loaded after 12s, force-ready
    // so the game attempts to run (will log a warning if PIXI unavailable)
    if (!pixiReady) {
      setTimeout(() => {
        setPixiReady(prev => {
          if (!prev) console.warn("[PixiJS] Load timeout — forcing ready state");
          return true;
        });
      }, 12000);
    }
  }, [connect, sfxPlayer, pixiReady]);

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
      {/* PixiJS CDN — load async so title screen renders immediately */}
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.4.2/pixi.min.js"
        strategy="afterInteractive"
        onLoad={() => setPixiReady(true)}
        onError={() => {
          // Fallback 1: official PixiJS CDN
          const s1 = document.createElement("script");
          s1.src = "https://pixijs.download/v7.4.2/pixi.min.js";
          s1.onload = () => setPixiReady(true);
          s1.onerror = () => {
            // Fallback 2: jsDelivr mirror
            const s2 = document.createElement("script");
            s2.src = "https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js";
            s2.onload = () => setPixiReady(true);
            s2.onerror = () => {
              // All CDNs failed — mark ready anyway so game can attempt to run
              // (will fail gracefully if window.PIXI is unavailable)
              console.warn("[PixiJS] All CDNs failed — running without WebGL renderer");
              setPixiReady(true);
            };
            document.head.appendChild(s2);
          };
          document.head.appendChild(s1);
        }}
      />

      {/* Title Screen */}
      {showTitleScreen && (
        <TitleScreen
          onStart={handleStartGame}
          isPixiReady={pixiReady}
          username={user?.username}
          fid={user?.fid ?? 0}
          onShowLeaderboard={() => setShowLeaderboard(true)}
        />
      )}

      {/* Leaderboard overlay */}
      {showLeaderboard && (
        <LeaderboardScreen onClose={() => setShowLeaderboard(false)} />
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
              zoneId={zone}
              onMove={handleMove}
              onAttack={handleAttack}
              onEntityClick={handleEntityClick}
            />
          )}

          {/* HUD overlay */}
          <GameHUD
            player={localPlayer || null}
            entities={entities}
            tilemap={tilemap}
            localPlayerId={localPlayerId}
            connectedPlayers={connectedPlayers}
            ping={ping}
            chatMessages={chatMessages}
            killFeed={killFeed}
            onSendChat={handleSendChat}
            zone={zone}
          />

          {/* Bag button — bottom-right above minimap */}
          <div style={{
            position: "absolute",
            bottom: 290,
            right: 12,
            pointerEvents: "all",
            zIndex: 250,
          }}>
            <BagButton
              itemCount={inventory.length}
              onClick={() => setShowInventory(v => !v)}
            />
          </div>

          {/* Inventory panel */}
          {showInventory && (
            <InventoryPanel
              inventory={inventory}
              equipment={equipment}
              gold={localPlayer?.gold ?? 0}
              fid={user?.fid ?? 0}
              onEquip={handleEquipItem}
              onUnequip={handleUnequipSlot}
              onUse={handleUseItem}
              onDrop={handleDropItem}
              onForged={(forgedItemId) => {
                // Remove the forged item from local inventory immediately
                setInventory(prev => prev.filter(i => i.id !== forgedItemId));
              }}
              onClose={() => setShowInventory(false)}
            />
          )}

          {/* Dropped item pickup prompts — show near player */}
          {droppedItems.slice(0, 3).map(di => (
            <button
              key={di.id}
              onClick={() => handlePickupItem(di.id)}
              style={{
                position: "absolute",
                bottom: 170,
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(212,160,23,0.15)",
                border: "1px solid rgba(212,160,23,0.5)",
                borderRadius: 4,
                color: "#f0b429",
                fontSize: 10,
                fontFamily: "monospace",
                padding: "4px 12px",
                cursor: "pointer",
                pointerEvents: "all",
                zIndex: 250,
                whiteSpace: "nowrap",
              }}
            >
              ▲ Pick up {di.item.name}
            </button>
          ))}

          {/* Zone portal prompt */}
          {nearbyPortal && !zoneTraveling && !showInventory && (
            <ZonePortalPrompt
              portal={nearbyPortal}
              currentZone={zone}
              onEnter={handleEnterZone}
              onDismiss={() => {
                setDismissedPortal(nearbyPortal.id);
                setNearbyPortal(null);
              }}
              isLoading={zoneTraveling}
            />
          )}

          {/* Zone transition loading screen */}
          {zoneTraveling && travelingToZone && (
            <ZoneTransitionScreen targetZone={travelingToZone} />
          )}

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

      {/* Waiting for PixiJS — only shown after user starts the game */}
      {gameStarted && !pixiReady && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            background: "#0f0820",
          }}
        >
          <div style={{ fontSize: 40 }}>⚔️</div>
          <div style={{ color: "#f0b429", fontSize: 14, fontFamily: "monospace", letterSpacing: 2 }}>
            Loading Engine...
          </div>
          <PixelLoadingBar />
          <div style={{ color: "#444", fontSize: 10, fontFamily: "monospace" }}>
            Downloading PixiJS WebGL renderer
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Title Screen ------------------------------------------------------

function TitleScreen({ onStart, isPixiReady, username, fid, onShowLeaderboard }: { onStart: () => void; isPixiReady: boolean; username?: string; fid: number; onShowLeaderboard: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [visible, setVisible] = useState(false);
  const [btnHover, setBtnHover] = useState(false);
  const [btnPulse, setBtnPulse] = useState(false);

  // Stagger-in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Pulse the enter button every 2.4s
  useEffect(() => {
    const t = setInterval(() => {
      setBtnPulse(true);
      setTimeout(() => setBtnPulse(false), 400);
    }, 2400);
    return () => clearInterval(t);
  }, []);

  // Canvas animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxRaw = canvas.getContext("2d");
    if (!ctxRaw) return;
    const ctx: CanvasRenderingContext2D = ctxRaw;

    let W = canvas.width;
    let H = canvas.height;

    // --- Star layers (3 depths) ---
    const makeStar = (i: number, layer: number) => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: layer === 0 ? 0.6 : layer === 1 ? 1.1 : 1.7,
      speed: layer === 0 ? 0.08 : layer === 1 ? 0.18 : 0.35,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.02 + Math.random() * 0.03,
    });
    const layers = [
      Array.from({ length: 60 }, (_, i) => makeStar(i, 0)),
      Array.from({ length: 35 }, (_, i) => makeStar(i, 1)),
      Array.from({ length: 15 }, (_, i) => makeStar(i, 2)),
    ];

    // --- Floating rune particles ---
    const RUNES = ["✦", "✧", "◆", "◇", "⬡", "⬟"];
    const particles = Array.from({ length: 18 }, (_, i) => ({
      x: Math.random() * W,
      y: H + Math.random() * 80,
      vy: -(0.3 + Math.random() * 0.5),
      vx: (Math.random() - 0.5) * 0.3,
      alpha: 0,
      maxAlpha: 0.15 + Math.random() * 0.2,
      size: 8 + Math.random() * 10,
      rune: RUNES[i % RUNES.length],
      color: i % 3 === 0 ? "#f0b429" : i % 3 === 1 ? "#7c3aed" : "#4ecdc4",
    }));

    // --- Orbiting rune ring ---
    const RING_R = 56;
    const RING_DOTS = 8;

    let t = 0;

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // Background gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#060312");
      bg.addColorStop(0.5, "#0f0820");
      bg.addColorStop(1, "#0a1628");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // ── Nebula blobs ──
      const cx = W / 2, cy = H * 0.38;
      const pulse = Math.sin(t * 0.015) * 0.12 + 1;
      {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 160 * pulse);
        g.addColorStop(0, "rgba(124,58,237,0.13)");
        g.addColorStop(0.5, "rgba(78,30,140,0.07)");
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(cx, cy, 160 * pulse, 120 * pulse, 0, 0, Math.PI * 2); ctx.fill();
      }
      {
        const g2 = ctx.createRadialGradient(cx + 40, cy + 30, 0, cx + 40, cy + 30, 90);
        g2.addColorStop(0, "rgba(78,205,196,0.08)");
        g2.addColorStop(1, "transparent");
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.ellipse(cx + 40, cy + 30, 90, 70, 0.4, 0, Math.PI * 2); ctx.fill();
      }

      // ── Stars ──
      layers.forEach((layer, li) => {
        layer.forEach(s => {
          s.twinkle += s.twinkleSpeed;
          s.y -= s.speed;
          if (s.y < -2) { s.y = H + 2; s.x = Math.random() * W; }
          const alpha = 0.4 + Math.sin(s.twinkle) * 0.35;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fillStyle = li === 2
            ? `rgba(220,200,255,${alpha})`
            : `rgba(255,255,255,${alpha * 0.7})`;
          ctx.fill();
        });
      });

      // ── Rune particles ──
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -30) { p.y = H + 10; p.x = Math.random() * W; p.alpha = 0; }
        p.alpha = Math.min(p.alpha + 0.004, p.maxAlpha);
        ctx.globalAlpha = p.alpha;
        ctx.font = `${p.size}px monospace`;
        ctx.fillStyle = p.color;
        ctx.fillText(p.rune, p.x, p.y);
      });
      ctx.globalAlpha = 1;

      // ── Orbiting ring ──
      for (let i = 0; i < RING_DOTS; i++) {
        const angle = (i / RING_DOTS) * Math.PI * 2 + t * 0.018;
        const rx = cx + Math.cos(angle) * RING_R;
        const ry = cy + Math.sin(angle) * RING_R * 0.45;
        const dotAlpha = 0.3 + Math.sin(angle + t * 0.03) * 0.2;
        const dotR = i % 2 === 0 ? 2.5 : 1.5;
        const color = i % 2 === 0 ? "#f0b429" : "#7c3aed";
        ctx.beginPath();
        ctx.arc(rx, ry, dotR, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = dotAlpha;
        ctx.fill();

        // trailing glow
        const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, dotR * 3);
        g.addColorStop(0, color + "60");
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(rx, ry, dotR * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── Ground horizon glow ──
      const hg = ctx.createLinearGradient(0, H * 0.72, 0, H);
      hg.addColorStop(0, "transparent");
      hg.addColorStop(0.5, "rgba(124,58,237,0.06)");
      hg.addColorStop(1, "rgba(78,205,196,0.04)");
      ctx.fillStyle = hg;
      ctx.fillRect(0, H * 0.72, W, H * 0.28);

      t++;
      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const fadeUp = (delay: number): React.CSSProperties => ({
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(18px)",
    transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
  });

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", fontFamily: "monospace" }}>
      {/* Animated background canvas */}
      <canvas
        ref={canvasRef}
        width={424}
        height={700}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />

      {/* Content layer */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 0, padding: "24px 20px",
      }}>

        {/* ── Orb + Title ── */}
        <div style={{ ...fadeUp(100), textAlign: "center", marginBottom: 24 }}>
          {/* Sword orb with rotating ring */}
          <div style={{ position: "relative", width: 100, height: 100, margin: "0 auto 18px" }}>
            {/* Outer spin ring */}
            <div style={{
              position: "absolute", inset: -6,
              borderRadius: "50%",
              border: "1.5px solid rgba(240,180,41,0.3)",
              animation: "spin 8s linear infinite",
            }} />
            <div style={{
              position: "absolute", inset: 2,
              borderRadius: "50%",
              border: "1px dashed rgba(124,58,237,0.4)",
              animation: "spinReverse 12s linear infinite",
            }} />
            {/* Core orb */}
            <div style={{
              position: "absolute", inset: 8,
              borderRadius: "50%",
              background: "radial-gradient(circle at 38% 38%, #a855f7 0%, #7c3aed 45%, #3b0764 100%)",
              boxShadow: "0 0 30px #7c3aed90, 0 0 60px #7c3aed40, inset 0 0 20px rgba(255,255,255,0.08)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 36,
            }}>
              ⚔️
            </div>
            {/* Sparkle dots */}
            {[0, 72, 144, 216, 288].map((deg, i) => (
              <div key={i} style={{
                position: "absolute",
                top: "50%", left: "50%",
                width: 4, height: 4,
                marginTop: -2, marginLeft: -2,
                borderRadius: "50%",
                background: i % 2 === 0 ? "#f0b429" : "#4ecdc4",
                transform: `rotate(${deg}deg) translateX(44px)`,
                animation: `sparkle ${1.2 + i * 0.3}s ease-in-out infinite alternate`,
              }} />
            ))}
          </div>

          {/* Title text */}
          <div style={{
            fontSize: 30, fontWeight: "bold",
            color: "#f0b429",
            letterSpacing: 4,
            textShadow: "0 0 24px #f0b42970, 0 0 48px #f0b42930, 0 2px 6px rgba(0,0,0,0.9)",
            lineHeight: 1,
          }}>
            PIXEL REALM
          </div>
          <div style={{
            fontSize: 13, color: "#c084fc",
            letterSpacing: 10, marginTop: 5,
            textShadow: "0 0 12px #c084fc60",
          }}>
            ONLINE
          </div>
          <div style={{
            fontSize: 9, color: "#4ecdc4",
            marginTop: 8, letterSpacing: 2,
            textShadow: "0 0 8px #4ecdc440",
          }}>
            ✦ BROWSER MMORPG  ✦  MULTIPLAYER ✦
          </div>
        </div>

        {/* ── Divider line ── */}
        <div style={{ ...fadeUp(220), width: "100%", maxWidth: 280, marginBottom: 20, position: "relative" }}>
          <div style={{
            height: 1,
            background: "linear-gradient(90deg, transparent, #f0b42940, #7c3aed60, #f0b42940, transparent)",
          }} />
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)",
            background: "#0f0820", padding: "0 10px",
            fontSize: 10, color: "#f0b42980", letterSpacing: 3,
          }}>✦</div>
        </div>

        {/* ── Feature badges ── */}
        <div style={{
          ...fadeUp(320),
          display: "flex", gap: 6, flexWrap: "wrap",
          justifyContent: "center", maxWidth: 310,
          marginBottom: 24,
        }}>
          {[
            { icon: "⚔", label: "Combat" },
            { icon: "🧠", label: "AI Agents" },
            { icon: "🌍", label: "Multiplayer" },
            { icon: "🎮", label: "Real-time" },
            { icon: "✨", label: "WebGL" },
          ].map((f, i) => (
            <div key={f.label} style={{
              background: "rgba(124,58,237,0.12)",
              border: "1px solid rgba(124,58,237,0.35)",
              borderRadius: 4, padding: "4px 10px",
              fontSize: 9, color: "#c4b5fd", letterSpacing: 0.5,
              backdropFilter: "blur(4px)",
              opacity: visible ? 1 : 0,
              transform: visible ? "scale(1)" : "scale(0.85)",
              transition: `opacity 0.4s ease ${380 + i * 60}ms, transform 0.4s ease ${380 + i * 60}ms`,
            }}>
              {f.icon} {f.label}
            </div>
          ))}
        </div>

        {/* ── Wallet ── */}
        <div style={{ ...fadeUp(500), marginBottom: 18, pointerEvents: "all" }}>
          <WalletWidget />
        </div>

        {/* ── Enter button ── */}
        <div style={fadeUp(600)}>
          <button
            onClick={onStart}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              position: "relative",
              background: btnHover
                ? "linear-gradient(135deg, #9333ea, #6366f1)"
                : "linear-gradient(135deg, #7c3aed, #4f46e5)",
              border: `2px solid ${btnHover ? "#e9d5ff" : "#a78bfa"}`,
              borderRadius: 8,
              color: "white",
              fontSize: 17,
              fontWeight: "bold",
              fontFamily: "monospace",
              letterSpacing: 4,
              padding: "14px 44px",
              cursor: "pointer",
              boxShadow: btnPulse
                ? "0 0 40px #a78bfa, 0 0 80px #7c3aed60, 0 4px 20px rgba(0,0,0,0.7)"
                : btnHover
                  ? "0 0 28px #a78bfa80, 0 4px 20px rgba(0,0,0,0.7)"
                  : "0 0 18px #7c3aed60, 0 4px 16px rgba(0,0,0,0.6)",
              transform: btnHover ? "scale(1.05) translateY(-1px)" : btnPulse ? "scale(1.03)" : "scale(1)",
              transition: "all 0.15s ease",
              minWidth: 210, minHeight: 54,
              overflow: "hidden",
            }}
          >
            {/* Shimmer sweep */}
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.08) 50%, transparent 70%)",
              animation: "shimmer 2.5s ease-in-out infinite",
              pointerEvents: "none",
            }} />
            ▶ ENTER REALM
          </button>
        </div>

        {!isPixiReady && (
          <div style={{ ...fadeUp(680), color: "#4a3a6a", fontSize: 9, marginTop: 8 }}>
            Loading engine...
          </div>
        )}

        {/* ── Share + Leaderboard row ── */}
        <div style={{ ...fadeUp(720), marginTop: 14, display: "flex", gap: 8, alignItems: "center", pointerEvents: "all" }}>
          <ShareButton
            text="Come play Pixel Realm Online with me — a browser MMORPG built on Farcaster! ⚔️"
            queryParams={username ? { username } : undefined}
            variant="outline"
          >
            ⚔ Share Pixel Realm
          </ShareButton>
          <button
            onClick={onShowLeaderboard}
            style={{
              background: "rgba(240,180,41,0.1)",
              border: "1px solid rgba(240,180,41,0.35)",
              borderRadius: 8,
              color: "#f0b429",
              fontSize: 11,
              fontFamily: "monospace",
              padding: "8px 14px",
              cursor: "pointer",
              letterSpacing: 0.5,
              whiteSpace: "nowrap",
              minHeight: 38,
              transition: "all 0.15s ease",
            }}
          >
            🏆 Top Players
          </button>
        </div>

        {/* ── Admin: Contract Deployer (creator only) ── */}
        <div style={{ ...fadeUp(760), width: "100%", maxWidth: 340, pointerEvents: "all" }}>
          <ContractDeployer fid={fid} />
        </div>

        {/* ── Footer ── */}
        <div style={{ ...fadeUp(800), color: "#2a1a4a", fontSize: 8, marginTop: 8, letterSpacing: 1 }}>
          v1.0.0 • PixiJS 7 • Ragnarok-inspired
        </div>
      </div>

      {/* CSS keyframe animations injected inline */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spinReverse { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        @keyframes sparkle { from { opacity: 0.2; transform: rotate(var(--deg)) translateX(44px) scale(0.7); } to { opacity: 1; transform: rotate(var(--deg)) translateX(44px) scale(1.3); } }
        @keyframes shimmer { 0% { transform: translateX(-100%); } 60%, 100% { transform: translateX(100%); } }
      `}</style>
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
