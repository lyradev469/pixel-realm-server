/**
 * PIXEL REALM ONLINE — In-Browser Game Simulation
 *
 * Runs a full game world client-side when no WebSocket server is available.
 * Implements the same authoritative game loop logic as server/server.js but
 * in the browser, emitting the same message types as the real server.
 *
 * Used automatically when NEXT_PUBLIC_GAME_WS_URL is not set or unreachable.
 */

import type {
  Entity,
  PlayerEntity,
  AgentEntity,
  MonsterEntity,
  TileMap,
  TileType,
  Direction,
  WorldPosition,
} from "./types";

// ---- Config ---------------------------------------------------------------

const SIM_CONFIG = {
  TICK_RATE: 15,
  TILE_SIZE: 32,
  WORLD_WIDTH: 50,
  WORLD_HEIGHT: 50,
  MOVE_SPEED: 2.5,
  ATTACK_RANGE: 64,
  ATTACK_COOLDOWN: 800,
  MONSTER_AGGRO_RANGE: 128,
  RESPAWN_TIME: 8000,
  AGENT_COUNT: 6,
  MONSTER_COUNT: 12,
  AGENT_THINK_MS: 1200,
};

const TICK_MS = 1000 / SIM_CONFIG.TICK_RATE;
const WORLD_PX_W = SIM_CONFIG.WORLD_WIDTH * SIM_CONFIG.TILE_SIZE;
const WORLD_PX_H = SIM_CONFIG.WORLD_HEIGHT * SIM_CONFIG.TILE_SIZE;

// ---- Utilities ------------------------------------------------------------

let _uid = 0;
function uid() {
  return `sim_${++_uid}`;
}

function dist(a: WorldPosition, b: WorldPosition) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function randRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

// ---- Tilemap generation ---------------------------------------------------

function generateTilemap(): TileMap {
  const tiles: TileType[][] = [];
  for (let y = 0; y < SIM_CONFIG.WORLD_HEIGHT; y++) {
    tiles[y] = [];
    for (let x = 0; x < SIM_CONFIG.WORLD_WIDTH; x++) {
      const nx = x / SIM_CONFIG.WORLD_WIDTH;
      const ny = y / SIM_CONFIG.WORLD_HEIGHT;
      const n = Math.sin(nx * 6.3) * Math.cos(ny * 5.1) + Math.sin(nx * 3.7 + ny * 4.2);

      if (x === 0 || y === 0 || x === SIM_CONFIG.WORLD_WIDTH - 1 || y === SIM_CONFIG.WORLD_HEIGHT - 1) {
        tiles[y][x] = "wall";
      } else if (n < -0.8) {
        tiles[y][x] = "water";
      } else if (n < -0.4) {
        tiles[y][x] = "stone";
      } else if (n < 0.3) {
        tiles[y][x] = "grass";
      } else if (n < 0.6) {
        tiles[y][x] = "dirt";
      } else {
        tiles[y][x] = "path";
      }
    }
  }

  // Carve central paths
  const cx = Math.floor(SIM_CONFIG.WORLD_WIDTH / 2);
  const cy = Math.floor(SIM_CONFIG.WORLD_HEIGHT / 2);
  for (let i = 2; i < SIM_CONFIG.WORLD_WIDTH - 2; i++) tiles[cy][i] = "path";
  for (let i = 2; i < SIM_CONFIG.WORLD_HEIGHT - 2; i++) tiles[i][cx] = "path";

  return {
    width: SIM_CONFIG.WORLD_WIDTH,
    height: SIM_CONFIG.WORLD_HEIGHT,
    tileSize: SIM_CONFIG.TILE_SIZE,
    tiles,
  };
}

function isWalkable(tilemap: TileMap, x: number, y: number): boolean {
  const tx = Math.floor(x / SIM_CONFIG.TILE_SIZE);
  const ty = Math.floor(y / SIM_CONFIG.TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= tilemap.width || ty >= tilemap.height) return false;
  const t = tilemap.tiles[ty][tx];
  return t !== "wall" && t !== "water";
}

function safeSpawn(tilemap: TileMap): WorldPosition {
  for (let i = 0; i < 200; i++) {
    const x = randRange(2 * SIM_CONFIG.TILE_SIZE, (SIM_CONFIG.WORLD_WIDTH - 2) * SIM_CONFIG.TILE_SIZE);
    const y = randRange(2 * SIM_CONFIG.TILE_SIZE, (SIM_CONFIG.WORLD_HEIGHT - 2) * SIM_CONFIG.TILE_SIZE);
    if (isWalkable(tilemap, x, y)) return { x, y };
  }
  return { x: 400, y: 400 };
}

// ---- Monster stats --------------------------------------------------------

const MONSTER_TEMPLATES = {
  slime:    { maxHp: 40,  atk: 8,  def: 2,  speed: 1.2, xpReward: 10, goldReward: 3,  color: 0xff69b4 },
  goblin:   { maxHp: 80,  atk: 18, def: 5,  speed: 2.0, xpReward: 25, goldReward: 8,  color: 0x228b22 },
  skeleton: { maxHp: 120, atk: 25, def: 10, speed: 1.5, xpReward: 40, goldReward: 15, color: 0xf5f5dc },
  wolf:     { maxHp: 90,  atk: 22, def: 6,  speed: 2.8, xpReward: 30, goldReward: 10, color: 0x808080 },
};
type MonsterKind = keyof typeof MONSTER_TEMPLATES;
const MONSTER_KINDS: MonsterKind[] = ["slime", "goblin", "skeleton", "wolf"];

const AGENT_NAMES = [
  "PixelKnight", "ShadowArcher", "RuneWizard", "IronShield",
  "SwiftBlade", "DarkMage", "HolyPaladin", "StormRanger",
];

const AGENT_COLORS = [
  "#4ecdc4", "#ff6b6b", "#a8e6cf", "#ffd93d",
  "#c77dff", "#48cae4", "#f4a261", "#90e0ef",
];

// ---- Simulation class -----------------------------------------------------

type SimListener = (msg: SimMessage) => void;

export interface SimMessage {
  type: string;
  [key: string]: unknown;
}

interface RespawnEntry {
  entity: Entity;
  at: number;
}

interface AgentState {
  id: string;
  targetId: string | null;
  wanderTarget: WorldPosition | null;
  lastThink: number;
  behavior: "wander" | "aggressive" | "farming";
}

export class GameSimulator {
  private tilemap: TileMap;
  private entities = new Map<string, Entity>();
  private agentStates = new Map<string, AgentState>();
  private respawnQueue: RespawnEntry[] = [];
  private listeners = new Set<SimListener>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private playerId: string;
  private lastAttack = new Map<string, number>();

  // Player input state
  private playerInput: { direction: Direction | null; position: WorldPosition | null } = {
    direction: null,
    position: null,
  };

  constructor() {
    this.tilemap = generateTilemap();
    this.playerId = uid();
    this._spawnPlayer();
    this._spawnAgents();
    this._spawnMonsters();
  }

  // ---- Public API --------------------------------------------------------

  on(listener: SimListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start() {
    // Send init immediately
    this._emit({
      type: "init",
      playerId: this.playerId,
      zoneId: "zone_start",
      tilemap: this.tilemap,
      entities: [...this.entities.values()],
      droppedItems: [],
    });

    this.tickTimer = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  setPlayerMove(direction: Direction | null, position: WorldPosition | null) {
    this.playerInput = { direction, position };
  }

  setPlayerAttack(targetId: string) {
    const player = this.entities.get(this.playerId) as PlayerEntity | undefined;
    const target = this.entities.get(targetId);
    if (!player || !target || target.hp <= 0) return;

    const now = Date.now();
    const lastAtk = this.lastAttack.get(this.playerId) || 0;
    if (now - lastAtk < SIM_CONFIG.ATTACK_COOLDOWN) return;
    this.lastAttack.set(this.playerId, now);

    if (dist(player.position, target.position) > SIM_CONFIG.ATTACK_RANGE) return;

    this._applyDamage(player, target, now);
  }

  // ---- Spawning ----------------------------------------------------------

  private _spawnPlayer() {
    const pos = safeSpawn(this.tilemap);
    const player: PlayerEntity = {
      id: this.playerId,
      type: "player",
      name: "You",
      position: pos,
      direction: "down",
      hp: 150,
      maxHp: 150,
      atk: 30,
      def: 10,
      level: 1,
      xp: 0,
      xpToNext: 100,
      gold: 0,
      isMoving: false,
      fid: 0,
    };
    this.entities.set(player.id, player);
  }

  private _spawnAgents() {
    for (let i = 0; i < SIM_CONFIG.AGENT_COUNT; i++) {
      const id = uid();
      const pos = safeSpawn(this.tilemap);
      const nameIdx = i % AGENT_NAMES.length;
      const agent: AgentEntity = {
        id,
        type: "agent",
        name: AGENT_NAMES[nameIdx],
        position: pos,
        direction: "down",
        hp: 120,
        maxHp: 120,
        atk: 25,
        def: 8,
        level: 1,
        xp: 0,
        xpToNext: 100,
        gold: 0,
        isMoving: false,
        color: AGENT_COLORS[nameIdx],
        behavior: i % 3 === 0 ? "aggressive" : i % 3 === 1 ? "farming" : "wander",
        fid: 0,
      };
      this.entities.set(id, agent);
      this.agentStates.set(id, {
        id,
        targetId: null,
        wanderTarget: null,
        lastThink: 0,
        behavior: agent.behavior,
      });
    }
  }

  private _spawnMonsters() {
    for (let i = 0; i < SIM_CONFIG.MONSTER_COUNT; i++) {
      this._spawnMonster();
    }
  }

  private _spawnMonster(kindOverride?: MonsterKind) {
    const id = uid();
    const pos = safeSpawn(this.tilemap);
    const kind = kindOverride || MONSTER_KINDS[Math.floor(Math.random() * MONSTER_KINDS.length)];
    const stats = MONSTER_TEMPLATES[kind];
    const monster: MonsterEntity = {
      id,
      type: "monster",
      kind,
      name: kind.charAt(0).toUpperCase() + kind.slice(1),
      position: pos,
      direction: "down",
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      atk: stats.atk,
      def: stats.def,
      level: 1,
      xp: 0,
      xpToNext: 0,
      gold: 0,
      isMoving: false,
      xpReward: stats.xpReward,
      goldReward: stats.goldReward,
    };
    this.entities.set(id, monster);
    this.agentStates.set(id, {
      id,
      targetId: null,
      wanderTarget: null,
      lastThink: 0,
      behavior: "wander",
    });
  }

  // ---- Game tick ---------------------------------------------------------

  private _tick() {
    const now = Date.now();

    // Process player movement
    this._updatePlayer(now);

    // Update AI
    for (const [id, state] of this.agentStates) {
      const entity = this.entities.get(id);
      if (!entity || entity.hp <= 0) continue;
      if (entity.type === "monster") {
        this._updateMonster(entity as MonsterEntity, state, now);
      } else if (entity.type === "agent") {
        this._updateAgent(entity as AgentEntity, state, now);
      }
    }

    // Process respawns
    for (const entry of [...this.respawnQueue]) {
      if (now >= entry.at) {
        this.respawnQueue = this.respawnQueue.filter(e => e !== entry);
        const e = entry.entity;
        const pos = safeSpawn(this.tilemap);
        e.position = pos;
        e.hp = e.maxHp;
        e.isMoving = false;
        this.entities.set(e.id, e);
        if (e.type === "monster") {
          this.agentStates.set(e.id, {
            id: e.id,
            targetId: null,
            wanderTarget: null,
            lastThink: 0,
            behavior: "wander",
          });
        }
      }
    }

    // Broadcast snapshot
    this._emit({
      type: "state_snapshot",
      timestamp: now,
      entities: [...this.entities.values()],
      droppedItems: [],
      damages: [],
    });
  }

  // ---- Player update -----------------------------------------------------

  private _updatePlayer(now: number) {
    const player = this.entities.get(this.playerId) as PlayerEntity | undefined;
    if (!player) return;

    const { direction, position } = this.playerInput;

    if (direction) {
      const speed = SIM_CONFIG.MOVE_SPEED * SIM_CONFIG.TILE_SIZE / SIM_CONFIG.TICK_RATE;
      let nx = player.position.x;
      let ny = player.position.y;

      switch (direction) {
        case "up":    ny -= speed; break;
        case "down":  ny += speed; break;
        case "left":  nx -= speed; break;
        case "right": nx += speed; break;
      }

      nx = clamp(nx, SIM_CONFIG.TILE_SIZE, WORLD_PX_W - SIM_CONFIG.TILE_SIZE);
      ny = clamp(ny, SIM_CONFIG.TILE_SIZE, WORLD_PX_H - SIM_CONFIG.TILE_SIZE);

      if (isWalkable(this.tilemap, nx, ny)) {
        player.position = { x: nx, y: ny };
        player.direction = direction;
        player.isMoving = true;
      }
    } else if (position) {
      // Accept client position hint if within reasonable range
      const d = dist(player.position, position);
      if (d < SIM_CONFIG.TILE_SIZE * 8) {
        player.position = position;
      }
      player.isMoving = false;
    } else {
      player.isMoving = false;
    }

    this.entities.set(this.playerId, player);
  }

  // ---- Monster AI --------------------------------------------------------

  private _updateMonster(monster: MonsterEntity, state: AgentState, now: number) {
    const player = this.entities.get(this.playerId) as PlayerEntity | undefined;
    if (!player || player.hp <= 0) return;

    const d = dist(monster.position, player.position);

    if (d < SIM_CONFIG.MONSTER_AGGRO_RANGE) {
      // Aggro: move toward player
      state.targetId = this.playerId;
      const dx = player.position.x - monster.position.x;
      const dy = player.position.y - monster.position.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const speed = (MONSTER_TEMPLATES[monster.kind as MonsterKind]?.speed ?? 1.5) * SIM_CONFIG.TILE_SIZE / SIM_CONFIG.TICK_RATE;
        const nx = clamp(monster.position.x + (dx / len) * speed, SIM_CONFIG.TILE_SIZE, WORLD_PX_W - SIM_CONFIG.TILE_SIZE);
        const ny = clamp(monster.position.y + (dy / len) * speed, SIM_CONFIG.TILE_SIZE, WORLD_PX_H - SIM_CONFIG.TILE_SIZE);
        if (isWalkable(this.tilemap, nx, ny)) {
          monster.position = { x: nx, y: ny };
          monster.isMoving = true;
          monster.direction = Math.abs(dx) > Math.abs(dy)
            ? (dx > 0 ? "right" : "left")
            : (dy > 0 ? "down" : "up");
        }
      }

      // Attack if in range
      if (d < SIM_CONFIG.ATTACK_RANGE) {
        const lastAtk = this.lastAttack.get(monster.id) || 0;
        if (now - lastAtk >= SIM_CONFIG.ATTACK_COOLDOWN) {
          this.lastAttack.set(monster.id, now);
          this._applyDamage(monster, player, now);
        }
      }
    } else {
      // Wander
      state.targetId = null;
      this._wander(monster, state, now);
    }

    this.entities.set(monster.id, monster);
  }

  // ---- Agent AI ----------------------------------------------------------

  private _updateAgent(agent: AgentEntity, state: AgentState, now: number) {
    if (now - state.lastThink > SIM_CONFIG.AGENT_THINK_MS) {
      state.lastThink = now;

      if (state.behavior === "aggressive") {
        // Find nearest monster
        let nearest: Entity | null = null;
        let nearestDist = Infinity;
        for (const e of this.entities.values()) {
          if (e.type !== "monster" || e.hp <= 0) continue;
          const d = dist(agent.position, e.position);
          if (d < nearestDist) { nearestDist = d; nearest = e; }
        }
        state.targetId = nearest?.id || null;
      } else if (state.behavior === "farming") {
        // Wander toward weaker monsters
        const slimes = [...this.entities.values()].filter(e => e.type === "monster" && (e as MonsterEntity).kind === "slime" && e.hp > 0);
        if (slimes.length > 0) {
          const target = slimes[Math.floor(Math.random() * slimes.length)];
          state.targetId = target.id;
        }
      } else {
        // Wander randomly
        state.targetId = null;
      }
    }

    if (state.targetId) {
      const target = this.entities.get(state.targetId);
      if (!target || target.hp <= 0) {
        state.targetId = null;
      } else {
        const d = dist(agent.position, target.position);
        if (d < SIM_CONFIG.ATTACK_RANGE) {
          const lastAtk = this.lastAttack.get(agent.id) || 0;
          if (now - lastAtk >= SIM_CONFIG.ATTACK_COOLDOWN) {
            this.lastAttack.set(agent.id, now);
            this._applyDamage(agent, target, now);
          }
        } else {
          // Move toward target
          const dx = target.position.x - agent.position.x;
          const dy = target.position.y - agent.position.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            const speed = SIM_CONFIG.MOVE_SPEED * SIM_CONFIG.TILE_SIZE / SIM_CONFIG.TICK_RATE;
            const nx = clamp(agent.position.x + (dx / len) * speed, SIM_CONFIG.TILE_SIZE, WORLD_PX_W - SIM_CONFIG.TILE_SIZE);
            const ny = clamp(agent.position.y + (dy / len) * speed, SIM_CONFIG.TILE_SIZE, WORLD_PX_H - SIM_CONFIG.TILE_SIZE);
            if (isWalkable(this.tilemap, nx, ny)) {
              agent.position = { x: nx, y: ny };
              agent.isMoving = true;
              agent.direction = Math.abs(dx) > Math.abs(dy)
                ? (dx > 0 ? "right" : "left")
                : (dy > 0 ? "down" : "up");
            }
          }
        }
      }
    } else {
      this._wander(agent, state, now);
    }

    this.entities.set(agent.id, agent);
  }

  // ---- Wander helper -----------------------------------------------------

  private _wander(entity: Entity, state: AgentState, _now: number) {
    if (!state.wanderTarget || dist(entity.position, state.wanderTarget) < 20) {
      state.wanderTarget = safeSpawn(this.tilemap);
    }

    const dx = state.wanderTarget.x - entity.position.x;
    const dy = state.wanderTarget.y - entity.position.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 4) {
      const speed = SIM_CONFIG.MOVE_SPEED * 0.4 * SIM_CONFIG.TILE_SIZE / SIM_CONFIG.TICK_RATE;
      const nx = clamp(entity.position.x + (dx / len) * speed, SIM_CONFIG.TILE_SIZE, WORLD_PX_W - SIM_CONFIG.TILE_SIZE);
      const ny = clamp(entity.position.y + (dy / len) * speed, SIM_CONFIG.TILE_SIZE, WORLD_PX_H - SIM_CONFIG.TILE_SIZE);
      if (isWalkable(this.tilemap, nx, ny)) {
        entity.position = { x: nx, y: ny };
        entity.isMoving = true;
        entity.direction = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? "right" : "left")
          : (dy > 0 ? "down" : "up");
      } else {
        state.wanderTarget = null;
      }
    } else {
      entity.isMoving = false;
    }
  }

  // ---- Combat ------------------------------------------------------------

  private _applyDamage(attacker: Entity, target: Entity, now: number) {
    const isCrit = Math.random() < 0.1;
    const rawDmg = (attacker.atk || 10) * (isCrit ? 1.8 : 1);
    const dmg = Math.max(1, Math.round(rawDmg - (target.def || 0) * 0.5 + randRange(-3, 3)));

    target.hp = Math.max(0, target.hp - dmg);

    this._emit({
      type: "damage",
      event: {
        entityId: target.id,
        attackerId: attacker.id,
        damage: dmg,
        isCrit,
        timestamp: now,
      },
    });

    if (target.hp <= 0) {
      this._handleDeath(target, attacker);
    }
  }

  private _handleDeath(target: Entity, killer: Entity) {
    this._emit({
      type: "entity_died",
      entityId: target.id,
      killerId: killer.id,
      timestamp: Date.now(),
    });

    // XP/gold for player or agent killer
    if (target.type === "monster") {
      const stats = MONSTER_TEMPLATES[(target as MonsterEntity).kind as MonsterKind];
      if (killer.id === this.playerId) {
        const player = this.entities.get(this.playerId) as PlayerEntity;
        if (player) {
          player.xp += stats.xpReward;
          player.gold += stats.goldReward;
          if (player.xp >= player.xpToNext) {
            player.level++;
            player.xp -= player.xpToNext;
            player.xpToNext = Math.round(player.xpToNext * 1.4);
            player.maxHp += 15;
            player.hp = player.maxHp;
            player.atk += 4;
            player.def += 2;
          }
          this.entities.set(player.id, player);
        }
      }
    }

    // Remove dead entity, queue respawn
    this.entities.delete(target.id);
    this.agentStates.delete(target.id);

    if (target.type !== "player") {
      this.respawnQueue.push({ entity: target, at: Date.now() + SIM_CONFIG.RESPAWN_TIME });
    }
  }

  // ---- Emit --------------------------------------------------------------

  private _emit(msg: SimMessage) {
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch (e) {
        console.error("[GameSim] Listener error:", e);
      }
    }
  }
}
