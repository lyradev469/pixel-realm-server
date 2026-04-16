"use client";

/**
 * PIXEL REALM ONLINE — Inventory Panel
 *
 * Slide-up panel showing the player's inventory and equipped gear.
 * Supports equipping weapons/armor and using potions.
 * Triggered by the bag icon button in the HUD.
 */

import { useState } from "react";
import type { Item, ItemType } from "../types";
import { ForgeButton, isItemForgeable } from "./forge-button";

// ---- Equip slots --------------------------------------------------------

export type EquipSlot = "weapon" | "armor" | "accessory";

export interface Equipment {
  weapon: Item | null;
  armor: Item | null;
  accessory: Item | null;
}

export const EMPTY_EQUIPMENT: Equipment = { weapon: null, armor: null, accessory: null };

// ---- Item icons ---------------------------------------------------------

const ITEM_ICONS: Record<ItemType, string> = {
  weapon:   "⚔️",
  armor:    "🛡️",
  potion:   "🧪",
  gold:     "💰",
  material: "🪨",
};

const RARITY_COLORS: Record<string, string> = {
  common:    "#aaaaaa",
  uncommon:  "#44cc44",
  rare:      "#4488ff",
  epic:      "#cc44ff",
  legendary: "#ff8800",
};

function getRarity(item: Item): string {
  const v = item.value;
  if (v >= 200) return "legendary";
  if (v >= 100) return "epic";
  if (v >= 50)  return "rare";
  if (v >= 20)  return "uncommon";
  return "common";
}

// ---- Equippable check ---------------------------------------------------

function isEquippable(item: Item): boolean {
  return item.itemType === "weapon" || item.itemType === "armor";
}

function equipSlotFor(item: Item): EquipSlot | null {
  if (item.itemType === "weapon") return "weapon";
  if (item.itemType === "armor")  return "armor";
  return null;
}

// ---- Sub-components -----------------------------------------------------

function StatDiff({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  const positive = value > 0;
  return (
    <span style={{
      fontSize: 9,
      color: positive ? "#44ff88" : "#ff6666",
      marginLeft: 4,
    }}>
      {positive ? "+" : ""}{value} {label}
    </span>
  );
}

function ItemCard({
  item,
  equipped,
  fid,
  onEquip,
  onUse,
  onDrop,
  onForged,
}: {
  item: Item;
  equipped: boolean;
  fid: number;
  onEquip: (item: Item) => void;
  onUse: (item: Item) => void;
  onDrop: (item: Item) => void;
  onForged: (itemId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rarity = getRarity(item);
  const rarityColor = RARITY_COLORS[rarity];
  const canEquip = isEquippable(item);
  const isPotion = item.itemType === "potion";
  const canForge = isItemForgeable(item);

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: equipped
          ? "rgba(212,160,23,0.12)"
          : "rgba(255,255,255,0.04)",
        border: `1px solid ${equipped ? "#d4a01760" : "rgba(255,255,255,0.1)"}`,
        borderRadius: 5,
        padding: "7px 10px",
        cursor: "pointer",
        transition: "background 0.1s",
        marginBottom: 4,
      }}
    >
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{ITEM_ICONS[item.itemType]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: rarityColor, fontSize: 11, fontWeight: "bold", fontFamily: "monospace" }}>
              {item.name}
            </span>
            {equipped && (
              <span style={{
                fontSize: 8, color: "#d4a017", background: "rgba(212,160,23,0.2)",
                padding: "1px 4px", borderRadius: 2, fontFamily: "monospace",
              }}>EQUIP</span>
            )}
            {item.quantity > 1 && (
              <span style={{ fontSize: 9, color: "#888", marginLeft: "auto" }}>×{item.quantity}</span>
            )}
          </div>
          {/* Stat preview */}
          <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
            {item.stats?.attack  && <StatDiff label="ATK" value={item.stats.attack} />}
            {item.stats?.defense && <StatDiff label="DEF" value={item.stats.defense} />}
            {item.stats?.hp      && <StatDiff label="HP"  value={item.stats.hp} />}
            {item.stats?.speed   && <StatDiff label="SPD" value={item.stats.speed} />}
          </div>
        </div>
        <span style={{ color: "#555", fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 8 }}
        >
          <div style={{ color: "#888", fontSize: 9, marginBottom: 6, fontFamily: "monospace" }}>
            {item.description}
          </div>
          <div style={{ color: "#d4a017", fontSize: 9, marginBottom: 8, fontFamily: "monospace" }}>
            💰 {item.value}g  •  {rarity.toUpperCase()}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {canEquip && !equipped && (
              <button onClick={() => onEquip(item)} style={btnStyle("#7c3aed", "#a78bfa")}>
                ⚔ Equip
              </button>
            )}
            {canEquip && equipped && (
              <button onClick={() => onEquip(item)} style={btnStyle("#555", "#888")}>
                ✗ Unequip
              </button>
            )}
            {isPotion && (
              <button onClick={() => onUse(item)} style={btnStyle("#166534", "#4ade80")}>
                🧪 Use
              </button>
            )}
            <button onClick={() => onDrop(item)} style={btnStyle("#7f1d1d", "#f87171")}>
              🗑 Drop
            </button>
          </div>
          {canForge && (
            <div style={{ marginTop: 8 }}>
              <ForgeButton item={item} fid={fid} onItemConsumed={onForged} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function btnStyle(bg: string, border: string): React.CSSProperties {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 4,
    color: "white",
    fontSize: 10,
    padding: "3px 8px",
    cursor: "pointer",
    fontFamily: "monospace",
  };
}

// ---- Equipment slot display --------------------------------------------

function EquipSlotDisplay({ slot, item, onUnequip }: { slot: EquipSlot; item: Item | null; onUnequip: (slot: EquipSlot) => void }) {
  const icons: Record<EquipSlot, string> = { weapon: "⚔️", armor: "🛡️", accessory: "💍" };
  const labels: Record<EquipSlot, string> = { weapon: "Weapon", armor: "Armor", accessory: "Accsy" };
  const isEmpty = !item;

  return (
    <div
      onClick={() => item && onUnequip(slot)}
      style={{
        width: 60,
        height: 60,
        border: `1px solid ${isEmpty ? "rgba(255,255,255,0.1)" : "#d4a017"}`,
        borderRadius: 5,
        background: isEmpty ? "rgba(0,0,0,0.3)" : "rgba(212,160,23,0.1)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        cursor: item ? "pointer" : "default",
        position: "relative",
      }}
    >
      <span style={{ fontSize: item ? 22 : 14, opacity: item ? 1 : 0.3 }}>
        {item ? ITEM_ICONS[item.itemType] : icons[slot]}
      </span>
      <span style={{ fontSize: 7, color: item ? "#d4a017" : "#444", fontFamily: "monospace" }}>
        {item ? item.name.slice(0, 7) : labels[slot]}
      </span>
      {item && (
        <div style={{
          position: "absolute", top: -4, right: -4,
          background: "#7c3aed", borderRadius: "50%",
          width: 12, height: 12, fontSize: 7,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "white",
        }}>✓</div>
      )}
    </div>
  );
}

// ---- Main panel --------------------------------------------------------

interface InventoryPanelProps {
  inventory: Item[];
  equipment: Equipment;
  gold: number;
  fid?: number;
  onEquip: (item: Item, slot: EquipSlot) => void;
  onUnequip: (slot: EquipSlot) => void;
  onUse: (item: Item) => void;
  onDrop: (item: Item) => void;
  onForged?: (itemId: string) => void;
  onClose: () => void;
}

export function InventoryPanel({
  inventory,
  equipment,
  gold,
  fid = 0,
  onEquip,
  onUnequip,
  onUse,
  onDrop,
  onForged,
  onClose,
}: InventoryPanelProps) {
  const [tab, setTab] = useState<"all" | "weapons" | "armor" | "consumables">("all");

  const filtered = inventory.filter(item => {
    if (tab === "all") return true;
    if (tab === "weapons")     return item.itemType === "weapon";
    if (tab === "armor")       return item.itemType === "armor";
    if (tab === "consumables") return item.itemType === "potion" || item.itemType === "material";
    return true;
  });

  function isItemEquipped(item: Item): boolean {
    return Object.values(equipment).some(e => e?.id === item.id);
  }

  function handleEquip(item: Item) {
    const slot = equipSlotFor(item);
    if (!slot) return;
    // If already equipped, unequip it
    if (isItemEquipped(item)) {
      onUnequip(slot);
    } else {
      onEquip(item, slot);
    }
  }

  const totalAtk = (equipment.weapon?.stats?.attack ?? 0);
  const totalDef = (equipment.armor?.stats?.defense ?? 0);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={styles.header}>
          <span style={styles.title}>🎒 INVENTORY</span>
          <span style={styles.goldBadge}>💰 {gold}g</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {/* Equipment slots */}
        <div style={styles.slotsRow}>
          <EquipSlotDisplay slot="weapon"    item={equipment.weapon}    onUnequip={onUnequip} />
          <EquipSlotDisplay slot="armor"     item={equipment.armor}     onUnequip={onUnequip} />
          <EquipSlotDisplay slot="accessory" item={equipment.accessory} onUnequip={onUnequip} />
          {/* Stat totals */}
          <div style={styles.statBlock}>
            <div style={styles.statRow}><span style={styles.statLabel}>ATK</span><span style={styles.statVal}>{totalAtk}</span></div>
            <div style={styles.statRow}><span style={styles.statLabel}>DEF</span><span style={styles.statVal}>{totalDef}</span></div>
            <div style={{ fontSize: 8, color: "#555", marginTop: 4, fontFamily: "monospace" }}>tap slot to unequip</div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "linear-gradient(90deg, transparent, #d4a01740, transparent)", margin: "8px 0" }} />

        {/* Filter tabs */}
        <div style={styles.tabs}>
          {(["all", "weapons", "armor", "consumables"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                ...styles.tab,
                background: tab === t ? "rgba(124,58,237,0.3)" : "transparent",
                border: `1px solid ${tab === t ? "#a78bfa" : "rgba(255,255,255,0.1)"}`,
                color: tab === t ? "#e9d5ff" : "#666",
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Item list */}
        <div style={styles.itemList}>
          {filtered.length === 0 ? (
            <div style={styles.empty}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>🎒</div>
              <div style={{ color: "#444", fontSize: 10, fontFamily: "monospace" }}>
                {tab === "all" ? "Your bag is empty" : `No ${tab} yet`}
              </div>
              <div style={{ color: "#333", fontSize: 9, marginTop: 4, fontFamily: "monospace" }}>
                Defeat monsters to find loot
              </div>
            </div>
          ) : (
            filtered.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                equipped={isItemEquipped(item)}
                fid={fid}
                onEquip={handleEquip}
                onUse={onUse}
                onDrop={onDrop}
                onForged={onForged ?? (() => {})}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Bag button (HUD trigger) ------------------------------------------

interface BagButtonProps {
  itemCount: number;
  onClick: () => void;
}

export function BagButton({ itemCount, onClick }: BagButtonProps) {
  return (
    <button onClick={onClick} style={styles.bagBtn}>
      🎒
      {itemCount > 0 && (
        <span style={styles.bagBadge}>{itemCount > 9 ? "9+" : itemCount}</span>
      )}
    </button>
  );
}

// ---- Styles ------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 500,
    backdropFilter: "blur(2px)",
  },

  panel: {
    width: "100%",
    maxWidth: 424,
    maxHeight: "78vh",
    background: "linear-gradient(180deg, #1a0d30 0%, #0f0820 100%)",
    border: "1px solid rgba(212,160,23,0.3)",
    borderBottom: "none",
    borderRadius: "12px 12px 0 0",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 -8px 32px rgba(0,0,0,0.8)",
  },

  header: {
    display: "flex",
    alignItems: "center",
    padding: "12px 16px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    gap: 8,
  },

  title: {
    color: "#f0b429",
    fontSize: 13,
    fontWeight: "bold",
    fontFamily: "monospace",
    letterSpacing: 2,
    flex: 1,
  },

  goldBadge: {
    color: "#d4a017",
    fontSize: 11,
    fontFamily: "monospace",
    background: "rgba(212,160,23,0.1)",
    border: "1px solid rgba(212,160,23,0.3)",
    padding: "2px 8px",
    borderRadius: 4,
  },

  closeBtn: {
    background: "none",
    border: "none",
    color: "#666",
    fontSize: 16,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
  },

  slotsRow: {
    display: "flex",
    gap: 8,
    padding: "10px 16px",
    alignItems: "center",
  },

  statBlock: {
    marginLeft: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  statRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },

  statLabel: {
    color: "#666",
    fontSize: 9,
    fontFamily: "monospace",
    width: 24,
  },

  statVal: {
    color: "#f0b429",
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: "bold",
  },

  tabs: {
    display: "flex",
    gap: 4,
    padding: "0 16px 8px",
  },

  tab: {
    flex: 1,
    padding: "4px 0",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 9,
    fontFamily: "monospace",
    letterSpacing: 0.5,
  },

  itemList: {
    flex: 1,
    overflowY: "auto",
    padding: "0 16px 16px",
  },

  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 0",
  },

  bagBtn: {
    position: "relative",
    background: "rgba(0,0,0,0.6)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 6,
    color: "white",
    fontSize: 18,
    width: 36,
    height: 36,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },

  bagBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    background: "#7c3aed",
    color: "white",
    fontSize: 7,
    fontFamily: "monospace",
    fontWeight: "bold",
    borderRadius: "50%",
    width: 14,
    height: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #0f0820",
  },
};
