import { pgTable, text, uuid, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * Key-Value Store Table
 *
 * Built-in table for simple key-value storage.
 * Available immediately without schema changes.
 *
 * ⚠️ CRITICAL: DO NOT DELETE OR EDIT THIS TABLE DEFINITION ⚠️
 * This table is required for the app to function properly.
 * DO NOT delete, modify, rename, or change any part of this table.
 * Removing or editing it will cause database schema conflicts and prevent
 * the app from starting.
 *
 * Use for:
 * - User preferences/settings
 * - App configuration
 * - Simple counters
 * - Temporary data
 */
export const kv = pgTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Add your custom tables below this line
 *
 * Example:
 *
 * export const gameScores = pgTable("game_scores", {
 *   id: uuid("id").primaryKey().defaultRandom(),
 *   fid: integer("fid").notNull(),
 *   score: integer("score").notNull(),
 *   username: text("username").notNull(),
 *   createdAt: timestamp("created_at").defaultNow().notNull()
 * });
 */

/**
 * Player character state — one row per player (keyed by Farcaster FID).
 * Persists position, level, stats, and gold between sessions.
 * For anonymous players (no FID), sessions are ephemeral (no save).
 */
export const playerStates = pgTable("player_states", {
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

/**
 * Player inventory — one row per item per player.
 * Items are serialised as JSON blobs keyed by FID + item ID.
 */
export const playerInventory = pgTable("player_inventory", {
  id:       uuid("id").primaryKey().defaultRandom(),
  fid:      integer("fid").notNull(),
  itemData: text("item_data").notNull(), // JSON-serialised Item object
});

/**
 * Onchain mint log — tracks every ERC-1155 mint initiated from the forge.
 *
 * Used for:
 *  - Idempotency: prevent double-mint of the same item
 *  - Rollback tracking: if onchain tx fails, we know which DB rows to restore
 *  - Audit trail: permanent record of all mints
 *
 * Status flow:
 *   pending → confirmed  (tx included in block)
 *   pending → failed     (tx reverted — DB rows already restored by rollback)
 */
export const onchainMints = pgTable("onchain_mints", {
  id:              uuid("id").primaryKey().defaultRandom(),
  fid:             integer("fid").notNull(),
  itemId:          text("item_id").notNull(),     // original in-game item ID
  itemName:        text("item_name").notNull(),
  tokenId:         integer("token_id").notNull(), // ERC-1155 token ID
  recipientAddress:text("recipient_address").notNull(),
  txHash:          text("tx_hash"),               // null until tx submitted
  status:          text("status").notNull().default("pending"), // pending | confirmed | failed
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  confirmedAt:     timestamp("confirmed_at"),
});
