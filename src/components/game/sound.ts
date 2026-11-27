"use client";

import { useSyncExternalStore } from "react";

/**
 * Sound effects and haptics for timed rounds (#283). Every sound is made with
 * the Web Audio API (oscillators and gain envelopes), so there are no audio
 * files to host and no dependency. Nothing plays while the player has sound
 * off, before the browser allows audio (the first click unlocks it), or in a
 * browser without Web Audio. The on/off choice is kept in localStorage.
 */

const STORAGE_KEY = "zoomout:sound";
const listeners = new Set<() => void>();
// This tab's choice, used if storage isn't available (private mode, blocked).
let chosen: boolean | null = null;

function readSoundOn(): boolean {
  if (chosen !== null) return chosen;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  chosen = on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Remembered for this tab only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    chosen = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether sound is on. Off on the server, so nothing claims to play before hydration. */
export function useSoundOn(): boolean {
  return useSyncExternalStore(subscribe, readSoundOn, () => false);
}

/** For tests: forget this tab's choice. */
export function resetSoundChoice() {
  chosen = null;
}

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context ??= new Ctor();
  } catch {
    return null;
  }
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

/** Call from a click handler (Start round, the toggle) so later sounds may play. */
export function unlockAudio() {
  if (readSoundOn()) audio();
}

type Tone = {
  freq: number;
  /** Seconds after the sound starts. */
  at: number;
  dur: number;
  type?: OscillatorType;
  /** Peak volume, 0 to 1, before the master volume. */
  gain?: number;
  /** Glide to this frequency over the tone. */
  slideTo?: number;
};

const MASTER_VOLUME = 0.6;

function play(tones: readonly Tone[]) {
  if (!readSoundOn()) return;
  const ctx = audio();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(ctx.destination);
    for (const tone of tones) {
      const start = t0 + tone.at;
      const end = start + tone.dur;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = tone.type ?? "triangle";
      osc.frequency.setValueAtTime(tone.freq, start);
      if (tone.slideTo) osc.frequency.exponentialRampToValueAtTime(tone.slideTo, end);
      // A fast attack and an exponential decay: a pluck, not a beep.
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(tone.gain ?? 0.25, start + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(env).connect(master);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // A sound is never worth breaking the game for.
  }
}

/** `base` moved up `semitones`. */
const up = (base: number, semitones: number) => base * 2 ** (semitones / 12);

const C5 = 523.25;
const MAJOR = [0, 4, 7] as const;

export const sounds = {
  /** The round starts: a quick upward swoop. */
  start: () => play([{ freq: 330, slideTo: 880, at: 0, dur: 0.16, type: "sine", gain: 0.2 }]),

  /**
   * A correct guess: a rising major arpeggio. Each round of a streak starts it
   * a step higher (capped), and a lightning-fast guess adds a sparkle on top.
   */
  correct: (streakStep = 0, sparkle = false) => {
    const root = up(C5, Math.min(streakStep, 5) * 2);
    const tones: Tone[] = MAJOR.map((s, i) => ({ freq: up(root, s), at: i * 0.07, dur: 0.24, gain: 0.24 }));
    tones.push({ freq: up(root, 12), at: 0.21, dur: sparkle ? 0.5 : 0.32, gain: 0.2 });
    if (sparkle) {
      tones.push(
        { freq: up(root, 19), at: 0.28, dur: 0.45, type: "sine", gain: 0.1 },
        { freq: up(root, 24), at: 0.35, dur: 0.4, type: "sine", gain: 0.07 },
      );
    }
    play(tones);
  },

  /** A wrong guess: a short, low, soft bonk. Not harsh: it happens a lot. */
  wrong: () =>
    play([
      { freq: 220, slideTo: 140, at: 0, dur: 0.15, type: "square", gain: 0.06 },
      { freq: 110, slideTo: 80, at: 0, dur: 0.18, type: "sine", gain: 0.2 },
    ]),

  /** One of the last seconds. Higher as time runs out (`secondsLeft` 5 → 1). */
  tick: (secondsLeft: number) =>
    play([{ freq: up(1_000, (5 - Math.max(1, Math.min(5, secondsLeft))) * 2), at: 0, dur: 0.04, type: "square", gain: 0.05 }]),

  /** Time's up: two falling notes. */
  timeUp: () =>
    play([
      { freq: 392, at: 0, dur: 0.18, gain: 0.2 },
      { freq: 262, at: 0.16, dur: 0.38, gain: 0.2 },
    ]),

  /** One row of the final score lands. Each a step higher than the last. */
  tally: (row: number) => play([{ freq: up(660, Math.min(row, 8) * 2), at: 0, dur: 0.07, type: "sine", gain: 0.14 }]),

  /** The total has counted up. */
  fanfare: () =>
    play([
      ...MAJOR.map((s, i) => ({ freq: up(C5, s), at: i * 0.09, dur: 0.22, gain: 0.2 })),
      { freq: up(C5, 12), at: 0.3, dur: 0.6, gain: 0.22 },
      { freq: up(C5, 16), at: 0.3, dur: 0.6, type: "sine" as const, gain: 0.1 },
    ]),

  /** The toggle was turned on: a tiny confirmation. */
  blip: () => play([{ freq: 880, at: 0, dur: 0.08, type: "sine", gain: 0.15 }]),
};

/** A short vibration on phones that support it, only with sound on. */
export function buzz(pattern: number | number[]) {
  if (!readSoundOn() || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Not allowed here (e.g. no user activation yet).
  }
}
