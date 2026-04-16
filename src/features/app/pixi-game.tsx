"use client";

/**
 * PIXEL REALM ONLINE — PixiJS WebGL Game Engine
 *
 * Uses PixiJS v7 via CDN (window.PIXI).
 * - Tilemap rendering (chunked, culled)
 * - Animated entity sprites (player, agents, monsters)
 * - Smooth interpolated camera follow
 * - Y-based depth sorting
 * - Floating damage text
 * - FX particles
 * - Drop shadow under entities
 */

import { useEffect, useRef, useCallback } from "react";
import type {
  Entity,
  TileMap,
  TileType,
  Direction,
  FloatingText,
  DroppedItem,
  DamageEvent,
  WorldPosition,
  EntityId,
} from "./types";
import type { GameAssets } from "./pixi-loader";
import { ZONE_TILEMAPS } from "./zones";
import type { ZoneKey } from "./zones";

// ---- PixiJS CDN Types (window.PIXI) ------------------------------------

declare global {
  interface Window {
    PIXI: {
      Application: new (opts: object) => PIXIApp;
      Container: new () => PIXIContainer;
      Graphics: new () => PIXIGraphics;
      Text: new (text: string, style?: object) => PIXIText;
      Texture: { from: (canvas: HTMLCanvasElement) => PIXITexture; WHITE: PIXITexture };
      Sprite: new (texture?: PIXITexture) => PIXISprite;
      AnimatedSprite: new (textures: PIXITexture[]) => PIXIAnimSprite;
      RenderTexture: { create: (opts: object) => PIXIRenderTexture };
      Rectangle: new (x: number, y: number, w: number, h: number) => PIXIRectangle;
      utils: { skipHello: () => void };
      Loader: { shared: { add: (id: string, url: string) => unknown; load: (cb: () => void) => void } };
    };
  }
}

interface PIXIApp {
  view: HTMLCanvasElement;
  stage: PIXIContainer;
  renderer: { resize: (w: number, h: number) => void; render: (c: PIXIContainer) => void };
  ticker: { add: (fn: (delta: number) => void) => void; remove: (fn: (delta: number) => void) => void };
  destroy: (removeView?: boolean) => void;
  screen: { width: number; height: number };
}

interface PIXIContainer {
  addChild: (...objs: PIXIObject[]) => PIXIObject;
  removeChild: (...objs: PIXIObject[]) => PIXIObject;
  children: PIXIObject[];
  x: number;
  y: number;
  alpha: number;
  visible: boolean;
  sortChildren: () => void;
  sortableChildren: boolean;
  zIndex: number;
  destroy: (opts?: object) => void;
  interactive?: boolean;
  on?: (event: string, fn: (e: unknown) => void) => void;
}

interface PIXIObject {
  x: number;
  y: number;
  zIndex: number;
  visible: boolean;
  alpha: number;
  destroy: (opts?: object) => void;
  scale?: { set: (v: number) => void; x: number; y: number };
}

interface PIXIGraphics extends PIXIObject {
  beginFill: (color: number, alpha?: number) => PIXIGraphics;
  endFill: () => PIXIGraphics;
  drawRect: (x: number, y: number, w: number, h: number) => PIXIGraphics;
  drawCircle: (x: number, y: number, r: number) => PIXIGraphics;
  drawEllipse: (x: number, y: number, rx: number, ry: number) => PIXIGraphics;
  lineStyle: (w: number, color: number, alpha?: number) => PIXIGraphics;
  moveTo: (x: number, y: number) => PIXIGraphics;
  lineTo: (x: number, y: number) => PIXIGraphics;
  arc: (x: number, y: number, r: number, s: number, e: number) => PIXIGraphics;
  clear: () => PIXIGraphics;
  closePath: () => PIXIGraphics;
}

interface PIXITexture {
  frame?: PIXIRectangle;
  clone: () => PIXITexture;
}

interface PIXIRenderTexture extends PIXITexture {}

interface PIXIRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PIXISprite extends PIXIObject {
  texture: PIXITexture;
  width: number;
  height: number;
  anchor: { set: (x: number, y?: number) => void };
  tint: number;
}

interface PIXIAnimSprite extends PIXIObject {
  textures: PIXITexture[];
  currentFrame: number;
  gotoAndPlay: (frame: number) => void;
  gotoAndStop: (frame: number) => void;
  play: () => void;
  stop: () => void;
  animationSpeed: number;
  loop: boolean;
  onComplete: (() => void) | null;
  anchor: { set: (x: number, y?: number) => void };
  tint: number;
}

interface PIXIText extends PIXIObject {
  text: string;
  style: { fontSize: number; fill: string | number; fontWeight: string };
}

// ---- Constants ---------------------------------------------------------

const TILE_SIZE = 32;
const VIEWPORT_W = 424;
const VIEWPORT_H = 620;
const CAMERA_LERP = 0.12;
const FLOAT_TEXT_SPEED = -1.2;
const FLOAT_TEXT_LIFE = 1200; // ms
const ANIM_SPEED = 0.1;

// ---- Input State -------------------------------------------------------

interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  attackTarget: EntityId | null;
}

// ---- Entity Render Object ----------------------------------------------

interface EntityRenderObject {
  container: PIXIContainer;
  sprite: PIXIAnimSprite | null;
  shadow: PIXIGraphics;
  nameTag: PIXIText;
  hpBar: PIXIGraphics;
  hpBarBg: PIXIGraphics;
  lastFrame: number;
  agentIndex: number;
}

// ---- Component Props ---------------------------------------------------

export interface PixiGameProps {
  assets: GameAssets;
  tilemap: TileMap | null;
  entities: Entity[];
  droppedItems: DroppedItem[];
  localPlayerId: string | null;
  damages: DamageEvent[];
  zoneId?: string;
  onMove: (direction: Direction | null, position: WorldPosition) => void;
  onAttack: (targetId: EntityId) => void;
  onEntityClick: (entityId: EntityId) => void;
}

// ---- Helper: Extract frames from canvas --------------------------------

function framesFromCanvas(
  PIXI: typeof window.PIXI,
  canvas: HTMLCanvasElement,
  frameW: number,
  frameH: number,
  count: number
): PIXITexture[] {
  const base = PIXI.Texture.from(canvas);
  const frames: PIXITexture[] = [];
  for (let i = 0; i < count; i++) {
    const t = base.clone();
    (t as unknown as { frame: PIXIRectangle }).frame = new PIXI.Rectangle(
      i * frameW, 0, frameW, frameH
    );
    frames.push(t);
  }
  return frames;
}

function directionFrames(
  PIXI: typeof window.PIXI,
  canvas: HTMLCanvasElement,
  dir: Direction
): PIXITexture[] {
  const offsets: Record<Direction, number> = { down: 0, left: 2, right: 4, up: 6 };
  const off = offsets[dir];
  const base = PIXI.Texture.from(canvas);
  return [0, 1].map((f) => {
    const t = base.clone();
    (t as unknown as { frame: PIXIRectangle }).frame = new PIXI.Rectangle((off + f) * 32, 0, 32, 32);
    return t;
  });
}

function monsterFrames(
  PIXI: typeof window.PIXI,
  canvas: HTMLCanvasElement
): PIXITexture[] {
  return framesFromCanvas(PIXI, canvas, 32, 32, 2);
}

// ---- Tilemap Renderer --------------------------------------------------

function buildTilemapContainer(
  PIXI: typeof window.PIXI,
  tilemap: TileMap,
  assets: GameAssets
): PIXIContainer {
  const container = new PIXI.Container();
  const tileTextures = buildTileTextures(PIXI, assets);

  for (let ty = 0; ty < tilemap.height; ty++) {
    for (let tx = 0; tx < tilemap.width; tx++) {
      const tileType = tilemap.tiles[ty]?.[tx] as TileType;
      const tex = tileTextures[tileType] || tileTextures.grass;
      const sprite = new PIXI.Sprite(tex);
      sprite.x = tx * TILE_SIZE;
      sprite.y = ty * TILE_SIZE;
      sprite.zIndex = 0;
      container.addChild(sprite);
    }
  }

  return container;
}

function buildTileTextures(
  PIXI: typeof window.PIXI,
  assets: GameAssets
): Record<TileType, PIXITexture> {
  const tileOffsets: Record<TileType, [number, number]> = {
    grass: [0, 0],
    dirt: [32, 0],
    path: [64, 0],
    water: [96, 0],
    stone: [0, 32],
    wall: [32, 32],
  };

  const base = PIXI.Texture.from(assets.tileset);
  const result: Partial<Record<TileType, PIXITexture>> = {};
  for (const [type, [ox, oy]] of Object.entries(tileOffsets) as [TileType, [number, number]][]) {
    const t = base.clone();
    (t as unknown as { frame: PIXIRectangle }).frame = new PIXI.Rectangle(ox, oy, 32, 32);
    result[type] = t;
  }
  return result as Record<TileType, PIXITexture>;
}

// ---- Environment Objects -----------------------------------------------

function addEnvironmentObjects(
  PIXI: typeof window.PIXI,
  container: PIXIContainer,
  tilemap: TileMap,
  assets: GameAssets
) {
  const envOffsets: Record<string, number> = { tree: 0, rock: 32, bush: 64, building: 96 };
  const base = PIXI.Texture.from(assets.environment);

  const envTypes = ["tree", "rock", "bush"];
  // Deterministic placement based on tile position
  for (let ty = 1; ty < tilemap.height - 1; ty++) {
    for (let tx = 1; tx < tilemap.width - 1; tx++) {
      const tile = tilemap.tiles[ty]?.[tx];
      if (tile !== "grass") continue;
      const seed = (tx * 31 + ty * 17) % 100;
      if (seed < 8) {
        const envType = envTypes[seed % envTypes.length];
        const t = base.clone();
        (t as unknown as { frame: PIXIRectangle }).frame = new PIXI.Rectangle(envOffsets[envType], 0, 32, 32);
        const sprite = new PIXI.Sprite(t);
        sprite.x = tx * TILE_SIZE;
        sprite.y = ty * TILE_SIZE;
        sprite.zIndex = ty * TILE_SIZE + 28; // depth sort
        container.addChild(sprite);
      }
    }
  }
}

// ---- Portal Renderer ---------------------------------------------------

const PORTAL_ZONE_COLORS: Record<string, number> = {
  greenfields: 0x4ade80,
  forest:      0x22c55e,
  dungeon:     0xa78bfa,
  town:        0xfbbf24,
};

const PORTAL_ZONE_ICONS: Record<string, string> = {
  greenfields: "🌿",
  forest:      "🌲",
  dungeon:     "⛏",
  town:        "🏪",
};

function buildPortalLayer(
  PIXI: typeof window.PIXI,
  zoneId: string
): PIXIContainer {
  const container = new PIXI.Container();
  const zoneTilemap = ZONE_TILEMAPS[zoneId as ZoneKey];
  if (!zoneTilemap) return container;

  for (const portal of zoneTilemap.portals) {
    const color  = PORTAL_ZONE_COLORS[portal.targetZone] ?? 0xffffff;
    const px     = portal.worldX - TILE_SIZE / 2;
    const py     = portal.worldY - TILE_SIZE / 2;

    // ── Ground glow ring ──
    const glow = new PIXI.Graphics();
    glow.lineStyle(2, color, 0.5)
        .drawCircle(TILE_SIZE / 2, TILE_SIZE / 2, 22);
    glow.beginFill(color, 0.10)
        .drawCircle(TILE_SIZE / 2, TILE_SIZE / 2, 22)
        .endFill();
    glow.x = px;
    glow.y = py;
    glow.zIndex = 1;
    container.addChild(glow);

    // ── Inner bright dot ──
    const dot = new PIXI.Graphics();
    dot.beginFill(color, 0.85)
       .drawCircle(0, 0, 5)
       .endFill();
    dot.x = portal.worldX;
    dot.y = portal.worldY;
    dot.zIndex = 2;
    container.addChild(dot);

    // ── Label text ──
    const icon  = PORTAL_ZONE_ICONS[portal.targetZone] ?? "↗";
    const label = portal.label ?? portal.targetZone;
    const txt   = new PIXI.Text(`${icon} ${label}`, {
      fontSize:        9,
      fill:            `#${color.toString(16).padStart(6, "0")}`,
      fontWeight:      "bold",
      fontFamily:      "monospace",
      stroke:          "#000000",
      strokeThickness: 3,
    });
    txt.x = portal.worldX - txt.style.fontSize * label.length * 0.28;
    txt.y = portal.worldY - 32;
    txt.zIndex = 3;
    container.addChild(txt);
  }

  return container;
}

// ---- PixiGame Component ------------------------------------------------

export function PixiGame({
  assets,
  tilemap,
  entities,
  droppedItems,
  localPlayerId,
  damages,
  zoneId = "greenfields",
  onMove,
  onAttack,
  onEntityClick,
}: PixiGameProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXIApp | null>(null);
  const worldRef = useRef<PIXIContainer | null>(null);
  const entityLayerRef = useRef<PIXIContainer | null>(null);
  const fxLayerRef = useRef<PIXIContainer | null>(null);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const renderObjectsRef = useRef<Map<string, EntityRenderObject>>(new Map());
  const cameraRef = useRef({ x: 0, y: 0 });
  const inputRef = useRef<InputState>({
    up: false, down: false, left: false, right: false, attackTarget: null,
  });
  const lastMoveRef = useRef<{ direction: Direction | null; ts: number }>({ direction: null, ts: 0 });
  const animTickRef = useRef(0);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  // ---- Create animated sprite for an entity --------------------------

  const createEntityRO = useCallback((
    PIXI: typeof window.PIXI,
    entity: Entity,
    agentIndex: number
  ): EntityRenderObject => {
    const container = new PIXI.Container();
    container.sortableChildren = true;

    // Shadow
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.3).drawEllipse(16, 26, 10, 4).endFill();
    shadow.zIndex = 0;
    container.addChild(shadow);

    // Sprite
    let sprite: PIXIAnimSprite | null = null;
    const a = assetsRef.current;

    let sheetCanvas: HTMLCanvasElement | null = null;
    if (entity.type === "player") {
      sheetCanvas = a.playerSheet;
    } else if (entity.type === "agent") {
      sheetCanvas = a.agentSheets[agentIndex % a.agentSheets.length];
    } else if (entity.type === "monster") {
      const mt = (entity as { monsterType?: string }).monsterType;
      sheetCanvas = a.monsterSheets[mt as keyof typeof a.monsterSheets] || a.monsterSheets.slime;
    }

    if (sheetCanvas) {
      const isCharacter = entity.type === "player" || entity.type === "agent";
      const frames = isCharacter
        ? directionFrames(PIXI, sheetCanvas, entity.direction || "down")
        : monsterFrames(PIXI, sheetCanvas);

      sprite = new PIXI.AnimatedSprite(frames);
      sprite.animationSpeed = ANIM_SPEED;
      sprite.loop = true;
      sprite.anchor.set(0.5, 0.75);
      sprite.x = 16;
      sprite.y = 16;
      sprite.zIndex = 1;
      if (entity.state === "idle") sprite.gotoAndStop(0);
      else sprite.play();
      container.addChild(sprite);
    }

    // HP bar background
    const hpBarBg = new PIXI.Graphics();
    hpBarBg.beginFill(0x330000, 0.85).drawRect(-14, -28, 28, 4).endFill();
    hpBarBg.lineStyle(1, 0x000000, 0.5).drawRect(-14, -28, 28, 4);
    hpBarBg.x = 16;
    hpBarBg.y = 16;
    hpBarBg.zIndex = 5;
    container.addChild(hpBarBg);

    // HP bar fill
    const hpBar = new PIXI.Graphics();
    hpBar.x = 16;
    hpBar.y = 16;
    hpBar.zIndex = 6;
    container.addChild(hpBar);

    // Name tag
    const nameTag = new PIXI.Text(entity.name, {
      fontSize: 9,
      fill: entity.type === "monster" ? "#ff8888" : entity.type === "agent" ? "#88ddff" : "#ffffff",
      fontWeight: "bold",
      stroke: "#000000",
      strokeThickness: 2,
      fontFamily: "monospace",
    });
    nameTag.x = 16 - (entity.name.length * 2.8);
    nameTag.y = -6;
    nameTag.zIndex = 7;
    container.addChild(nameTag);

    return { container, sprite, shadow, nameTag, hpBar, hpBarBg, lastFrame: 0, agentIndex };
  }, []);

  // ---- Update HP bar -------------------------------------------------

  const updateHPBar = useCallback((
    PIXI: typeof window.PIXI,
    ro: EntityRenderObject,
    entity: Entity
  ) => {
    ro.hpBar.clear();
    const ratio = Math.max(0, entity.stats.hp / entity.stats.maxHp);
    const color = ratio > 0.5 ? 0x22cc22 : ratio > 0.25 ? 0xffaa00 : 0xff2222;
    ro.hpBar.beginFill(color, 0.9).drawRect(-14, -28, 28 * ratio, 4).endFill();
  }, []);

  // ---- Update entity sprite direction --------------------------------

  const updateEntitySprite = useCallback((
    PIXI: typeof window.PIXI,
    ro: EntityRenderObject,
    entity: Entity,
    animTick: number
  ) => {
    if (!ro.sprite) return;

    const isCharacter = entity.type === "player" || entity.type === "agent";
    if (!isCharacter) {
      // Monster: toggle between 2 frames on walk
      const frame = entity.state === "walking" ? (Math.floor(animTick / 8) % 2) : 0;
      if (frame !== ro.lastFrame) {
        ro.sprite.gotoAndStop(frame);
        ro.lastFrame = frame;
      }
      return;
    }

    const a = assetsRef.current;
    let sheetCanvas: HTMLCanvasElement;
    if (entity.type === "player") {
      sheetCanvas = a.playerSheet;
    } else {
      sheetCanvas = a.agentSheets[ro.agentIndex % a.agentSheets.length];
    }

    const newFrames = directionFrames(PIXI, sheetCanvas, entity.direction || "down");
    const frame = entity.state === "walking" ? (Math.floor(animTick / 6) % 2) : 0;

    if (ro.sprite.textures !== newFrames || frame !== ro.lastFrame) {
      ro.sprite.textures = newFrames;
      ro.sprite.gotoAndStop(frame);
      ro.lastFrame = frame;
    }

    // Visual feedback for attacking
    if (entity.state === "attacking") {
      ro.sprite.tint = 0xffcccc;
    } else {
      ro.sprite.tint = 0xffffff;
    }

    // Dead: fade
    if (entity.state === "dead") {
      ro.container.alpha = Math.max(0, ro.container.alpha - 0.05);
    } else if (ro.container.alpha < 1) {
      ro.container.alpha = 1;
    }
  }, []);

  // ---- Spawn floating damage text ------------------------------------

  const spawnDamageText = useCallback((
    text: string,
    x: number,
    y: number,
    isCritical: boolean
  ) => {
    const ft: FloatingText = {
      id: Math.random().toString(36).slice(2),
      text,
      x: x + (Math.random() * 20 - 10),
      y: y - 20,
      color: isCritical ? "#ff6600" : "#ffdd44",
      alpha: 1,
      vy: FLOAT_TEXT_SPEED,
      createdAt: Date.now(),
    };
    floatingTextsRef.current.push(ft);
  }, []);

  // ---- Handle input --------------------------------------------------

  const getDirection = useCallback((): Direction | null => {
    const inp = inputRef.current;
    if (inp.up) return "up";
    if (inp.down) return "down";
    if (inp.left) return "left";
    if (inp.right) return "right";
    return null;
  }, []);

  // ---- Main useEffect: Init PixiJS -----------------------------------

  useEffect(() => {
    if (!canvasRef.current || !tilemap) return;
    if (typeof window === "undefined" || !window.PIXI) return;

    const PIXI = window.PIXI;
    PIXI.utils.skipHello();

    const app = new PIXI.Application({
      width: VIEWPORT_W,
      height: VIEWPORT_H,
      backgroundColor: 0x0f0820,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: false,
    });

    canvasRef.current.appendChild(app.view as HTMLCanvasElement);
    appRef.current = app;

    // World container
    const world = new PIXI.Container();
    world.sortableChildren = true;
    app.stage.addChild(world);
    worldRef.current = world;

    // Tilemap
    const tilemapContainer = buildTilemapContainer(PIXI, tilemap, assetsRef.current);
    tilemapContainer.zIndex = 0;
    world.addChild(tilemapContainer);

    // Environment objects
    const envContainer = new PIXI.Container();
    envContainer.sortableChildren = true;
    envContainer.zIndex = 1;
    addEnvironmentObjects(PIXI, envContainer, tilemap, assetsRef.current);
    world.addChild(envContainer);

    // Portal markers — glowing zone exits
    const portalLayer = buildPortalLayer(PIXI, zoneId);
    portalLayer.zIndex = 1;
    world.addChild(portalLayer);

    // Entity layer
    const entityLayer = new PIXI.Container();
    entityLayer.sortableChildren = true;
    entityLayer.zIndex = 2;
    world.addChild(entityLayer);
    entityLayerRef.current = entityLayer;

    // FX layer
    const fxLayer = new PIXI.Container();
    fxLayer.sortableChildren = true;
    fxLayer.zIndex = 10;
    world.addChild(fxLayer);
    fxLayerRef.current = fxLayer;

    // ---- Keyboard input ---

    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp": case "w": case "W": inputRef.current.up = true; break;
        case "ArrowDown": case "s": case "S": inputRef.current.down = true; break;
        case "ArrowLeft": case "a": case "A": inputRef.current.left = true; break;
        case "ArrowRight": case "d": case "D": inputRef.current.right = true; break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp": case "w": case "W": inputRef.current.up = false; break;
        case "ArrowDown": case "s": case "S": inputRef.current.down = false; break;
        case "ArrowLeft": case "a": case "A": inputRef.current.left = false; break;
        case "ArrowRight": case "d": case "D": inputRef.current.right = false; break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ---- Touch / D-pad input ---
    // (handled via onMove props from HUD)

    // ---- Main game loop ---

    let agentColorCounter = 0;

    const tick = (_delta: number) => {
      const now = Date.now();
      animTickRef.current++;

      // Spawn/update entity render objects
      const currentIds = new Set<string>();
      for (const entity of entities) {
        currentIds.add(entity.id);
        let ro = renderObjectsRef.current.get(entity.id);
        if (!ro) {
          const idx = entity.type === "agent" ? agentColorCounter++ : 0;
          ro = createEntityRO(PIXI, entity, idx);
          renderObjectsRef.current.set(entity.id, ro);
          entityLayerRef.current?.addChild(ro.container);
        }

        // Position
        ro.container.x = entity.position.x;
        ro.container.y = entity.position.y;
        ro.container.zIndex = entity.position.y; // depth sort

        // Sprite animation
        updateEntitySprite(PIXI, ro, entity, animTickRef.current);

        // HP bar
        updateHPBar(PIXI, ro, entity);

        // Hide dead entities after fade
        if (entity.state === "dead") {
          ro.container.alpha = Math.max(0, ro.container.alpha - 0.02);
          if (ro.container.alpha <= 0) ro.container.visible = false;
        } else {
          ro.container.visible = true;
        }
      }

      // Remove gone entities
      for (const [id, ro] of renderObjectsRef.current) {
        if (!currentIds.has(id)) {
          entityLayerRef.current?.removeChild(ro.container);
          ro.container.destroy({ children: true });
          renderObjectsRef.current.delete(id);
        }
      }

      // Sort entities by Y
      entityLayerRef.current?.sortChildren();

      // ---- Camera follow ---
      const localPlayer = entities.find(e => e.id === localPlayerId);
      const cam = cameraRef.current;
      if (localPlayer) {
        const targetX = VIEWPORT_W / 2 - localPlayer.position.x;
        const targetY = VIEWPORT_H / 2 - localPlayer.position.y;
        cam.x += (targetX - cam.x) * CAMERA_LERP;
        cam.y += (targetY - cam.y) * CAMERA_LERP;

        // Clamp camera to world bounds
        const worldW = tilemap.width * TILE_SIZE;
        const worldH = tilemap.height * TILE_SIZE;
        cam.x = Math.min(0, Math.max(VIEWPORT_W - worldW, cam.x));
        cam.y = Math.min(0, Math.max(VIEWPORT_H - worldH, cam.y));

        world.x = cam.x;
        world.y = cam.y;
      }

      // ---- Dropped items ---
      // (simple gold coin display, managed separately from entity layer)

      // ---- Floating damage texts ---
      const fxLayer = fxLayerRef.current;
      const newFTs: FloatingText[] = [];
      if (fxLayer) {
        // Remove old text nodes
        fxLayer.children.slice().forEach(child => {
          const age = now - ((child as { _createdAt?: number })._createdAt || now);
          if (age > FLOAT_TEXT_LIFE) {
            fxLayer.removeChild(child);
            child.destroy();
          }
        });
      }

      // Process incoming damages
      for (const dmg of damages) {
        const target = entities.find(e => e.id === dmg.targetId);
        if (target) {
          spawnDamageText(
            dmg.isCritical ? `CRIT! ${dmg.damage}` : `${dmg.damage}`,
            target.position.x + cam.x,
            target.position.y + cam.y,
            dmg.isCritical
          );
        }
      }

      // Render floating texts
      for (const ft of floatingTextsRef.current) {
        const age = now - ft.createdAt;
        if (age >= FLOAT_TEXT_LIFE) continue;
        ft.y += ft.vy;
        ft.alpha = 1 - age / FLOAT_TEXT_LIFE;
        newFTs.push(ft);

        if (fxLayer) {
          const textNode = new PIXI.Text(ft.text, {
            fontSize: ft.text.startsWith("CRIT") ? 14 : 11,
            fill: ft.color,
            fontWeight: "bold",
            stroke: "#000000",
            strokeThickness: 3,
            fontFamily: "monospace",
          });
          (textNode as unknown as { _createdAt: number })._createdAt = ft.createdAt;
          textNode.x = ft.x;
          textNode.y = ft.y;
          textNode.alpha = ft.alpha;
          textNode.zIndex = 999;
          fxLayer.addChild(textNode);
        }
      }
      floatingTextsRef.current = newFTs.filter(ft => now - ft.createdAt < FLOAT_TEXT_LIFE);

      // ---- Send input to server ---
      const dir = getDirection();
      const player = entities.find(e => e.id === localPlayerId);
      if (player) {
        const shouldSend = dir !== lastMoveRef.current.direction || now - lastMoveRef.current.ts > 100;
        if (shouldSend) {
          onMove(dir, player.position);
          lastMoveRef.current = { direction: dir, ts: now };
        }
      }
    };

    app.ticker.add(tick);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      app.ticker.remove(tick);

      renderObjectsRef.current.forEach(ro => {
        ro.container.destroy({ children: true });
      });
      renderObjectsRef.current.clear();

      if (canvasRef.current && app.view) {
        try { canvasRef.current.removeChild(app.view as HTMLCanvasElement); } catch (_) {}
      }
      app.destroy(true);
      appRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilemap, zoneId]); // Re-init when tilemap or zone changes

  // ---- D-pad touch input handlers ------------------------------------

  const handleDpadPress = useCallback((dir: Direction) => {
    inputRef.current.up = dir === "up";
    inputRef.current.down = dir === "down";
    inputRef.current.left = dir === "left";
    inputRef.current.right = dir === "right";
  }, []);

  const handleDpadRelease = useCallback(() => {
    inputRef.current.up = false;
    inputRef.current.down = false;
    inputRef.current.left = false;
    inputRef.current.right = false;
  }, []);

  // ---- Entity click (tap to attack) ----------------------------------

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!appRef.current || !worldRef.current) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const clickX = e.clientX - rect.left - worldRef.current.x;
    const clickY = e.clientY - rect.top - worldRef.current.y;

    // Find nearest entity to click
    let nearest: Entity | null = null;
    let nearestDist = 40; // click radius px
    for (const entity of entities) {
      if (entity.id === localPlayerId) continue;
      if (entity.state === "dead") continue;
      const dx = entity.position.x - clickX;
      const dy = entity.position.y - clickY;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = entity;
      }
    }

    if (nearest) {
      onAttack(nearest.id);
      onEntityClick(nearest.id);
    }
  }, [entities, localPlayerId, onAttack, onEntityClick]);

  return (
    <div style={{ position: "relative", width: VIEWPORT_W, height: VIEWPORT_H, overflow: "hidden" }}>
      {/* PixiJS canvas container */}
      <div
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{ position: "absolute", inset: 0, cursor: "crosshair" }}
      />

      {/* Mobile D-pad */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          width: 120,
          height: 120,
          display: "grid",
          gridTemplateColumns: "repeat(3, 40px)",
          gridTemplateRows: "repeat(3, 40px)",
          gap: 0,
          zIndex: 100,
        }}
      >
        {/* Up */}
        <div />
        <DpadButton
          label="▲"
          onPress={() => handleDpadPress("up")}
          onRelease={handleDpadRelease}
        />
        <div />
        {/* Left / Center / Right */}
        <DpadButton
          label="◄"
          onPress={() => handleDpadPress("left")}
          onRelease={handleDpadRelease}
        />
        <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 4, width: 40, height: 40 }} />
        <DpadButton
          label="►"
          onPress={() => handleDpadPress("right")}
          onRelease={handleDpadRelease}
        />
        {/* Down */}
        <div />
        <DpadButton
          label="▼"
          onPress={() => handleDpadPress("down")}
          onRelease={handleDpadRelease}
        />
        <div />
      </div>

      {/* Attack button */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          right: 20,
          zIndex: 100,
        }}
      >
        <button
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "rgba(220, 38, 38, 0.85)",
            border: "2px solid #ff6666",
            color: "white",
            fontSize: 24,
            cursor: "pointer",
            boxShadow: "0 0 12px rgba(220,38,38,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            // Attack nearest enemy to player
            const localPlayer = entities.find(en => en.id === localPlayerId);
            if (!localPlayer) return;
            let nearest: Entity | null = null;
            let nearestDist = 200;
            for (const entity of entities) {
              if (entity.id === localPlayerId) continue;
              if (entity.state === "dead") continue;
              const dx = entity.position.x - localPlayer.position.x;
              const dy = entity.position.y - localPlayer.position.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < nearestDist) { nearestDist = d; nearest = entity; }
            }
            if (nearest) onAttack(nearest.id);
          }}
          onClick={() => {
            const localPlayer = entities.find(en => en.id === localPlayerId);
            if (!localPlayer) return;
            let nearest: Entity | null = null;
            let nearestDist = 200;
            for (const entity of entities) {
              if (entity.id === localPlayerId) continue;
              if (entity.state === "dead") continue;
              const dx = entity.position.x - localPlayer.position.x;
              const dy = entity.position.y - localPlayer.position.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < nearestDist) { nearestDist = d; nearest = entity; }
            }
            if (nearest) onAttack(nearest.id);
          }}
        >
          ⚔
        </button>
      </div>

      {/* Tap-to-attack hint */}
      <div
        style={{
          position: "absolute",
          bottom: 110,
          right: 12,
          fontSize: 9,
          color: "rgba(255,255,255,0.5)",
          fontFamily: "monospace",
          zIndex: 100,
        }}
      >
        tap enemy to attack
      </div>
    </div>
  );
}

// ---- D-pad Button Component --------------------------------------------

function DpadButton({
  label,
  onPress,
  onRelease,
}: {
  label: string;
  onPress: () => void;
  onRelease: () => void;
}) {
  return (
    <button
      style={{
        width: 40,
        height: 40,
        background: "rgba(255,255,255,0.15)",
        border: "1px solid rgba(255,255,255,0.3)",
        borderRadius: 6,
        color: "white",
        fontSize: 16,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
      }}
      onMouseDown={onPress}
      onMouseUp={onRelease}
      onMouseLeave={onRelease}
      onTouchStart={(e) => { e.preventDefault(); onPress(); }}
      onTouchEnd={(e) => { e.preventDefault(); onRelease(); }}
    >
      {label}
    </button>
  );
}
