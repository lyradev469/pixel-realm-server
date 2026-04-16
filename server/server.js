/**
 * PIXEL REALM ONLINE — Authoritative Game Server v2
 *
 * ── Architecture ──────────────────────────────────────────────────────────────
 *
 *  STRICT SERVER-SIDE AUTHORITY (SSA) MODEL
 *  ─────────────────────────────────────────
 *  Clients send ONLY:
 *    { type: "player_input", keys: string[], attackTarget?: string, seq: number }
 *
 *  The server NEVER accepts:
 *    ✗  position coordinates from the client
 *    ✗  HP / stat changes from the client
 *    ✗  damage values from the client
 *    ✗  any field not in the explicit input whitelist
 *
 *  The server OWNS everything:
 *    ✓  All entity positions (derived from input keys + speed + dt)
 *    ✓  All HP values, attack cooldowns, damage formulas
 *    ✓  Monster AI — wander / aggro / attack
 *    ✓  Agent AI — farming / aggressive / wander
 *    ✓  Level-up, XP, gold progression
 *    ✓  Loot generation and dropped item lifetime
 *    ✓  Zone teleportation (portal proximity validated server-side)
 *
 *  Speed-hack / teleport prevention:
 *    - Movement is derived from { keys } each tick: Δposition = direction × (MOVE_SPEED × TILE_SIZE / TICK_RATE)
 *    - Diagonal inputs are normalised to prevent √2 speed diagonal exploits
 *    - Input seq numbers are monotone — out-of-order packets are dropped
 *    - No position field is ever read from a client message
 *
 *  Game loop: 15 tick/sec, broadcast authoritative state_snapshot to each zone
 *
 * ── Persistence ───────────────────────────────────────────────────────────────
 *  - connect (with FID): load saved state from PostgreSQL
 *  - disconnect (with FID): flush state to PostgreSQL
 *  - auto-save loop every 60 s: flush all connected FID-authenticated players
 *  - Redis sorted set: leaderboard (graceful no-op when REDIS_URL is absent)
 */

"use strict";

const WebSocket = require("ws");
const crypto    = require("crypto");
const http      = require("http");
const { Pool }  = require("pg");
const { drizzle }      = require("drizzle-orm/node-postgres");
const { pgTable, text, integer, real, uuid, timestamp } = require("drizzle-orm/pg-core");
const { eq, desc, sql } = require("drizzle-orm");
const Redis = require("ioredis");

// ── Config ────────────────────────────────────────────────────────────────────

const CFG = {
  PORT:             process.env.GAME_PORT  || 8080,
  TICK_RATE:        15,           // authoritative ticks per second
  TILE_SIZE:        32,           // pixels per tile
  WORLD_W:          50,           // tiles wide
  WORLD_H:          50,           // tiles tall
  MOVE_SPEED:       2.8,          // tiles per second (players)
  ATTACK_RANGE:     64,           // pixels
  ATTACK_COOLDOWN:  800,          // ms between attacks
  AGGRO_RANGE:      140,          // pixels — monster chase threshold
  RESPAWN_MS:       10_000,       // ms before dead entity respawns
  AGENT_COUNT:      6,            // AI agents in starting zone
  AGENT_THINK_MS:   1_400,        // ms between agent re-targeting
  INTEREST_RADIUS:  900,          // px — only entities within this are sent to a player
  LOOT_TTL:         30_000,       // ms before dropped items despawn
  AUTOSAVE_MS:      60_000,       // ms between auto-saves
  MAX_KEYS:         8,            // max keys in a single input packet (abuse guard)
  MAX_NAME_LEN:     24,           // character limit for player names
};

const TICK_MS    = Math.round(1000 / CFG.TICK_RATE);
const WORLD_PX_W = CFG.WORLD_W * CFG.TILE_SIZE;
const WORLD_PX_H = CFG.WORLD_H * CFG.TILE_SIZE;

// Maximum credible movement per tick — hard cap for future client-prediction reconciliation
const MAX_MOVE_PER_TICK = CFG.MOVE_SPEED * CFG.TILE_SIZE / CFG.TICK_RATE * 1.5;

// ── Zone definitions ──────────────────────────────────────────────────────────

const ZONE_DEFS = {
  greenfields: {
    id: "greenfields", name: "Greenfields",
    monsterPool: ["slime","goblin"],
    monsterCount: 14,
    portals: [
      { id: "gf_to_forest", targetZone: "forest",  tileX: 48, tileY: 25 },
      { id: "gf_to_town",   targetZone: "town",    tileX: 25, tileY: 2  },
    ],
  },
  forest: {
    id: "forest", name: "Dark Forest",
    monsterPool: ["wolf","goblin","skeleton"],
    monsterCount: 16,
    portals: [
      { id: "forest_to_gf",      targetZone: "greenfields", tileX: 2,  tileY: 25 },
      { id: "forest_to_dungeon", targetZone: "dungeon",     tileX: 25, tileY: 48 },
    ],
  },
  dungeon: {
    id: "dungeon", name: "Stone Dungeon",
    monsterPool: ["skeleton","wolf"],
    monsterCount: 18,
    portals: [
      { id: "dungeon_to_forest", targetZone: "forest",      tileX: 25, tileY: 2  },
      { id: "dungeon_to_town",   targetZone: "town",        tileX: 48, tileY: 25 },
    ],
  },
  town: {
    id: "town", name: "Market Town",
    monsterPool: ["slime"],
    monsterCount: 4,
    portals: [
      { id: "town_to_gf",      targetZone: "greenfields", tileX: 25, tileY: 48 },
      { id: "town_to_dungeon", targetZone: "dungeon",     tileX: 2,  tileY: 25 },
    ],
  },
};

const PORTAL_TRIGGER_RADIUS = 52; // px — player must be within this to use a portal

// ── Database ──────────────────────────────────────────────────────────────────

let db = null;

const playerStates = pgTable("player_states", {
  fid:       integer("fid").primaryKey(),
  username:  text("username").notNull().default("Adventurer"),
  x:         real("x").notNull().default(400),
  y:         real("y").notNull().default(400),
  hp:        integer("hp").notNull().default(150),
  maxHp:     integer("max_hp").notNull().default(150),
  atk:       integer("atk").notNull().default(30),
  def:       integer("def").notNull().default(10),
  level:     integer("level").notNull().default(1),
  xp:        integer("xp").notNull().default(0),
  xpToNext:  integer("xp_to_next").notNull().default(100),
  gold:      integer("gold").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

const playerInventory = pgTable("player_inventory", {
  id:       uuid("id").primaryKey().defaultRandom(),
  fid:      integer("fid").notNull(),
  itemData: text("item_data").notNull(),
});

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.log("[DB] DATABASE_URL not set — persistence disabled");
    return;
  }
  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    db = drizzle(pool);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_states (
        fid         INTEGER PRIMARY KEY,
        username    TEXT NOT NULL DEFAULT 'Adventurer',
        x           REAL NOT NULL DEFAULT 400,
        y           REAL NOT NULL DEFAULT 400,
        hp          INTEGER NOT NULL DEFAULT 150,
        max_hp      INTEGER NOT NULL DEFAULT 150,
        atk         INTEGER NOT NULL DEFAULT 30,
        def         INTEGER NOT NULL DEFAULT 10,
        level       INTEGER NOT NULL DEFAULT 1,
        xp          INTEGER NOT NULL DEFAULT 0,
        xp_to_next  INTEGER NOT NULL DEFAULT 100,
        gold        INTEGER NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS player_inventory (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fid       INTEGER NOT NULL,
        item_data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS player_inventory_fid_idx ON player_inventory(fid);
    `);
    console.log("[DB] PostgreSQL connected — persistence enabled");
  } catch (err) {
    console.error("[DB] Init failed — persistence disabled:", err.message);
    db = null;
  }
}

async function loadPlayerState(fid, player) {
  if (!db || !fid) return false;
  try {
    const rows = await db.select().from(playerStates).where(eq(playerStates.fid, fid));
    if (rows.length === 0) return false;
    const s = rows[0];
    player.position = { x: s.x, y: s.y };
    player.hp       = Math.min(s.hp, s.maxHp);
    player.maxHp    = s.maxHp;
    player.atk      = s.atk;
    player.def      = s.def;
    player.level    = s.level;
    player.xp       = s.xp;
    player.xpToNext = s.xpToNext;
    player.gold     = s.gold;
    if (s.username) player.name = s.username;
    const invRows = await db.select().from(playerInventory).where(eq(playerInventory.fid, fid));
    player.inventory = invRows.map(r => { try { return JSON.parse(r.itemData); } catch { return null; } }).filter(Boolean);
    console.log(`[DB] Loaded FID ${fid} — lv${player.level}`);
    return true;
  } catch (err) {
    console.error(`[DB] Load failed for FID ${fid}:`, err.message);
    return false;
  }
}

async function savePlayerState(player) {
  if (!player.fid) return;
  updateLeaderboard(player).catch(() => {});
  if (!db) return;
  const fid = player.fid;
  try {
    await db.insert(playerStates)
      .values({ fid, username: player.name || "Adventurer", x: player.position.x, y: player.position.y,
                hp: player.hp, maxHp: player.maxHp, atk: player.atk, def: player.def,
                level: player.level, xp: player.xp, xpToNext: player.xpToNext, gold: player.gold, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: playerStates.fid,
        set:    { username: player.name || "Adventurer", x: player.position.x, y: player.position.y,
                  hp: player.hp, maxHp: player.maxHp, atk: player.atk, def: player.def,
                  level: player.level, xp: player.xp, xpToNext: player.xpToNext, gold: player.gold, updatedAt: new Date() },
      });
    await db.delete(playerInventory).where(eq(playerInventory.fid, fid));
    if (player.inventory?.length > 0) {
      await db.insert(playerInventory).values(player.inventory.map(item => ({ fid, itemData: JSON.stringify(item) })));
    }
  } catch (err) {
    console.error(`[DB] Save failed for FID ${fid}:`, err.message);
  }
}

function startAutoSave() {
  setInterval(() => {
    let count = 0;
    for (const [pid] of playerSockets) {
      const zoneId = playerZones.get(pid) || "greenfields";
      const p = zoneEntities[zoneId]?.get(pid);
      if (p?.fid) { savePlayerState(p).catch(() => {}); count++; }
    }
    if (count > 0) console.log(`[DB] Auto-save: ${count} player(s)`);
  }, CFG.AUTOSAVE_MS);
}

// ── Redis / Leaderboard ───────────────────────────────────────────────────────

let redis = null;
const LEADERBOARD_KEY = "pixel_realm:leaderboard";

function initRedis() {
  if (!process.env.REDIS_URL) { console.log("[Redis] REDIS_URL not set — leaderboard cache disabled"); return; }
  try {
    redis = new Redis(process.env.REDIS_URL, { tls: { rejectUnauthorized: false }, lazyConnect: false, maxRetriesPerRequest: 2, connectTimeout: 5000 });
    redis.on("connect", () => console.log("[Redis] Connected — leaderboard enabled"));
    redis.on("error",  (e) => console.error("[Redis] Error:", e.message));
  } catch (e) { console.error("[Redis] Init failed:", e.message); redis = null; }
}

async function updateLeaderboard(player) {
  if (!redis || !player.fid) return;
  const score  = player.level * 10_000 + (player.gold || 0);
  const member = JSON.stringify({ fid: player.fid, username: player.name, level: player.level, gold: player.gold });
  try {
    // Remove any previous entry for this FID (member string may differ)
    const allMembers = await redis.zrange(LEADERBOARD_KEY, 0, -1);
    for (const m of allMembers) {
      try { if (JSON.parse(m).fid === player.fid) { await redis.zrem(LEADERBOARD_KEY, m); break; } } catch {}
    }
    await redis.zadd(LEADERBOARD_KEY, score, member);
    await redis.zremrangebyrank(LEADERBOARD_KEY, 0, -101); // keep top 100
  } catch (e) { console.error("[Redis] Leaderboard update failed:", e.message); }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

const uid   = () => crypto.randomBytes(5).toString("hex");
const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand  = (lo, hi) => lo + Math.random() * (hi - lo);

// ── Tilemap ───────────────────────────────────────────────────────────────────

const ZONE_TILE_POOLS = {
  greenfields: ["grass","grass","grass","dirt","path","stone","water"],
  forest:      ["grass","grass","dirt","stone","stone","path","water"],
  dungeon:     ["stone","stone","stone","path","dirt"],
  town:        ["path","path","dirt","stone","grass"],
};

function generateMap(zoneId = "greenfields") {
  const W    = CFG.WORLD_W, H = CFG.WORLD_H;
  const pool = ZONE_TILE_POOLS[zoneId] || ZONE_TILE_POOLS.greenfields;
  const seed = zoneId.charCodeAt(0) * 0.1 + (zoneId.charCodeAt(1) || 1) * 0.07;
  const tiles = [];
  for (let y = 0; y < H; y++) {
    tiles[y] = [];
    for (let x = 0; x < W; x++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) {
        tiles[y][x] = "wall";
      } else {
        const n = Math.sin(x * 0.4 + seed) * Math.cos(y * 0.3 + seed);
        tiles[y][x] = n < -0.3 ? "water" : pool[Math.floor(Math.abs(n) * pool.length) % pool.length];
      }
    }
  }
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
  for (let i = 1; i < W - 1; i++) tiles[cy][i] = "path";
  for (let i = 1; i < H - 1; i++) tiles[i][cx] = "path";
  const zoneDef = ZONE_DEFS[zoneId];
  if (zoneDef) {
    for (const p of zoneDef.portals) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = p.tileX + dx, ty = p.tileY + dy;
        if (tx > 0 && ty > 0 && tx < W - 1 && ty < H - 1) tiles[ty][tx] = "path";
      }
    }
  }
  return { zoneId, width: W, height: H, tileSize: CFG.TILE_SIZE, tiles };
}

const TILEMAPS = {};
for (const zoneId of Object.keys(ZONE_DEFS)) TILEMAPS[zoneId] = generateMap(zoneId);

function isWalkable(x, y, zoneId = "greenfields") {
  const tilemap = TILEMAPS[zoneId] || TILEMAPS.greenfields;
  const tx = Math.floor(x / CFG.TILE_SIZE), ty = Math.floor(y / CFG.TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= CFG.WORLD_W || ty >= CFG.WORLD_H) return false;
  const t = tilemap.tiles[ty][tx];
  return t !== "wall" && t !== "water";
}

function safeSpawn(zoneId = "greenfields") {
  for (let i = 0; i < 300; i++) {
    const x = rand(2 * CFG.TILE_SIZE, (CFG.WORLD_W - 2) * CFG.TILE_SIZE);
    const y = rand(2 * CFG.TILE_SIZE, (CFG.WORLD_H - 2) * CFG.TILE_SIZE);
    if (isWalkable(x, y, zoneId)) return { x, y };
  }
  return { x: 400, y: 400 }; // fallback centre
}

function nearestPortal(x, y, zoneId) {
  const zoneDef = ZONE_DEFS[zoneId];
  if (!zoneDef) return null;
  for (const p of zoneDef.portals) {
    const px = p.tileX * CFG.TILE_SIZE + CFG.TILE_SIZE / 2;
    const py = p.tileY * CFG.TILE_SIZE + CFG.TILE_SIZE / 2;
    if (Math.hypot(x - px, y - py) < PORTAL_TRIGGER_RADIUS) return p;
  }
  return null;
}

// ── Loot tables ───────────────────────────────────────────────────────────────

let _iid = 0;
const iid = () => `item_${++_iid}`;

const LOOT = {
  slime:    [
    { p: 0.40, fn: () => ({ id: iid(), itemType: "potion",   name: "Slime Jelly",   description: "Restores 30 HP.",        value: 8,  quantity: 1, stats: { hp: 30 } }) },
    { p: 0.15, fn: () => ({ id: iid(), itemType: "material", name: "Slime Core",    description: "Dense core.",            value: 15, quantity: 1 }) },
  ],
  goblin:   [
    { p: 0.35, fn: () => ({ id: iid(), itemType: "weapon",   name: "Rusty Dagger",  description: "+8 ATK.",                value: 22, quantity: 1, stats: { attack: 8 } }) },
    { p: 0.25, fn: () => ({ id: iid(), itemType: "potion",   name: "Stolen Potion", description: "Restores 50 HP.",        value: 12, quantity: 1, stats: { hp: 50 } }) },
    { p: 0.10, fn: () => ({ id: iid(), itemType: "armor",    name: "Leather Cap",   description: "+5 DEF.",                value: 28, quantity: 1, stats: { defense: 5 } }) },
  ],
  skeleton: [
    { p: 0.30, fn: () => ({ id: iid(), itemType: "weapon",   name: "Bone Sword",    description: "+15 ATK.",               value: 55, quantity: 1, stats: { attack: 15 } }) },
    { p: 0.20, fn: () => ({ id: iid(), itemType: "armor",    name: "Bone Shield",   description: "+10 DEF.",               value: 48, quantity: 1, stats: { defense: 10 } }) },
    { p: 0.30, fn: () => ({ id: iid(), itemType: "potion",   name: "Dark Elixir",   description: "Restores 80 HP.",        value: 20, quantity: 1, stats: { hp: 80 } }) },
  ],
  wolf:     [
    { p: 0.35, fn: () => ({ id: iid(), itemType: "armor",    name: "Wolf Pelt",     description: "+8 DEF.",                value: 40, quantity: 1, stats: { defense: 8 } }) },
    { p: 0.20, fn: () => ({ id: iid(), itemType: "weapon",   name: "Wolf Fang",     description: "+12 ATK +1 SPD.",        value: 45, quantity: 1, stats: { attack: 12, speed: 1 } }) },
    { p: 0.15, fn: () => ({ id: iid(), itemType: "material", name: "Beast Core",    description: "Valuable material.",     value: 35, quantity: 1 }) },
  ],
};

function rollLoot(kind) {
  return (LOOT[kind] || []).filter(e => Math.random() < e.p).map(e => e.fn());
}

// ── Monster templates ─────────────────────────────────────────────────────────

const MONSTER_TMPL = {
  slime:    { maxHp: 40,  atk: 8,  def: 2,  speed: 1.2, xpReward: 10, goldReward: 3  },
  goblin:   { maxHp: 80,  atk: 18, def: 5,  speed: 2.0, xpReward: 25, goldReward: 8  },
  skeleton: { maxHp: 120, atk: 25, def: 10, speed: 1.5, xpReward: 40, goldReward: 15 },
  wolf:     { maxHp: 90,  atk: 22, def: 6,  speed: 2.8, xpReward: 30, goldReward: 10 },
};
const MONSTER_KINDS = Object.keys(MONSTER_TMPL);

const AGENT_NAMES  = ["PixelKnight","ShadowArcher","RuneWizard","IronShield","SwiftBlade","DarkMage"];
const AGENT_COLORS = ["#4ecdc4","#ff6b6b","#a8e6cf","#ffd93d","#c77dff","#48cae4"];

// ── World state ───────────────────────────────────────────────────────────────

/** Per-zone entity maps */
const zoneEntities     = {}; // zoneId → Map<id, entity>
/** Per-zone dropped items */
const zoneDroppedItems = {}; // zoneId → Map<id, DroppedItem>
/** Per-zone pending damage events — accumulated per tick, flushed in broadcast */
const zoneDamages      = {}; // zoneId → DamageEvent[]
for (const zoneId of Object.keys(ZONE_DEFS)) {
  zoneEntities[zoneId]     = new Map();
  zoneDroppedItems[zoneId] = new Map();
  zoneDamages[zoneId]      = [];
}

const respawnQueue  = [];
const playerSockets = new Map(); // playerId → ws
const playerZones   = new Map(); // playerId → zoneId
const inputQueue    = new Map(); // playerId → { keys: Set, attackTarget, seq }

// ── Spawn helpers ─────────────────────────────────────────────────────────────

function spawnMonster(zoneId = "greenfields", kindOverride) {
  const zoneDef = ZONE_DEFS[zoneId];
  const pool    = zoneDef ? zoneDef.monsterPool : MONSTER_KINDS;
  const kind    = kindOverride || pool[Math.floor(Math.random() * pool.length)];
  const t       = MONSTER_TMPL[kind] || MONSTER_TMPL.slime;
  const m = {
    id: uid(), type: "monster", kind, zoneId,
    name: kind.charAt(0).toUpperCase() + kind.slice(1),
    position: safeSpawn(zoneId), direction: "down",
    hp: t.maxHp, maxHp: t.maxHp, atk: t.atk, def: t.def,
    level: 1, xp: 0, xpToNext: 0, gold: 0, isMoving: false, fid: 0,
    xpReward: t.xpReward, goldReward: t.goldReward, speed: t.speed,
    // Private AI state — prefixed _ so they don't pollute the public entity model
    _targetId: null, _wanderTarget: null, _lastThink: 0, _lastAtk: 0,
  };
  zoneEntities[zoneId].set(m.id, m);
  return m;
}

function spawnAgent(i, zoneId = "greenfields") {
  const a = {
    id: uid(), type: "agent", zoneId,
    name: AGENT_NAMES[i % AGENT_NAMES.length],
    color: AGENT_COLORS[i % AGENT_COLORS.length],
    position: safeSpawn(zoneId), direction: "down",
    hp: 120, maxHp: 120, atk: 25, def: 8,
    level: 1, xp: 0, xpToNext: 100, gold: 0, isMoving: false, fid: 0,
    behavior: i % 3 === 0 ? "aggressive" : i % 3 === 1 ? "farming" : "wander",
    _targetId: null, _wanderTarget: null, _lastThink: 0, _lastAtk: 0,
  };
  zoneEntities[zoneId].set(a.id, a);
  return a;
}

// Populate all zones
for (const [zoneId, zoneDef] of Object.entries(ZONE_DEFS)) {
  for (let i = 0; i < zoneDef.monsterCount; i++) spawnMonster(zoneId);
}
for (let i = 0; i < CFG.AGENT_COUNT; i++) spawnAgent(i, "greenfields");

// ── Movement helper ───────────────────────────────────────────────────────────
//
// This is the ONLY function that changes entity positions.
// It enforces walkability and world-boundary constraints.
// No client-provided position is ever used.

function moveEntity(entity, dx, dy) {
  const z  = entity.zoneId || "greenfields";

  // Hard cap: prevent any entity moving more than MAX_MOVE_PER_TICK in one tick.
  // Primarily a server-internal safety net; clients can't inject movement directly.
  const mag = Math.hypot(dx, dy);
  if (mag > MAX_MOVE_PER_TICK) { dx = (dx / mag) * MAX_MOVE_PER_TICK; dy = (dy / mag) * MAX_MOVE_PER_TICK; }

  const nx = clamp(entity.position.x + dx, CFG.TILE_SIZE, WORLD_PX_W - CFG.TILE_SIZE);
  const ny = clamp(entity.position.y + dy, CFG.TILE_SIZE, WORLD_PX_H - CFG.TILE_SIZE);

  // Try full move first; fall back to axis-only to allow sliding along walls
  if (isWalkable(nx, ny, z)) { entity.position = { x: nx, y: ny }; return true; }
  if (isWalkable(nx, entity.position.y, z)) { entity.position = { x: nx, y: entity.position.y }; return true; }
  if (isWalkable(entity.position.x, ny, z)) { entity.position = { x: entity.position.x, y: ny }; return true; }
  return false;
}

// ── Combat ────────────────────────────────────────────────────────────────────
//
// All damage calculation lives here.  No client can influence dmg, crit, or HP.

function applyAttack(attacker, target) {
  const now = Date.now();
  if (now - (attacker._lastAtk || 0) < CFG.ATTACK_COOLDOWN) return false;
  if (dist(attacker.position, target.position) > CFG.ATTACK_RANGE) return false;
  attacker._lastAtk = now;

  const crit = Math.random() < 0.10;
  const raw  = (attacker.atk || 10) * (crit ? 1.8 : 1.0);
  const dmg  = Math.max(1, Math.round(raw - (target.def || 0) * 0.5 + rand(-3, 3)));
  target.hp  = Math.max(0, target.hp - dmg);

  const zoneId = target.zoneId || "greenfields";
  if (!zoneDamages[zoneId]) zoneDamages[zoneId] = [];
  zoneDamages[zoneId].push({ entityId: target.id, attackerId: attacker.id, damage: dmg, isCrit: crit, timestamp: now });

  if (target.hp <= 0) handleDeath(target, attacker);
  return true;
}

function handleDeath(target, killer) {
  const zoneId = target.zoneId || "greenfields";

  broadcastToZone(zoneId, JSON.stringify({
    type: "entity_died", entityId: target.id, killerId: killer.id, timestamp: Date.now(),
  }));

  // XP / gold only flow to server — client mirrors from state_snapshot
  if (target.type === "monster" && (killer.type === "player" || killer.type === "agent")) {
    killer.xp   += target.xpReward  || 0;
    killer.gold += target.goldReward || 0;
    if (killer.xp >= killer.xpToNext) {
      killer.level++;
      killer.xp      -= killer.xpToNext;
      killer.xpToNext = Math.round(killer.xpToNext * 1.4);
      killer.maxHp   += 15;
      killer.hp       = killer.maxHp;
      killer.atk     += 4;
      killer.def     += 2;
      if (killer.fid) updateLeaderboard(killer).catch(() => {});
    }
  }

  // Loot drops
  const loot      = rollLoot(target.kind);
  const zoneItems = zoneDroppedItems[zoneId] || zoneDroppedItems.greenfields;
  for (const item of loot) {
    const di = { id: uid(), item, position: { ...target.position }, zoneId, droppedAt: Date.now() };
    zoneItems.set(di.id, di);
    broadcastToZone(zoneId, JSON.stringify({ type: "item_dropped", droppedItem: di }));
  }

  (zoneEntities[zoneId] || zoneEntities.greenfields).delete(target.id);
  if (target.type !== "player") {
    respawnQueue.push({ entity: { ...target, hp: target.maxHp, isMoving: false }, at: Date.now() + CFG.RESPAWN_MS });
  }
}

// ── AI helpers ────────────────────────────────────────────────────────────────

function moveToward(entity, target, speed) {
  const dx  = target.x - entity.position.x;
  const dy  = target.y - entity.position.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) { entity.isMoving = false; return; }
  const moved = moveEntity(entity, (dx / len) * speed, (dy / len) * speed);
  entity.isMoving = moved;
  if (moved) {
    entity.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
  }
}

function wander(entity, speedMult) {
  if (!entity._wanderTarget || dist(entity.position, entity._wanderTarget) < 24) {
    entity._wanderTarget = safeSpawn(entity.zoneId || "greenfields");
  }
  moveToward(entity, entity._wanderTarget, CFG.MOVE_SPEED * speedMult * CFG.TILE_SIZE / CFG.TICK_RATE);
}

// ── Monster AI ────────────────────────────────────────────────────────────────

function updateMonsterAI(m, now) {
  const zoneEnt = zoneEntities[m.zoneId];
  if (!zoneEnt) return;

  let nearest = null, nearestDist = Infinity;
  for (const e of zoneEnt.values()) {
    if (e.type !== "player" || e.hp <= 0) continue;
    const d = dist(m.position, e.position);
    if (d < nearestDist) { nearestDist = d; nearest = e; }
  }

  if (nearest && nearestDist < CFG.AGGRO_RANGE) {
    m._targetId = nearest.id;
    moveToward(m, nearest.position, m.speed * CFG.TILE_SIZE / CFG.TICK_RATE);
    if (nearestDist < CFG.ATTACK_RANGE) applyAttack(m, nearest);
  } else {
    m._targetId = null;
    wander(m, 0.35);
  }
}

// ── Agent AI ──────────────────────────────────────────────────────────────────

function updateAgentAI(a, now) {
  const zoneEnt = zoneEntities[a.zoneId];
  if (!zoneEnt) return;

  if (now - a._lastThink > CFG.AGENT_THINK_MS) {
    a._lastThink = now;
    if (a.behavior === "aggressive" || a.behavior === "farming") {
      const filterKind = a.behavior === "farming" ? "slime" : null;
      let best = null, bestDist = Infinity;
      for (const e of zoneEnt.values()) {
        if (e.type !== "monster" || e.hp <= 0) continue;
        if (filterKind && e.kind !== filterKind) continue;
        const d = dist(a.position, e.position);
        if (d < bestDist) { bestDist = d; best = e; }
      }
      a._targetId = best?.id || null;
    }
  }

  if (a._targetId) {
    const target = zoneEnt.get(a._targetId);
    if (!target || target.hp <= 0) { a._targetId = null; return; }
    const d = dist(a.position, target.position);
    if (d < CFG.ATTACK_RANGE) { applyAttack(a, target); }
    else { moveToward(a, target.position, CFG.MOVE_SPEED * 0.8 * CFG.TILE_SIZE / CFG.TICK_RATE); }
  } else {
    wander(a, 0.4);
  }
}

// ── Authoritative game tick ───────────────────────────────────────────────────
//
// Called exactly every TICK_MS milliseconds.
// ALL state mutations happen here or in functions called from here.
// The client never mutates authoritative state.

function gameTick() {
  const now = Date.now();

  // ── 1. Apply player inputs (the ONLY source of player movement) ────────────
  for (const [pid, input] of inputQueue) {
    const zoneId  = playerZones.get(pid) || "greenfields";
    const zoneEnt = zoneEntities[zoneId];
    const player  = zoneEnt?.get(pid);
    if (!player || player.hp <= 0) continue;

    // Derive Δx / Δy from held keys — this is what prevents speed hacks.
    // Speed = MOVE_SPEED (tiles/s) × TILE_SIZE (px/tile) / TICK_RATE (ticks/s) = px/tick
    const spd = CFG.MOVE_SPEED * CFG.TILE_SIZE / CFG.TICK_RATE;
    let dx = 0, dy = 0, moving = false;

    // Accept only known direction keys — everything else is silently ignored
    if (input.keys.has("up")    || input.keys.has("w")) { dy -= spd; player.direction = "up";    moving = true; }
    if (input.keys.has("down")  || input.keys.has("s")) { dy += spd; player.direction = "down";  moving = true; }
    if (input.keys.has("left")  || input.keys.has("a")) { dx -= spd; player.direction = "left";  moving = true; }
    if (input.keys.has("right") || input.keys.has("d")) { dx += spd; player.direction = "right"; moving = true; }

    // Normalise diagonal to prevent √2 speed exploit
    if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }
    if (moving) moveEntity(player, dx, dy);
    player.isMoving = moving;

    // Attack request — validate target exists, is in-range, and cooldown has passed
    if (input.attackTarget) {
      const target = zoneEnt.get(input.attackTarget);
      if (target && target.hp > 0) applyAttack(player, target);
      input.attackTarget = null; // one attack per input packet
    }
  }

  // ── 2. Respawns ────────────────────────────────────────────────────────────
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    const r = respawnQueue[i];
    if (now < r.at) continue;
    respawnQueue.splice(i, 1);
    const e = r.entity;
    const zoneId = e.zoneId || "greenfields";
    if (!zoneEntities[zoneId]) continue;
    e.position    = safeSpawn(zoneId);
    e.hp          = e.maxHp;
    e.isMoving    = false;
    e._targetId   = null;
    e._wanderTarget = null;
    e._lastAtk    = 0;
    zoneEntities[zoneId].set(e.id, e);
  }

  // ── 3. Monster + Agent AI (server-owned, no client input involved) ─────────
  for (const zoneEnt of Object.values(zoneEntities)) {
    for (const e of zoneEnt.values()) {
      if (e.type === "monster") updateMonsterAI(e, now);
      else if (e.type === "agent") updateAgentAI(e, now);
    }
  }

  // ── 4. Loot TTL ───────────────────────────────────────────────────────────
  for (const zoneItems of Object.values(zoneDroppedItems)) {
    for (const [id, di] of zoneItems) {
      if (now - di.droppedAt > CFG.LOOT_TTL) zoneItems.delete(id);
    }
  }

  // ── 5. Broadcast per-player snapshot (zone-filtered, interest-culled) ──────
  for (const [pid, ws] of playerSockets) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const zoneId    = playerZones.get(pid) || "greenfields";
    const zoneEnt   = zoneEntities[zoneId];
    const zoneItems = zoneDroppedItems[zoneId];
    const player    = zoneEnt?.get(pid);

    const allZoneEntities = zoneEnt ? Array.from(zoneEnt.values()) : [];
    const nearby = player
      ? allZoneEntities.filter(e => e.id === pid || dist(e.position, player.position) <= CFG.INTEREST_RADIUS)
      : allZoneEntities;

    // Drain this zone's damage events — they are delivered once to all players in the zone
    const dmgEvents = zoneDamages[zoneId] || [];

    ws.send(JSON.stringify({
      type:         "state_snapshot",
      timestamp:    now,
      zoneId,
      entities:     nearby,
      droppedItems: zoneItems ? Array.from(zoneItems.values()) : [],
      damages:      dmgEvents, // consumed below after iterating all players
    }));
  }

  // Flush damage arrays after all players in each zone have received this tick's events
  for (const zoneId of Object.keys(zoneDamages)) {
    zoneDamages[zoneId] = [];
  }
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

function broadcast(json) {
  for (const ws of playerSockets.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

function broadcastToZone(zoneId, json) {
  for (const [pid, ws] of playerSockets) {
    if (playerZones.get(pid) === zoneId && ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

// ── WebSocket server ──────────────────────────────────────────────────────────

const httpServer = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  // Always allow CORS for API endpoints
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (url === "/health") {
    // Count total entities across all zones
    let totalEntities = 0;
    for (const m of Object.values(zoneEntities)) totalEntities += m.size;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      players:     playerSockets.size,
      entities:    totalEntities,
      zones:       Object.fromEntries(Object.entries(zoneEntities).map(([z, m]) => [z, m.size])),
      dbEnabled:   !!db,
      redisEnabled:!!redis,
    }));
    return;
  }

  if (url === "/leaderboard") {
    res.writeHead(200, { "Content-Type": "application/json" });
    try {
      if (redis) {
        const raw = await redis.zrevrange(LEADERBOARD_KEY, 0, 19, "WITHSCORES");
        const board = [];
        for (let i = 0; i < raw.length; i += 2) {
          try {
            const entry = JSON.parse(raw[i]);
            entry.score = parseInt(raw[i + 1], 10);
            entry.rank  = board.length + 1;
            board.push(entry);
          } catch {}
        }
        res.end(JSON.stringify({ ok: true, leaderboard: board }));
      } else if (db) {
        // Fallback: compute score expression and sort descending
        const rows = await db
          .select()
          .from(playerStates)
          .orderBy(desc(sql`${playerStates.level} * 10000 + ${playerStates.gold}`))
          .limit(20);
        const board = rows.map((r, i) => ({
          rank: i + 1, fid: r.fid, username: r.username,
          level: r.level, gold: r.gold, score: r.level * 10_000 + r.gold,
        }));
        res.end(JSON.stringify({ ok: true, leaderboard: board }));
      } else {
        res.end(JSON.stringify({ ok: true, leaderboard: [] }));
      }
    } catch (err) {
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404); res.end();
});

const wss = new WebSocket.Server({ server: httpServer });

wss.on("connection", (ws) => {
  const pid       = uid();
  const startZone = "greenfields";

  const player = {
    id: pid, type: "player", zoneId: startZone,
    name:     "Adventurer_" + pid.slice(0, 4),
    position: safeSpawn(startZone), direction: "down",
    hp: 150, maxHp: 150, atk: 30, def: 10,
    level: 1, xp: 0, xpToNext: 100, gold: 0,
    isMoving: false, fid: 0,
    inventory: [],
    _lastAtk: 0,
  };

  zoneEntities[startZone].set(pid, player);
  playerSockets.set(pid, ws);
  playerZones.set(pid, startZone);
  inputQueue.set(pid, { keys: new Set(), attackTarget: null, seq: 0 });

  console.log(`[+] Connect: ${pid} (${playerSockets.size} online)`);

  const sendZoneInit = (zoneId) => ws.send(JSON.stringify({
    type:         "init",
    playerId:     pid,
    zoneId,
    tilemap:      TILEMAPS[zoneId] || TILEMAPS.greenfields,
    entities:     Array.from((zoneEntities[zoneId] || zoneEntities.greenfields).values()),
    droppedItems: Array.from((zoneDroppedItems[zoneId] || zoneDroppedItems.greenfields).values()),
  }));

  sendZoneInit(startZone);
  broadcastToZone(startZone, JSON.stringify({ type: "player_joined", playerId: pid, name: player.name }));

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── Explicit message type whitelist ──────────────────────────────────────
    // Any unknown type is silently dropped.  Only the fields we read are safe.
    switch (msg.type) {

      // ── THE ONLY WAY to move / attack ────────────────────────────────────
      case "player_input": {
        const slot = inputQueue.get(pid);
        if (!slot) break;

        // Monotone sequence guard — drop replays and out-of-order packets
        if (msg.seq !== undefined && typeof msg.seq === "number") {
          if (msg.seq <= slot.seq) break;
          slot.seq = msg.seq;
        }

        // Whitelist only known direction keys; limit array size to prevent abuse
        const VALID_KEYS = new Set(["up","down","left","right","w","a","s","d"]);
        if (Array.isArray(msg.keys)) {
          const safeKeys = msg.keys
            .slice(0, CFG.MAX_KEYS)
            .filter(k => typeof k === "string" && VALID_KEYS.has(k));
          slot.keys = new Set(safeKeys);
        }

        // Accept at most one attack target per input packet
        if (msg.attackTarget && typeof msg.attackTarget === "string") {
          slot.attackTarget = msg.attackTarget;
        }
        break;
      }

      // ── Legacy compat: old `move` message type ────────────────────────────
      case "move": {
        const slot = inputQueue.get(pid);
        if (!slot || typeof msg.direction !== "string") break;
        const VALID_DIRS = new Set(["up","down","left","right"]);
        slot.keys = VALID_DIRS.has(msg.direction) ? new Set([msg.direction]) : new Set();
        break;
      }

      // ── Legacy compat: old `attack` message type ──────────────────────────
      case "attack": {
        const slot = inputQueue.get(pid);
        if (slot && typeof msg.targetId === "string") slot.attackTarget = msg.targetId;
        break;
      }

      // ── Item pickup (server validates proximity) ──────────────────────────
      case "pickup": {
        if (typeof msg.itemId !== "string") break;
        const curZoneId  = playerZones.get(pid) || "greenfields";
        const zoneItems  = zoneDroppedItems[curZoneId];
        const di         = zoneItems?.get(msg.itemId);
        if (!di) break;
        const curPlayer  = zoneEntities[curZoneId]?.get(pid);
        if (!curPlayer) break;
        // Proximity check — must be within 96px of the drop
        if (dist(curPlayer.position, di.position) > 96) break;
        curPlayer.inventory = curPlayer.inventory || [];
        curPlayer.inventory.push(di.item);
        zoneItems.delete(msg.itemId);
        ws.send(JSON.stringify({ type: "item_picked_up", itemId: msg.itemId, playerId: pid }));
        break;
      }

      // ── Zone travel (server validates portal proximity) ───────────────────
      case "change_zone": {
        if (typeof msg.zoneId !== "string" || !ZONE_DEFS[msg.zoneId]) break;
        const targetZoneId = msg.zoneId;
        const oldZoneId    = playerZones.get(pid) || "greenfields";
        const oldPlayer    = zoneEntities[oldZoneId]?.get(pid);
        if (!oldPlayer) break;

        // Server-side portal proximity — client cannot fake this
        const portal = nearestPortal(oldPlayer.position.x, oldPlayer.position.y, oldZoneId);
        if (!portal || portal.targetZone !== targetZoneId) {
          console.warn(`[!] ${pid} tried change_zone to ${targetZoneId} but isn't near a portal`);
          break;
        }

        zoneEntities[oldZoneId].delete(pid);
        broadcastToZone(oldZoneId, JSON.stringify({ type: "player_left", playerId: pid }));

        oldPlayer.zoneId   = targetZoneId;
        oldPlayer.position = safeSpawn(targetZoneId);

        zoneEntities[targetZoneId].set(pid, oldPlayer);
        playerZones.set(pid, targetZoneId);

        broadcastToZone(targetZoneId, JSON.stringify({ type: "player_joined", playerId: pid, name: oldPlayer.name }));
        sendZoneInit(targetZoneId);
        console.log(`[~] ${pid} → ${targetZoneId}`);
        break;
      }

      // ── Farcaster identity / DB load ──────────────────────────────────────
      case "set_username": {
        const curZoneId = playerZones.get(pid) || startZone;
        const curPlayer = zoneEntities[curZoneId]?.get(pid);
        if (!curPlayer) break;

        if (typeof msg.username === "string" && msg.username.trim().length > 0) {
          curPlayer.name = msg.username.trim().slice(0, CFG.MAX_NAME_LEN);
        }

        const newFid = Number(msg.fid) || 0;
        if (newFid && newFid !== curPlayer.fid) {
          curPlayer.fid = newFid;
          const loaded  = await loadPlayerState(newFid, curPlayer);
          if (loaded) sendZoneInit(curZoneId);
        } else if (newFid) {
          curPlayer.fid = newFid;
        }
        break;
      }

      // ── Chat ──────────────────────────────────────────────────────────────
      case "chat": {
        if (typeof msg.text !== "string") break;
        const text = msg.text.slice(0, 120);
        broadcast(JSON.stringify({ type: "chat", playerId: pid, text, timestamp: Date.now() }));
        break;
      }

      // ── Ping / keepalive ─────────────────────────────────────────────────
      case "ping": {
        ws.send(JSON.stringify({ type: "pong", timestamp: msg.timestamp }));
        break;
      }

      // All other types are silently dropped — no processing, no error
    }
  });

  ws.on("close", () => {
    const curZoneId = playerZones.get(pid) || startZone;
    const curPlayer = zoneEntities[curZoneId]?.get(pid);
    if (curPlayer?.fid) {
      savePlayerState(curPlayer).catch(() => {});
      console.log(`[-] ${pid} disconnected (FID ${curPlayer.fid}) — saving`);
    } else {
      console.log(`[-] ${pid} disconnected (anonymous)`);
    }
    zoneEntities[curZoneId]?.delete(pid);
    playerSockets.delete(pid);
    playerZones.delete(pid);
    inputQueue.delete(pid);
    broadcastToZone(curZoneId, JSON.stringify({ type: "player_left", playerId: pid }));
  });

  ws.on("error", (err) => console.error(`[!] WS error ${pid}:`, err.message));
});

// ── Start ─────────────────────────────────────────────────────────────────────

setInterval(gameTick, TICK_MS);

initRedis();
initDb().then(() => {
  startAutoSave();
  httpServer.listen(CFG.PORT, () => {
    console.log(`Pixel Realm server running on :${CFG.PORT}`);
    console.log(`  /health       — server status`);
    console.log(`  /leaderboard  — top 20 players`);
    console.log(`  DB:    ${db    ? "enabled" : "disabled (set DATABASE_URL)"}`);
    console.log(`  Redis: ${redis ? "enabled" : "disabled (set REDIS_URL)"}`);
  });
});
