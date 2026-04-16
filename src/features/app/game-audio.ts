/**
 * PIXEL REALM ONLINE — Game Sound Effects
 *
 * All SFX definitions for combat, movement, and progression.
 * Uses the Neynar audio SDK (useSfx / sfx).
 */

import type { SfxDefinition } from "@/neynar-farcaster-sdk/audio";

// ---- Combat ---------------------------------------------------------------

/** Melee hit — short noise burst + bass thud */
export const sfxHit: SfxDefinition = [
  { instrument: "noise", duration: "0.08", config: { volume: -4 } },
  { instrument: "bass", note: "C2", duration: "0.12", delay: 10 },
];

/** Critical hit — punchy noise + high synth crack */
export const sfxCritHit: SfxDefinition = [
  { instrument: "noise", duration: "0.12", config: { volume: 0 } },
  { instrument: "bass", note: "C1", duration: "0.18", delay: 10 },
  { instrument: "synth", note: "G5", duration: "0.06", delay: 20, config: { oscillator: "sawtooth", envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 } } },
];

/** Enemy death — descending bass boom */
export const sfxEnemyDie: SfxDefinition = [
  { instrument: "bass", note: "G2", duration: "0.1" },
  { instrument: "bass", note: "Eb2", duration: "0.1", delay: 80 },
  { instrument: "bass", note: "C2", duration: "0.2", delay: 160 },
  { instrument: "noise", duration: "0.15", delay: 40, config: { volume: -6 } },
];

/** Player takes damage — sharp noise sting */
export const sfxPlayerHurt: SfxDefinition = [
  { instrument: "noise", duration: "0.05", config: { volume: -2 } },
  { instrument: "synth", note: "Bb3", duration: "0.12", delay: 20, config: { oscillator: "sawtooth", envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 } } },
];

/** Attack swing — short whoosh */
export const sfxSwing: SfxDefinition = [
  { instrument: "noise", duration: "0.06", config: { volume: -8 } },
  { instrument: "synth", note: "E4", duration: "0.05", config: { oscillator: "sine", envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 } } },
];

// ---- Movement -------------------------------------------------------------

/** Footstep — subtle membrane tap */
export const sfxStep: SfxDefinition = [
  { instrument: "membrane", note: "C3", duration: "0.04", config: { volume: -14 } },
];

// ---- Progression ----------------------------------------------------------

/** Level up — triumphant ascending arpeggio */
export const sfxLevelUp: SfxDefinition = [
  { instrument: "synth", note: "C5", duration: "0.12", config: { oscillator: "triangle" } },
  { instrument: "synth", note: "E5", duration: "0.12", delay: 110, config: { oscillator: "triangle" } },
  { instrument: "synth", note: "G5", duration: "0.12", delay: 220, config: { oscillator: "triangle" } },
  { instrument: "synth", note: "C6", duration: "0.28", delay: 330, config: { oscillator: "triangle" } },
  { instrument: "fm",   note: "C7", duration: "0.2",  delay: 380 },
  { instrument: "pluck", note: "C6", duration: "0.2", delay: 340 },
];

/** Gold pickup — quick coin chime */
export const sfxGold: SfxDefinition = [
  { instrument: "pluck", note: "A5", duration: "0.12" },
  { instrument: "pluck", note: "C6", duration: "0.12", delay: 80 },
];

/** Enter realm / game start — big cinematic hit */
export const sfxEnterRealm: SfxDefinition = [
  { instrument: "bass",  note: "C2", duration: "0.4" },
  { instrument: "noise", duration: "0.2", config: { volume: -5 } },
  { instrument: "synth", note: "G4", duration: "0.2", delay: 60,  config: { oscillator: "sine" } },
  { instrument: "synth", note: "C5", duration: "0.3", delay: 180, config: { oscillator: "sine" } },
  { instrument: "fm",    note: "G5", duration: "0.25", delay: 300 },
];
