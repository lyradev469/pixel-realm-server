/**
 * PIXEL REALM ONLINE — WebSocket Network Client
 *
 * - Connects to game server via WebSocket
 * - Handles all incoming messages
 * - Sends player input (move, attack)
 * - Reconnects automatically on disconnect
 * - Exposes typed event emitter interface
 */

import type {
  GameMessage,
  InitMessage,
  StateSnapshot,
  DamageMessage,
  EntityDiedMessage,
  Direction,
  WorldPosition,
  EntityId,
} from "./types";

type MessageHandler<T> = (msg: T) => void;

type EventMap = {
  init: InitMessage;
  state_snapshot: StateSnapshot;
  damage: DamageMessage;
  entity_died: EntityDiedMessage;
  player_joined: GameMessage;
  player_left: GameMessage & { playerId: string };
  chat: { type: "chat"; timestamp: number; playerId: string; text: string };
  connected: null;
  disconnected: null;
  error: Error;
};

type EventKey = keyof EventMap;

export class GameNetworkClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectDelay = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Map<EventKey, Set<MessageHandler<unknown>>>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;

  // Player identity
  playerId: string | null = null;
  username: string | null = null;
  fid: number | null = null;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.isDestroyed) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("[Network] Connected to game server");
        this.reconnectDelay = 2000;
        this.emit("connected", null);

        // Send identity if we have it
        if (this.username || this.fid) {
          this.sendRaw({ type: "set_username", username: this.username, fid: this.fid });
        }

        // Ping every 15s to keep alive
        this.pingInterval = setInterval(() => {
          this.sendRaw({ type: "ping", timestamp: Date.now() });
        }, 15000);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as GameMessage & {
            type: string;
            playerId?: string;
            text?: string;
          };
          this.handleMessage(msg);
        } catch (e) {
          console.error("[Network] Parse error:", e);
        }
      };

      this.ws.onclose = () => {
        console.log("[Network] Disconnected");
        this.clearPing();
        this.emit("disconnected", null);
        if (!this.isDestroyed) this.scheduleReconnect();
      };

      this.ws.onerror = (event) => {
        console.error("[Network] WebSocket error");
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

  sendMove(direction: Direction | null, position: WorldPosition) {
    this.sendRaw({
      type: "move",
      timestamp: Date.now(),
      playerId: this.playerId,
      direction,
      position,
    });
  }

  sendAttack(targetId: EntityId) {
    this.sendRaw({
      type: "attack",
      timestamp: Date.now(),
      playerId: this.playerId,
      targetId,
    });
  }

  sendChat(text: string) {
    this.sendRaw({
      type: "chat",
      timestamp: Date.now(),
      text,
    });
  }

  setIdentity(username: string | null, fid: number | null) {
    this.username = username;
    this.fid = fid;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendRaw({ type: "set_username", username, fid });
    }
  }

  on<K extends EventKey>(event: K, handler: MessageHandler<EventMap[K]>) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as MessageHandler<unknown>);
    return () => this.off(event, handler);
  }

  off<K extends EventKey>(event: K, handler: MessageHandler<EventMap[K]>) {
    this.listeners.get(event)?.delete(handler as MessageHandler<unknown>);
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ---- Private -------------------------------------------------------

  private handleMessage(msg: GameMessage & { type: string; playerId?: string; text?: string }) {
    switch (msg.type) {
      case "init":
        this.playerId = (msg as InitMessage).playerId;
        this.emit("init", msg as InitMessage);
        break;
      case "state_snapshot":
        this.emit("state_snapshot", msg as StateSnapshot);
        break;
      case "damage":
        this.emit("damage", msg as DamageMessage);
        break;
      case "entity_died":
        this.emit("entity_died", msg as EntityDiedMessage);
        break;
      case "player_joined":
        this.emit("player_joined", msg);
        break;
      case "player_left":
        this.emit("player_left", msg as EventMap["player_left"]);
        break;
      case "chat":
        this.emit("chat", msg as EventMap["chat"]);
        break;
    }
  }

  private emit<K extends EventKey>(event: K, data: EventMap[K]) {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(data as unknown);
      } catch (e) {
        console.error(`[Network] Handler error for ${event}:`, e);
      }
    });
  }

  private sendRaw(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (e) {
        console.error("[Network] Send error:", e);
      }
    }
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      console.log(`[Network] Reconnecting in ${this.reconnectDelay}ms...`);
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15000);
    }, this.reconnectDelay);
  }

  private clearPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
