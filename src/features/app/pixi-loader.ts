/**
 * PIXEL REALM ONLINE — Asset Loader & Procedural Asset Generator
 *
 * Since we use PixiJS via CDN (no npm), all assets are generated procedurally
 * using Canvas 2D API to create pixel-art style sprites at runtime.
 * This eliminates ALL external runtime asset dependencies.
 *
 * Every sprite is 32x32 or 64x64 pixels in Ragnarok-inspired palette.
 */

export interface SpriteSheet {
  canvas: HTMLCanvasElement;
  frameWidth: number;
  frameHeight: number;
  frames: { [key: string]: { x: number; y: number } };
}

// ---- Color Palette (Ragnarok-inspired soft pastels) --------------------

const PALETTE = {
  // Characters
  skinLight: "#f5c89a",
  skinMid: "#d4956a",
  hairBrown: "#6b3a2a",
  hairBlond: "#d4a017",
  clothBlue: "#4a7fb5",
  clothRed: "#c94040",
  clothGreen: "#4a8c4a",
  armorGold: "#d4a017",
  armorSilver: "#a0a0b0",
  swordBlade: "#d0d8e8",
  swordHilt: "#8b6914",

  // Terrain
  grassGreen: "#5a9a5a",
  grassLight: "#7ac47a",
  dirtBrown: "#9a7040",
  pathTan: "#c4a35a",
  waterBlue: "#2a6a9a",
  waterLight: "#4a9ac4",
  stoneGray: "#7a7a8a",
  wallDark: "#3a3a4a",

  // Monsters
  slimePink: "#e07ab0",
  slimeLight: "#f0a0d0",
  goblinGreen: "#5a8a3a",
  goblinDark: "#3a5a1a",
  skeletonWhite: "#e8e0d0",
  skeletonDark: "#b0a890",
  wolfGray: "#8a8a9a",
  wolfDark: "#5a5a6a",

  // UI
  uiBeige: "#f5e6c8",
  uiGold: "#d4a017",
  uiDark: "#2a1a0a",
  hpRed: "#dc2626",
  xpBlue: "#2563eb",
  mpBlue: "#7c3aed",

  // FX
  hitYellow: "#ffdd44",
  slashWhite: "#ffffff",
  critOrange: "#ff6600",

  // Outlines
  outline: "#1a1a2a",
  shadow: "rgba(0,0,0,0.3)",
};

// ---- Canvas Helpers ----------------------------------------------------

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return canvas.getContext("2d")!;
}

function px(c: CanvasRenderingContext2D, x: number, y: number, color: string, size = 2) {
  c.fillStyle = color;
  c.fillRect(x, y, size, size);
}

function rect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}

function outline(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  c.strokeStyle = PALETTE.outline;
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

// ---- Character Sprite (4 directions × 2 frames) -----------------------
// Sheet: 8 frames, each 32×32

function drawCharacterFrame(
  c: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  dir: "down" | "left" | "right" | "up",
  frame: 0 | 1,
  color: string
) {
  const S = 2; // pixel scale
  const W = 32;
  const H = 32;

  // Clear
  c.clearRect(ox, oy, W, H);

  // Shadow
  c.fillStyle = PALETTE.shadow;
  c.beginPath();
  c.ellipse(ox + 16, oy + 28, 8, 3, 0, 0, Math.PI * 2);
  c.fill();

  // Body (torso)
  rect(c, ox + 11, oy + 14, 10, 10, color);
  outline(c, ox + 11, oy + 14, 10, 10);

  // Legs (animated)
  const legOff = frame === 1 ? 2 : 0;
  if (dir === "down" || dir === "up") {
    rect(c, ox + 11, oy + 24, 4, 4 + legOff, color === PALETTE.clothBlue ? PALETTE.hairBrown : PALETTE.clothBlue);
    rect(c, ox + 17, oy + 24, 4, 4 + (legOff === 0 ? 2 : 0), color === PALETTE.clothBlue ? PALETTE.hairBrown : PALETTE.clothBlue);
  } else {
    rect(c, ox + 11, oy + 24, 10, 4, color === PALETTE.clothBlue ? PALETTE.hairBrown : PALETTE.clothBlue);
  }

  // Arms
  if (dir === "down") {
    rect(c, ox + 7, oy + 14, 4, 8, PALETTE.skinLight);
    rect(c, ox + 21, oy + 14, 4, 8, PALETTE.skinLight);
    outline(c, ox + 7, oy + 14, 4, 8);
    outline(c, ox + 21, oy + 14, 4, 8);
  } else if (dir === "left") {
    rect(c, ox + 7, oy + 14, 4, 8, PALETTE.skinLight);
    outline(c, ox + 7, oy + 14, 4, 8);
  } else if (dir === "right") {
    rect(c, ox + 21, oy + 14, 4, 8, PALETTE.skinLight);
    outline(c, ox + 21, oy + 14, 4, 8);
  }

  // Head
  rect(c, ox + 10, oy + 6, 12, 10, PALETTE.skinLight);
  outline(c, ox + 10, oy + 6, 12, 10);

  // Hair
  rect(c, ox + 10, oy + 4, 12, 4, PALETTE.hairBrown);
  outline(c, ox + 10, oy + 4, 12, 4);

  // Eyes
  if (dir !== "up") {
    px(c, ox + 13, oy + 9, PALETTE.outline);
    px(c, ox + 17, oy + 9, PALETTE.outline);
  }

  // Weapon (sword)
  if (dir === "right" || dir === "down") {
    rect(c, ox + 23, oy + 14, 2, 12, PALETTE.swordBlade);
    rect(c, ox + 21, oy + 18, 6, 2, PALETTE.swordHilt);
    outline(c, ox + 23, oy + 14, 2, 12);
  } else if (dir === "left") {
    rect(c, ox + 7, oy + 14, 2, 12, PALETTE.swordBlade);
    rect(c, ox + 5, oy + 18, 6, 2, PALETTE.swordHilt);
    outline(c, ox + 7, oy + 14, 2, 12);
  }
}

function generateCharacterSheet(color: string = PALETTE.clothBlue): HTMLCanvasElement {
  // 8 frames: down0, down1, left0, left1, right0, right1, up0, up1
  const canvas = createCanvas(256, 32);
  const c = ctx(canvas);
  const dirs: Array<"down" | "left" | "right" | "up"> = ["down", "left", "right", "up"];
  dirs.forEach((dir, i) => {
    drawCharacterFrame(c, i * 64, 0, dir, 0, color);
    drawCharacterFrame(c, i * 64 + 32, 0, dir, 1, color);
  });
  return canvas;
}

// ---- Monster Sprites ---------------------------------------------------

function generateSlimeSheet(): HTMLCanvasElement {
  const canvas = createCanvas(64, 32);
  const c = ctx(canvas);

  // Frame 0: idle
  rect(c, 2, 12, 28, 18, PALETTE.slimePink);
  rect(c, 6, 8, 20, 10, PALETTE.slimePink);
  rect(c, 10, 4, 12, 8, PALETTE.slimeLight);
  outline(c, 2, 8, 28, 22);
  px(c, 10, 13, PALETTE.outline, 3);
  px(c, 19, 13, PALETTE.outline, 3);
  // Shine
  rect(c, 12, 6, 6, 4, PALETTE.slimeLight);

  // Frame 1: squished
  rect(c, 34, 16, 28, 14, PALETTE.slimePink);
  rect(c, 36, 12, 24, 8, PALETTE.slimePink);
  rect(c, 40, 8, 16, 8, PALETTE.slimeLight);
  outline(c, 34, 10, 28, 20);
  px(c, 42, 15, PALETTE.outline, 3);
  px(c, 51, 15, PALETTE.outline, 3);

  return canvas;
}

function generateGoblinSheet(): HTMLCanvasElement {
  const canvas = createCanvas(64, 32);
  const c = ctx(canvas);

  [0, 32].forEach((ox, fi) => {
    const legOff = fi === 1 ? 2 : 0;
    // Body
    rect(c, ox + 9, 12, 14, 12, PALETTE.goblinGreen);
    outline(c, ox + 9, 12, 14, 12);
    // Head
    rect(c, ox + 8, 4, 16, 12, PALETTE.goblinGreen);
    outline(c, ox + 8, 4, 16, 12);
    // Ears
    rect(c, ox + 4, 6, 5, 4, PALETTE.goblinGreen);
    rect(c, ox + 23, 6, 5, 4, PALETTE.goblinGreen);
    // Eyes
    px(c, ox + 12, 8, "#ff2222", 3);
    px(c, ox + 18, 8, "#ff2222", 3);
    // Legs
    rect(c, ox + 9, 24, 5, 6 + legOff, PALETTE.goblinDark);
    rect(c, ox + 18, 24, 5, 6 + (legOff === 0 ? 2 : 0), PALETTE.goblinDark);
    // Club
    rect(c, ox + 23, 14, 4, 12, PALETTE.hairBrown);
    rect(c, ox + 21, 12, 8, 5, PALETTE.stoneGray);
    outline(c, ox + 23, 14, 4, 12);
  });

  return canvas;
}

function generateSkeletonSheet(): HTMLCanvasElement {
  const canvas = createCanvas(64, 32);
  const c = ctx(canvas);

  [0, 32].forEach((ox, fi) => {
    const boneColor = PALETTE.skeletonWhite;
    const darkColor = PALETTE.skeletonDark;
    // Skull
    rect(c, ox + 9, 2, 14, 12, boneColor);
    outline(c, ox + 9, 2, 14, 12);
    // Eye sockets
    px(c, ox + 11, 6, darkColor, 4);
    px(c, ox + 18, 6, darkColor, 4);
    // Ribcage
    rect(c, ox + 10, 14, 12, 10, boneColor);
    for (let r = 0; r < 3; r++) {
      rect(c, ox + 10, 14 + r * 3, 12, 1, darkColor);
    }
    outline(c, ox + 10, 14, 12, 10);
    // Spine
    rect(c, ox + 14, 24, 4, 8, boneColor);
    // Arms
    rect(c, ox + 6, 14, 4, 10, boneColor);
    rect(c, ox + 22, 14, 4, 10, boneColor);
    // Legs
    const legOff = fi === 1 ? 2 : 0;
    rect(c, ox + 10, 28, 4, 4 + legOff, boneColor);
    rect(c, ox + 18, 28, 4, 4 + (legOff === 0 ? 2 : 0), boneColor);
  });

  return canvas;
}

function generateWolfSheet(): HTMLCanvasElement {
  const canvas = createCanvas(64, 32);
  const c = ctx(canvas);

  [0, 32].forEach((ox, fi) => {
    const legOff = fi === 1 ? 2 : 0;
    // Body
    rect(c, ox + 6, 12, 20, 12, PALETTE.wolfGray);
    outline(c, ox + 6, 12, 20, 12);
    // Head
    rect(c, ox + 20, 8, 10, 10, PALETTE.wolfGray);
    rect(c, ox + 26, 12, 6, 6, PALETTE.wolfDark); // snout
    outline(c, ox + 20, 8, 10, 10);
    // Ears
    rect(c, ox + 22, 4, 4, 5, PALETTE.wolfDark);
    // Eye
    px(c, ox + 23, 11, "#ffaa00", 2);
    // Tail
    rect(c, ox + 2, 8, 5, 5, PALETTE.wolfGray);
    // Legs
    rect(c, ox + 8, 24, 4, 6 + legOff, PALETTE.wolfDark);
    rect(c, ox + 14, 24, 4, 6 + (legOff === 0 ? 2 : 0), PALETTE.wolfDark);
    rect(c, ox + 20, 24, 4, 6 + legOff, PALETTE.wolfDark);
    rect(c, ox + 26, 24, 4, 6 + (legOff === 0 ? 2 : 0), PALETTE.wolfDark);
  });

  return canvas;
}

// ---- Tileset (4×4 = 16 tiles, each 32×32) ------------------------------

function generateTileset(): HTMLCanvasElement {
  const TILE = 32;
  const canvas = createCanvas(TILE * 4, TILE * 4);
  const c = ctx(canvas);

  function drawGrass(ox: number, oy: number) {
    rect(c, ox, oy, TILE, TILE, PALETTE.grassGreen);
    // Variation spots
    for (let i = 0; i < 8; i++) {
      const sx = ox + (i * 7 + 3) % 28;
      const sy = oy + (i * 11 + 5) % 28;
      rect(c, sx, sy, 2, 2, PALETTE.grassLight);
    }
  }

  function drawDirt(ox: number, oy: number) {
    rect(c, ox, oy, TILE, TILE, PALETTE.dirtBrown);
    for (let i = 0; i < 6; i++) {
      const sx = ox + (i * 9 + 2) % 28;
      const sy = oy + (i * 13 + 3) % 28;
      rect(c, sx, sy, 3, 2, "#7a5030");
    }
  }

  function drawPath(ox: number, oy: number) {
    rect(c, ox, oy, TILE, TILE, PALETTE.pathTan);
    // Stone pattern
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 2; col++) {
        const sx = ox + col * 14 + (r % 2 === 0 ? 0 : 7) + 2;
        const sy = oy + r * 10 + 2;
        rect(c, sx, sy, 12, 8, "#b8964a");
        outline(c, sx, sy, 12, 8);
      }
    }
  }

  function drawWater(ox: number, oy: number) {
    rect(c, ox, oy, TILE, TILE, PALETTE.waterBlue);
    // Wave lines
    for (let r = 0; r < 4; r++) {
      rect(c, ox + 2, oy + r * 8 + 2, 28, 2, PALETTE.waterLight);
    }
    rect(c, ox, oy, TILE, TILE, "rgba(30,80,140,0.3)"); // tint
  }

  function drawStone(ox: number, oy: number) {
    rect(c, ox, oy, TILE, TILE, PALETTE.stoneGray);
    // Crack lines
    c.strokeStyle = "#6a6a7a";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(ox + 5, oy + 5);
    c.lineTo(ox + 15, oy + 20);
    c.moveTo(ox + 20, oy + 8);
    c.lineTo(ox + 28, oy + 25);
    c.stroke();
  }

  function drawWall(ox: number, oy: number) {
    rect(c, ox, oy, TILE, TILE, PALETTE.wallDark);
    for (let r = 0; r < 4; r++) {
      for (let col = 0; col < 2; col++) {
        const sx = ox + col * 14 + (r % 2 === 0 ? 0 : 7) + 1;
        const sy = oy + r * 8 + 1;
        rect(c, sx, sy, 12, 6, "#4a4a5a");
        outline(c, sx, sy, 12, 6);
      }
    }
  }

  // Row 0: grass, dirt, path, water
  drawGrass(0, 0);
  drawDirt(TILE, 0);
  drawPath(TILE * 2, 0);
  drawWater(TILE * 3, 0);
  // Row 1: stone, wall, + variants
  drawStone(0, TILE);
  drawWall(TILE, TILE);
  drawGrass(TILE * 2, TILE); // grass alt
  drawDirt(TILE * 3, TILE);  // dirt alt

  return canvas;
}

// ---- Environment Objects -----------------------------------------------

function generateEnvironmentSheet(): HTMLCanvasElement {
  // Tree, Rock, Bush, Building (each 32×32)
  const canvas = createCanvas(128, 32);
  const c = ctx(canvas);

  // Tree
  rect(c, 12, 20, 8, 12, PALETTE.hairBrown);
  outline(c, 12, 20, 8, 12);
  rect(c, 4, 2, 24, 22, "#3a7a3a");
  rect(c, 8, 6, 16, 16, "#4a9a4a");
  outline(c, 4, 2, 24, 22);

  // Rock
  rect(c, 36, 14, 20, 14, PALETTE.stoneGray);
  rect(c, 34, 18, 24, 10, PALETTE.stoneGray);
  outline(c, 34, 14, 24, 18);
  // highlight
  rect(c, 37, 16, 6, 4, "#9a9aaa");

  // Bush
  rect(c, 66, 16, 28, 14, "#3a8a3a");
  rect(c, 70, 12, 20, 10, "#4a9a4a");
  outline(c, 66, 12, 28, 18);
  // Berries
  px(c, 72, 16, "#cc2244", 3);
  px(c, 82, 18, "#cc2244", 3);

  // Building (small house)
  rect(c, 98, 14, 28, 18, PALETTE.uiBeige);
  outline(c, 98, 14, 28, 18);
  // Roof
  c.fillStyle = PALETTE.clothRed;
  c.beginPath();
  c.moveTo(96, 14);
  c.lineTo(112, 2);
  c.lineTo(128, 14);
  c.closePath();
  c.fill();
  c.strokeStyle = PALETTE.outline;
  c.stroke();
  // Door
  rect(c, 108, 22, 8, 10, PALETTE.hairBrown);
  outline(c, 108, 22, 8, 10);

  return canvas;
}

// ---- UI Panel ----------------------------------------------------------

function generateUIPanel(w: number, h: number): HTMLCanvasElement {
  const canvas = createCanvas(w, h);
  const c = ctx(canvas);

  // Background
  c.fillStyle = "rgba(42, 26, 10, 0.92)";
  c.fillRect(0, 0, w, h);

  // Border (double border Ragnarok style)
  c.strokeStyle = PALETTE.uiGold;
  c.lineWidth = 2;
  c.strokeRect(2, 2, w - 4, h - 4);
  c.strokeStyle = "#8b6914";
  c.lineWidth = 1;
  c.strokeRect(4, 4, w - 8, h - 8);

  // Corner ornaments
  const corners = [[2, 2], [w - 10, 2], [2, h - 10], [w - 10, h - 10]];
  corners.forEach(([cx, cy]) => {
    rect(c, cx, cy, 8, 8, PALETTE.uiGold);
    rect(c, cx + 2, cy + 2, 4, 4, "#8b6914");
  });

  return canvas;
}

// ---- FX Sprites --------------------------------------------------------

function generateFXSheet(): HTMLCanvasElement {
  const canvas = createCanvas(96, 32);
  const c = ctx(canvas);

  // Hit spark (frame 0)
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = 12;
    c.strokeStyle = PALETTE.hitYellow;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(16 + Math.cos(angle) * 4, 16 + Math.sin(angle) * 4);
    c.lineTo(16 + Math.cos(angle) * r, 16 + Math.sin(angle) * r);
    c.stroke();
  }
  px(c, 14, 14, PALETTE.slashWhite, 4);

  // Slash arc (frame 1)
  c.strokeStyle = PALETTE.slashWhite;
  c.lineWidth = 3;
  c.beginPath();
  c.arc(48, 16, 12, -Math.PI * 0.3, Math.PI * 0.3);
  c.stroke();
  c.lineWidth = 1;
  c.strokeStyle = PALETTE.hitYellow;
  c.beginPath();
  c.arc(48, 16, 10, -Math.PI * 0.3, Math.PI * 0.3);
  c.stroke();

  // Critical hit star (frame 2)
  c.fillStyle = PALETTE.critOrange;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? 14 : 6;
    c.beginPath();
    c.arc(80 + Math.cos(angle) * r, 16 + Math.sin(angle) * r, 2, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = PALETTE.hitYellow;
  c.beginPath();
  c.arc(80, 16, 5, 0, Math.PI * 2);
  c.fill();

  return canvas;
}

// ---- Item Icons --------------------------------------------------------

function generateItemSheet(): HTMLCanvasElement {
  const canvas = createCanvas(96, 32);
  const c = ctx(canvas);

  // Sword (0)
  rect(c, 14, 2, 4, 24, PALETTE.swordBlade);
  rect(c, 8, 14, 16, 4, PALETTE.swordHilt);
  rect(c, 14, 24, 4, 6, PALETTE.hairBrown);
  outline(c, 14, 2, 4, 24);
  outline(c, 8, 14, 16, 4);

  // Potion (1)
  rect(c, 44, 12, 12, 16, "#4488ff");
  rect(c, 46, 8, 8, 6, PALETTE.stoneGray);
  rect(c, 47, 4, 6, 6, "#88aaff");
  outline(c, 44, 8, 12, 20);
  // Liquid
  rect(c, 45, 16, 10, 8, "#2266dd");
  // Cork
  rect(c, 46, 6, 8, 3, PALETTE.hairBrown);

  // Gold coin (2)
  c.fillStyle = PALETTE.armorGold;
  c.beginPath();
  c.arc(80, 16, 12, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = PALETTE.outline;
  c.lineWidth = 1.5;
  c.stroke();
  c.fillStyle = "#a07810";
  c.beginPath();
  c.arc(80, 16, 8, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = PALETTE.armorGold;
  c.font = "bold 10px monospace";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("G", 80, 17);

  return canvas;
}

// ---- Agent Color Table -------------------------------------------------

const AGENT_COLORS = [
  PALETTE.clothBlue,
  PALETTE.clothRed,
  PALETTE.clothGreen,
  "#7a4ab0",  // purple
  "#b07a4a",  // orange
  "#4ab07a",  // teal
  "#b04a7a",  // magenta
  "#7ab04a",  // yellow-green
];

// ---- Main Export -------------------------------------------------------

export interface GameAssets {
  playerSheet: HTMLCanvasElement;
  agentSheets: HTMLCanvasElement[];
  monsterSheets: {
    slime: HTMLCanvasElement;
    goblin: HTMLCanvasElement;
    skeleton: HTMLCanvasElement;
    wolf: HTMLCanvasElement;
  };
  tileset: HTMLCanvasElement;
  environment: HTMLCanvasElement;
  fxSheet: HTMLCanvasElement;
  itemSheet: HTMLCanvasElement;
  uiPanel: (w: number, h: number) => HTMLCanvasElement;
}

export function generateAssets(): GameAssets {
  return {
    playerSheet: generateCharacterSheet(PALETTE.clothBlue),
    agentSheets: AGENT_COLORS.map(color => generateCharacterSheet(color)),
    monsterSheets: {
      slime: generateSlimeSheet(),
      goblin: generateGoblinSheet(),
      skeleton: generateSkeletonSheet(),
      wolf: generateWolfSheet(),
    },
    tileset: generateTileset(),
    environment: generateEnvironmentSheet(),
    fxSheet: generateFXSheet(),
    itemSheet: generateItemSheet(),
    uiPanel: generateUIPanel,
  };
}

// ---- Sprite Metadata ---------------------------------------------------

export const SPRITE_META = {
  character: {
    frameWidth: 32,
    frameHeight: 32,
    frames: {
      down_0: { x: 0, y: 0 },
      down_1: { x: 32, y: 0 },
      left_0: { x: 64, y: 0 },
      left_1: { x: 96, y: 0 },
      right_0: { x: 128, y: 0 },
      right_1: { x: 160, y: 0 },
      up_0: { x: 192, y: 0 },
      up_1: { x: 224, y: 0 },
    },
  },
  monster: {
    frameWidth: 32,
    frameHeight: 32,
    frames: {
      idle: { x: 0, y: 0 },
      walk: { x: 32, y: 0 },
    },
  },
  tile: {
    frameWidth: 32,
    frameHeight: 32,
    frames: {
      grass: { x: 0, y: 0 },
      dirt: { x: 32, y: 0 },
      path: { x: 64, y: 0 },
      water: { x: 96, y: 0 },
      stone: { x: 0, y: 32 },
      wall: { x: 32, y: 32 },
    },
  },
  environment: {
    frameWidth: 32,
    frameHeight: 32,
    frames: {
      tree: { x: 0, y: 0 },
      rock: { x: 32, y: 0 },
      bush: { x: 64, y: 0 },
      building: { x: 96, y: 0 },
    },
  },
  fx: {
    frameWidth: 32,
    frameHeight: 32,
    frames: {
      hit: { x: 0, y: 0 },
      slash: { x: 32, y: 0 },
      crit: { x: 64, y: 0 },
    },
  },
  items: {
    frameWidth: 32,
    frameHeight: 32,
    frames: {
      sword: { x: 0, y: 0 },
      potion: { x: 32, y: 0 },
      gold: { x: 64, y: 0 },
    },
  },
};
