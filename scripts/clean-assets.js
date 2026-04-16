#!/usr/bin/env node
/**
 * PIXEL REALM ONLINE — Asset Cleaning Pipeline
 *
 * Normalizes raw AI-generated assets:
 * - Resize to 32x32 or 64x64
 * - Consistent naming (kebab-case)
 * - Organize into /public/assets/
 *
 * Usage: node scripts/clean-assets.js
 * Requires: npm install sharp (optional) or uses Canvas API fallback
 */

const fs = require("fs");
const path = require("path");

const RAW_DIR = path.join(__dirname, "../raw-assets");
const OUT_DIR = path.join(__dirname, "../public/assets");

// Asset categories and target sizes
const CATEGORIES = {
  tiles: { size: 32, prefix: "tile-" },
  characters: { size: 64, prefix: "char-" },
  monsters: { size: 64, prefix: "mob-" },
  environment: { size: 32, prefix: "env-" },
  ui: { size: null, prefix: "ui-" }, // keep original size
  fx: { size: 32, prefix: "fx-" },
  items: { size: 32, prefix: "item-" },
};

// Ensure output directories exist
function ensureDirs() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const cat of Object.keys(CATEGORIES)) {
    const dir = path.join(OUT_DIR, cat);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// Normalize filename
function normalizeFilename(filename) {
  return filename
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_.]/g, "")
    .replace(/--+/g, "-");
}

// Try to use sharp for resizing, fall back to copy
async function processAsset(inputPath, outputPath, targetSize) {
  try {
    const sharp = require("sharp");
    if (targetSize) {
      await sharp(inputPath)
        .resize(targetSize, targetSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outputPath);
    } else {
      await sharp(inputPath).png().toFile(outputPath);
    }
    return true;
  } catch {
    // sharp not installed — just copy the file
    fs.copyFileSync(inputPath, outputPath);
    return false;
  }
}

// Generate asset manifest
function generateManifest(assets) {
  const manifest = {
    version: "1.0.0",
    generated: new Date().toISOString(),
    assets,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`[manifest] Written to public/assets/manifest.json`);
}

async function main() {
  console.log("Pixel Realm — Asset Cleaning Pipeline");
  console.log("=====================================");

  ensureDirs();

  if (!fs.existsSync(RAW_DIR)) {
    console.log(`[info] No raw-assets directory found at ${RAW_DIR}`);
    console.log("[info] Creating raw-assets directory...");
    fs.mkdirSync(RAW_DIR, { recursive: true });
    for (const cat of Object.keys(CATEGORIES)) {
      fs.mkdirSync(path.join(RAW_DIR, cat), { recursive: true });
    }
    console.log("[info] Place AI-generated assets in raw-assets/<category>/");
    console.log("[info] Then run this script again.");
    return;
  }

  const manifest = [];
  let processed = 0;
  let skipped = 0;

  for (const [category, config] of Object.entries(CATEGORIES)) {
    const inputDir = path.join(RAW_DIR, category);
    const outputDir = path.join(OUT_DIR, category);

    if (!fs.existsSync(inputDir)) {
      console.log(`[skip] No directory: raw-assets/${category}`);
      continue;
    }

    const files = fs.readdirSync(inputDir).filter(f =>
      /\.(png|jpg|jpeg|gif|webp)$/i.test(f)
    );

    if (files.length === 0) {
      console.log(`[empty] raw-assets/${category}/ — no image files`);
      continue;
    }

    console.log(`\n[${category}] Processing ${files.length} files...`);

    for (const file of files) {
      const inputPath = path.join(inputDir, file);
      const normalized = normalizeFilename(file.replace(/\.[^.]+$/, ""));
      const outputFilename = `${config.prefix}${normalized}.png`;
      const outputPath = path.join(outputDir, outputFilename);

      const resized = await processAsset(inputPath, outputPath, config.size);
      const status = resized ? "→ resized" : "→ copied";

      console.log(`  [${status}] ${file} → assets/${category}/${outputFilename}`);

      manifest.push({
        category,
        originalName: file,
        outputName: outputFilename,
        path: `assets/${category}/${outputFilename}`,
        size: config.size,
      });

      processed++;
    }
  }

  if (processed > 0) {
    generateManifest(manifest);
    console.log(`\n[done] Processed ${processed} assets, skipped ${skipped}`);
  } else {
    console.log("\n[done] No assets to process. Add files to raw-assets/<category>/");
  }
}

main().catch(console.error);
