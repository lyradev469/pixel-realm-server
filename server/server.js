const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8080 });

let players = new Map();

console.log("Game server running on ws://localhost:8080");

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2);

  players.set(id, {
    id,
    type: "player",
    name: "Player_" + id.slice(0, 4),
    position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
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
  });

  console.log("Player connected:", id);

  // Send initial state
  ws.send(JSON.stringify({
    type: "init",
    playerId: id,
    zoneId: "zone_start",
    entities: Array.from(players.values()),
    droppedItems: [],
    tilemap: generateMap(),
  }));

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "move") {
        const p = players.get(id);
        if (!p) return;
        if (data.position) p.position = data.position;
        if (data.direction) p.direction = data.direction;
        p.isMoving = Boolean(data.direction);
      }

      if (data.type === "set_username") {
        const p = players.get(id);
        if (!p) return;
        if (data.username) p.name = data.username;
        if (data.fid) p.fid = data.fid;
      }
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    players.delete(id);
    console.log("Player disconnected:", id);
  });
});

// Game loop — 15 tick/sec
setInterval(() => {
  const snapshot = JSON.stringify({
    type: "state_snapshot",
    timestamp: Date.now(),
    entities: Array.from(players.values()),
    droppedItems: [],
    damages: [],
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(snapshot);
    }
  });
}, 1000 / 15);

// Tilemap — matches TileMap type expected by client
function generateMap() {
  const W = 50, H = 50;
  const tileTypes = ["grass", "dirt", "path", "stone"];
  const tiles = [];
  for (let y = 0; y < H; y++) {
    tiles[y] = [];
    for (let x = 0; x < W; x++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) {
        tiles[y][x] = "wall";
      } else if (x === Math.floor(W / 2) || y === Math.floor(H / 2)) {
        tiles[y][x] = "path";
      } else {
        const n = Math.sin(x * 0.4) * Math.cos(y * 0.3);
        tiles[y][x] = n < -0.3 ? "water" : tileTypes[Math.floor(Math.abs(n) * tileTypes.length) % tileTypes.length];
      }
    }
  }
  return { width: W, height: H, tileSize: 32, tiles };
}
