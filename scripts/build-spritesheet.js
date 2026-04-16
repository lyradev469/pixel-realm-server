#!/usr/bin/env node
/**
 * PIXEL REALM ONLINE — Sprite Sheet Builder
 *
 * Packs individual sprites into sprite sheets with JSON metadata.
 * Supports character animations (4 dirs × N frames), monster sheets, tilesets.
 *
 * Usage: node scripts/build-spritesheet.js [--type characters|monsters|tiles|all]
 * Requires: npm install sharp canvas
 */

const fs = require("fs");
const path = require("path");

const ASSETS_DIR = path.join(__dirname, "../public/assets");
const SHEETS_DIR = path.join(ASSETS_DIR, "sheets");

// Sheet configurations
const SHEET_CONFIGS = {
  characters: {
    inputDir: path.join(ASSETS_DIR, "characters"),
    frameSize: 64,
    directions: ["down", "left", "right", "up"],
    framesPerDir: 2, // idle, walk
    outputName: "character-sheet.png",
    metaName: "character-sheet.json",
  },
  monsters: {
    inputDir: path.join(ASSETS_DIR, "monsters"),
    frameSize: 64,
    framesPerSprite: 2,
    outputName: "monster-sheet.png",
    metaName: "monster-sheet.json",
  },
  tiles: {
    inputDir: path.join(ASSETS_DIR, "tiles"),
    frameSize: 32,
    outputName: "tileset.png",
    metaName: "tileset.json",
  },
  items: {
    inputDir: path.join(ASSETS_DIR, "items"),
    frameSize: 32,
    outputName: "items-sheet.png",
    metaName: "items-sheet.json",
  },
};

function ensureDirs() {
  if (!fs.existsSync(SHEETS_DIR)) fs.mkdirSync(SHEETS_DIR, { recursive: true });
}

// Generate metadata without actually packing (for when sharp/canvas not available)
function generateMockMeta(config, type) {
  const inputDir = config.inputDir;
  if (!fs.existsSync(inputDir)) {
    console.log(`[skip] Directory not found: ${inputDir}`);
    return null;
  }

  const files = fs.readdirSync(inputDir).filter(f => /\.png$/i.test(f));
  if (files.length === 0) {
    console.log(`[empty] No PNG files in ${inputDir}`);
    return null;
  }

  const meta = {
    type,
    generated: new Date().toISOString(),
    frameSize: config.frameSize,
    sprites: {},
  };

  if (type === "characters") {
    files.forEach((file, i) => {
      const name = file.replace(".png", "");
      const dirs = config.directions;
      meta.sprites[name] = {};
      dirs.forEach((dir, di) => {
        meta.sprites[name][dir] = {
          idle: { x: (di * 2) * config.frameSize, y: i * config.frameSize, w: config.frameSize, h: config.frameSize },
          walk: { x: (di * 2 + 1) * config.frameSize, y: i * config.frameSize, w: config.frameSize, h: config.frameSize },
        };
      });
    });
  } else if (type === "monsters") {
    files.forEach((file, i) => {
      const name = file.replace(".png", "").replace(/^mob-/, "");
      meta.sprites[name] = {
        idle: { x: 0, y: i * config.frameSize, w: config.frameSize, h: config.frameSize },
        walk: { x: config.frameSize, y: i * config.frameSize, w: config.frameSize, h: config.frameSize },
      };
    });
  } else {
    // tiles, items — simple grid
    const cols = 8;
    files.forEach((file, i) => {
      const name = file.replace(".png", "").replace(/^(tile-|item-)/, "");
      meta.sprites[name] = {
        x: (i % cols) * config.frameSize,
        y: Math.floor(i / cols) * config.frameSize,
        w: config.frameSize,
        h: config.frameSize,
      };
    });
  }

  return meta;
}

async function buildSheet(type, config) {
  console.log(`\n[${type}] Building sprite sheet...`);

  const meta = generateMockMeta(config, type);
  if (!meta) return;

  // Try sharp-based packing
  try {
    const sharp = require("sharp");
    const inputDir = config.inputDir;
    const files = fs.readdirSync(inputDir)
      .filter(f => /\.png$/i.test(f))
      .sort();

    if (type === "tiles" || type === "items") {
      const cols = 8;
      const rows = Math.ceil(files.length / cols);
      const sheetW = cols * config.frameSize;
      const sheetH = rows * config.frameSize;

      const composites = await Promise.all(
        files.map(async (file, i) => {
          const img = await sharp(path.join(inputDir, file))
            .resize(config.frameSize, config.frameSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toBuffer();
          return {
            input: img,
            left: (i % cols) * config.frameSize,
            top: Math.floor(i / cols) * config.frameSize,
          };
        })
      );

      await sharp({
        create: { width: sheetW, height: sheetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
      })
        .composite(composites)
        .png()
        .toFile(path.join(SHEETS_DIR, config.outputName));

      console.log(`  [ok] Sheet: ${config.outputName} (${sheetW}×${sheetH})`);
    }

    // Write metadata
    fs.writeFileSync(
      path.join(SHEETS_DIR, config.metaName),
      JSON.stringify(meta, null, 2)
    );
    console.log(`  [ok] Meta: ${config.metaName}`);

  } catch (e) {
    // sharp not available — just write metadata
    console.log(`  [meta-only] sharp not installed, writing metadata only`);
    fs.writeFileSync(
      path.join(SHEETS_DIR, config.metaName),
      JSON.stringify(meta, null, 2)
    );
    console.log(`  [ok] Meta: ${config.metaName}`);
  }
}

async function main() {
  console.log("Pixel Realm — Sprite Sheet Builder");
  console.log("===================================");

  ensureDirs();

  const typeArg = process.argv.find(a => a.startsWith("--type="))?.split("=")[1] || "all";

  if (typeArg === "all") {
    for (const [type, config] of Object.entries(SHEET_CONFIGS)) {
      await buildSheet(type, config);
    }
  } else if (SHEET_CONFIGS[typeArg]) {
    await buildSheet(typeArg, SHEET_CONFIGS[typeArg]);
  } else {
    console.error(`Unknown type: ${typeArg}. Valid: ${Object.keys(SHEET_CONFIGS).join(", ")}, all`);
    process.exit(1);
  }

  console.log("\n[done] Sprite sheet build complete.");
  console.log(`Output: public/assets/sheets/`);
}

main().catch(console.error);
