/**
 * PIXEL REALM ONLINE — WebSocket Network Client
 *
 * ── STRICT SERVER-SIDE AUTHORITY PROTOCOL ────────────────────────────────────
 *
 *  Client → Server (the ONLY valid messages):
 *  ┌──────────────────┬──────────────────────────────────────────────────────┐
 *  │ player_input     │ { keys: string[], attackTarget?: string, seq: number }│
 *  │ pickup           │ { itemId: string }                                    │
 *  │ change_zone      │ { zoneId: string }                                    │
 *  │ set_username     │ { username: string, fid: number }                     │
 *  │ chat             │ { text: string }                                      │
 *  │ ping             │ { timestamp: number }                                 │
 *  └──────────────────┴──────────────────────────────────────────────────────┘
 *
 *  Server → Client (authoritative — never question these):
 *  ┌──────────────────┬──────────────────────────────────────────────────────┐
 *  │ init             │ Full zone snapshot on connect / zone change           │
 *  │ state_snapshot   │ Authoritative world state at 15 TPS                  │
 *  │ damage           │ Damage event from the server                          │
 *  │ entity_died      │ Entity death notification                             │
 *  │ player_joined    │ Another player entered the zone                       │
 *  │ player_left      │ Another player left the zone                          │
 *  │ chat             │ Broadcast chat message                                │
 *  │ item_dropped     │ New item on the ground                                │
 *  │ item_picked_up   │ Item was picked up                                    │
 *  │ pong             │ Keepalive response                                    │
 *  └──────────────────┴──────────────────────────────────────────────────────┘
 *
 *  ⚠️  NEVER SEND:
 *    ✗  position coordinates — server calculates all positions from input keys
 *    ✗  HP / stat values     — server owns all combat math
 *    ✗  damage amounts       — server calculates damage with anti-cheat formulas
 *
 *  Speed hacks are impossible because the server derives position from
 *  { keys } + MOVE_SPEED + TICK_RATE.  There is no client position to fake.
 */

import type {
  GameMessage,
  InitMessage,
  StateSnapshot,
  DamageMessage,
  EntityDiedMessage,
  Direction,
  EntityId,
} from "./types";

// ── Types ────────────────────────────────────────────────────────────────────

type MessageHandler<T> = (msg: T) => void;

type EventMap = {
  init:          InitMessage;
  state_snapshot:StateSnapshot;
  damage:        DamageMessage;
  entity_died:   EntityDiedMessage;
  player_joined: GameMessage;
  player_left:   GameMessage & { playerId: string };
  chat:          { type: "chat"; timestamp: number; playerId: string; text: string };
  item_dropped:  { type: "item_dropped"; droppedItem: unknown };
  item_picked_up:{ type: "item_picked_up"; itemId: string; playerId: string };
  connected:     null;
  disconnected:  null;
  error:         Error;
};

type EventKey = keyof EventMap;

// ── Input state ──────────────────────────────────────────────────────────────

export interface InputState {
  /** Keys currently held.  Server re-derives movement from these every tick. */
  keys:         Set<string>;
  attackTarget: EntityId | null;
}

// ── Client ───────────────────────────────────────────────────────────────────

export class GameNetworkClient {
  private ws:             WebSocket | null = null;
  private url:            string;
  private reconnectDelay  = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout>  | null = null;
  private pingInterval:   ReturnType<typeof setInterval> | null = null;
  private listeners       = new Map<EventKey, Set<MessageHandler<unknown>>>();
  private isDestroyed     = false;
  private inputSeq        = 0;

  // Player identity
  playerId: string | null = null;
  username: string | null = null;
  fid:      number | null = null;

  constructor(url: string) {
    this.url = url;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.isDestroyed) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("[Network] Connected to game server (authoritative mode)");
        this.reconnectDelay = 2000;
        this.emit("connected", null);

        if (this.username || this.fid) {
          this.sendRaw({ type: "set_username", username: this.username, fid: this.fid });
        }

        // Keep-alive ping every 15s
        this.pingInterval = setInterval(() => {
          this.sendRaw({ type: "ping", timestamp: Date.now() });
        }, 15_000);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as Record<string, unknown> & { type: string };
          this.handleMessage(msg);
        } catch {
          console.error("[Network] Parse error");
        }
      };

      this.ws.onclose = () => {
        console.log("[Network] Disconnected");
        this.clearPing();
        this.emit("disconnected", null);
        if (!this.isDestroyed) this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.emit("error", new Error("WebSocket error"));
      };
    } catch (e) {
      console.error("[Network] Connect failed:", e);
      if (!this.isDestroyed) this.scheduleReconnect();
    }
  }

  disconnect() {
    this.isDestroyed = true;
    this.clearPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  // ── Input API (replaces sendMove / sendAttack) ───────────────────────────

  /**
   * Send the current held-key set to the server.
   * Call this every time the local input state changes (key down / up).
   * The server re-applies physics from these keys on the next tick.
   */
  sendInput(input: InputState) {
    this.sendRaw({
      type:         "player_input",
      keys:         Array.from(input.keys),
      attackTarget: input.attackTarget ?? undefined,
      seq:          ++this.inputSeq,
    });
  }

  /**
   * Convenience: send a directional input (compatible with game-sim interface).
   * Pass null direction to stop movement.
   */
  sendMove(direction: Direction | null) {
    const keys: string[] = [];
    if (direction) keys.push(direction);
    this.sendRaw({ type: "player_input", keys, seq: ++this.inputSeq });
  }

  /** Request an attack on a target entity. */
  sendAttack(targetId: EntityId) {
    this.sendRaw({ type: "player_input", keys: [], attackTarget: targetId, seq: ++this.inputSeq });
  }

  /** Request item pickup from the ground. */
  sendPickup(droppedItemId: string) {
    this.sendRaw({ type: "pickup", itemId: droppedItemId });
  }

  /** Request travel to another zone (server validates portal proximity). */
  sendChangeZone(zoneId: string) {
    this.sendRaw({ type: "change_zone", zoneId });
  }

  /** Send a chat message. */
  sendChat(text: string) {
    this.sendRaw({ type: "chat", timestamp: Date.now(), text });
  }

  /** Set Farcaster identity (sent on connect + when identity changes). */
  setIdentity(username: string | null, fid: number | null) {
    this.username = username;
    this.fid      = fid;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendRaw({ type: "set_username", username, fid });
    }
  }

  // ── Event emitter ────────────────────────────────────────────────────────

  on<K extends EventKey>(event: K, handler: MessageHandler<EventMap[K]>) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler as MessageHandler<unknown>);
    return () => this.off(event, handler);
  }

  off<K extends EventKey>(event: K, handler: MessageHandler<EventMap[K]>) {
    this.listeners.get(event)?.delete(handler as MessageHandler<unknown>);
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private handleMessage(msg: Record<string, unknown> & { type: string }) {
    switch (msg.type) {
      case "init":
        this.playerId = msg.playerId as string;
        this.emit("init", msg as unknown as InitMessage);
        break;
      case "state_snapshot":
        this.emit("state_snapshot", msg as unknown as StateSnapshot);
        break;
      case "damage":
        this.emit("damage", msg as unknown as DamageMessage);
        break;
      case "entity_died":
        this.emit("entity_died", msg as unknown as EntityDiedMessage);
        break;
      case "player_joined":
        this.emit("player_joined", msg as unknown as GameMessage);
        break;
      case "player_left":
        this.emit("player_left", msg as unknown as EventMap["player_left"]);
        break;
      case "chat":
        this.emit("chat", msg as unknown as EventMap["chat"]);
        break;
      case "item_dropped":
        this.emit("item_dropped", msg as unknown as EventMap["item_dropped"]);
        break;
      case "item_picked_up":
        this.emit("item_picked_up", msg as unknown as EventMap["item_picked_up"]);
        break;
      case "pong":
        // handled externally via timestamp diff
        break;
    }
  }

  private emit<K extends EventKey>(event: K, data: EventMap[K]) {
    this.listeners.get(event)?.forEach((handler) => {
      try { handler(data as unknown); }
      catch (e) { console.error(`[Network] Handler error (${event}):`, e); }
    });
  }

  private sendRaw(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(data)); }
      catch (e) { console.error("[Network] Send error:", e); }
    }
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15_000);
    }, this.reconnectDelay);
  }

  private clearPing() {
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
  }
}
