"use client";

/**
 * Queue sounds (docs/QUEUE_UI_PLAN.md §8, owner Q3: on, with a mute button).
 *
 * Competitive-shooter style, synthesized with the Web Audio API: short UI
 * clicks for queue start/end, a deep filtered chord swell with a little room
 * reverb for "match found", soft ticks for the last seconds. Original sounds —
 * no game's audio is copied. To use real (licensed) files instead, drop them
 * in public/sounds/ and list them in SOUND_FILES below; a listed file always
 * wins over the synth.
 *
 * Browsers only allow audio after a user gesture, so the site calls
 * `unlockQueueAudio()` on the first click / key press; earlier sounds are skipped.
 */
import { useSyncExternalStore } from "react";
import type { QueueSound } from "@/lib/queue-attention";

/** Optional real sound files (e.g. "/sounds/match-found.mp3"). Empty = synth only. */
const SOUND_FILES: Partial<Record<QueueSound, string>> = {
  tick: "/sounds/countdown-tick.mp3",
  found: "/sounds/match-found.mp3",
  start: "/sounds/click.mp3",
  end: "/sounds/click.mp3",
  accepted: "/sounds/click.mp3",
};

const MUTE_KEY = "hl_queue_sounds_muted";
const MUTE_EVENT = "hl-queue-sound-mute";

let ctx: AudioContext | null = null;
let bus: AudioNode | null = null;
const fileBuffers = new Map<QueueSound, AudioBuffer | null>();

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** A short synthetic room: exponentially decaying stereo noise. */
function roomImpulse(c: AudioContext, seconds = 1.4, decay = 3.2): AudioBuffer {
  const length = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, length, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return buf;
}

/** Master chain: dry + a little reverb, through a compressor (no clipping). */
function output(c: AudioContext): AudioNode {
  if (bus) return bus;
  const input = c.createGain();
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  const master = c.createGain();
  master.gain.value = 0.9;
  const reverb = c.createConvolver();
  reverb.buffer = roomImpulse(c);
  const wet = c.createGain();
  wet.gain.value = 0.22;
  input.connect(comp);
  input.connect(reverb).connect(wet).connect(comp);
  comp.connect(master).connect(c.destination);
  bus = input;
  return input;
}

/** Call from a click / key handler so later sounds are allowed to play. */
export function unlockQueueAudio() {
  const c = context();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => undefined);
  // Load any real sound files once, now that audio is allowed.
  for (const [kind, url] of Object.entries(SOUND_FILES) as [QueueSound, string][]) {
    if (fileBuffers.has(kind)) continue;
    fileBuffers.set(kind, null);
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((data) => c.decodeAudioData(data))
      .then((buf) => fileBuffers.set(kind, buf))
      .catch(() => undefined);
  }
}

export function isQueueSoundMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setQueueSoundMuted(muted: boolean) {
  try {
    if (muted) window.localStorage.setItem(MUTE_KEY, "1");
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    /* private mode: stays for this page only */
  }
  window.dispatchEvent(new Event(MUTE_EVENT));
}

/** Mute state for the toggle button (in sync across components and tabs). */
export function useQueueSoundMuted(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(MUTE_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(MUTE_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    isQueueSoundMuted,
    () => false
  );
}

// --- building blocks --------------------------------------------------------

interface Voice {
  freq: number;
  /** Glide to this pitch over the note (optional). */
  to?: number;
  type?: OscillatorType;
  at: number;
  attack?: number;
  decay: number;
  gain: number;
  /** Two slightly detuned oscillators for a fuller tone. */
  detune?: number;
  filter?: { freq: number; to?: number; q?: number };
}

function voice(c: AudioContext, v: Voice) {
  const out = c.createGain();
  const attack = v.attack ?? 0.008;
  out.gain.setValueAtTime(0.0001, v.at);
  out.gain.exponentialRampToValueAtTime(v.gain, v.at + attack);
  out.gain.exponentialRampToValueAtTime(0.0001, v.at + attack + v.decay);

  let head: AudioNode = out;
  if (v.filter) {
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = v.filter.q ?? 0.8;
    f.frequency.setValueAtTime(v.filter.freq, v.at);
    if (v.filter.to) f.frequency.exponentialRampToValueAtTime(v.filter.to, v.at + attack + v.decay * 0.6);
    f.connect(out);
    head = f;
  }
  out.connect(output(c));

  const detunes = v.detune ? [-v.detune, v.detune] : [0];
  for (const d of detunes) {
    const osc = c.createOscillator();
    osc.type = v.type ?? "sine";
    osc.detune.value = d;
    osc.frequency.setValueAtTime(v.freq, v.at);
    if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, v.at + attack + v.decay * 0.5);
    osc.connect(head);
    osc.start(v.at);
    osc.stop(v.at + attack + v.decay + 0.05);
  }
}

let noiseBuf: AudioBuffer | null = null;

/** A filtered noise burst — the "click" of a UI button, or a transient. */
function click(c: AudioContext, at: number, opts: { freq: number; q?: number; dur: number; gain: number }) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.3), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = opts.freq;
  bp.Q.value = opts.q ?? 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur);
  src.connect(bp).connect(g).connect(output(c));
  src.start(at);
  src.stop(at + opts.dur + 0.02);
}

// --- the sounds ---------------------------------------------------------------

const SOUNDS: Record<QueueSound, (c: AudioContext, t: number) => void> = {
  // Queue started: a crisp UI click and a short low "armed" tone rising a fifth.
  start: (c, t) => {
    click(c, t, { freq: 3200, dur: 0.035, gain: 0.35 });
    voice(c, { freq: 293.7, to: 440, type: "triangle", at: t + 0.01, decay: 0.22, gain: 0.16, filter: { freq: 1800 } });
    voice(c, { freq: 146.8, type: "sine", at: t + 0.01, decay: 0.18, gain: 0.12 });
  },
  // Left the queue: the same click, the tone falling back down.
  end: (c, t) => {
    click(c, t, { freq: 2400, dur: 0.035, gain: 0.3 });
    voice(c, { freq: 440, to: 261.6, type: "triangle", at: t + 0.01, decay: 0.26, gain: 0.14, filter: { freq: 1500 } });
  },
  // Match found: a sub hit, then a deep filtered chord swelling open, twice (a
  // fourth up the second time) — serious, and loud enough from another tab.
  found: (c, t) => {
    const hit = (at: number, root: number) => {
      voice(c, { freq: 110, to: 48, type: "sine", at, attack: 0.004, decay: 0.32, gain: 0.5 });
      click(c, at, { freq: 5200, q: 0.7, dur: 0.06, gain: 0.25 });
      for (const ratio of [1, 1.5, 2, 3]) {
        voice(c, {
          freq: root * ratio,
          type: "sawtooth",
          detune: 7,
          at: at + 0.01,
          attack: 0.045,
          decay: 1.0,
          gain: ratio === 1 ? 0.09 : 0.055,
          filter: { freq: 500, to: 3200, q: 1.1 },
        });
      }
    };
    hit(t, 220); // A
    hit(t + 0.62, 293.7); // D — rises, calls you to act
  },
  // Last seconds to accept: a dry, low tick.
  tick: (c, t) => {
    click(c, t, { freq: 1800, q: 2, dur: 0.03, gain: 0.3 });
    voice(c, { freq: 660, type: "sine", at: t, attack: 0.002, decay: 0.05, gain: 0.08 });
  },
  // You accepted: a firm confirm — click, then a bright fifth.
  accepted: (c, t) => {
    click(c, t, { freq: 3600, dur: 0.03, gain: 0.3 });
    voice(c, { freq: 329.6, type: "triangle", at: t + 0.01, decay: 0.3, gain: 0.12, filter: { freq: 2400 } });
    voice(c, { freq: 493.9, type: "triangle", at: t + 0.07, decay: 0.38, gain: 0.12, filter: { freq: 2800 } });
  },
  // A queue opened on your server: a soft two-note chime rising a fifth.
  open: (c, t) => {
    voice(c, { freq: 587.3, type: "sine", at: t, attack: 0.005, decay: 0.35, gain: 0.14 });
    voice(c, { freq: 880, type: "sine", at: t + 0.13, attack: 0.005, decay: 0.55, gain: 0.14 });
    voice(c, { freq: 1760, type: "sine", at: t + 0.13, attack: 0.005, decay: 0.25, gain: 0.03 });
  },
};

/** How long each built-in sound lasts (seconds), so ticks can wait for it. */
const SYNTH_LENGTH: Record<QueueSound, number> = { start: 0.35, end: 0.4, found: 1.9, tick: 0.08, accepted: 0.55, open: 0.75 };

/** Until when (AudioContext time) a non-tick sound is playing. */
let busyUntil = 0;
/** The tick file currently playing, cut off when the next one starts. */
let tickSource: AudioBufferSourceNode | null = null;

function stopTick() {
  try {
    tickSource?.stop();
  } catch {
    /* already ended */
  }
  tickSource = null;
}

/**
 * Play a queue sound. Sounds never overlap: a tick is skipped while another
 * queue sound is still playing, each tick cuts off the previous one, and any
 * other sound cuts off a playing tick.
 */
export function playQueueSound(kind: QueueSound) {
  if (typeof window === "undefined" || isQueueSoundMuted()) return;
  const c = context();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => undefined);
  try {
    if (kind === "tick") {
      if (c.currentTime < busyUntil) return;
      stopTick();
    } else {
      stopTick();
    }
    const file = fileBuffers.get(kind);
    if (file) {
      const src = c.createBufferSource();
      src.buffer = file;
      src.connect(c.destination);
      src.start();
      if (kind === "tick") tickSource = src;
      else busyUntil = c.currentTime + file.duration;
      return;
    }
    SOUNDS[kind](c, c.currentTime + 0.03);
    if (kind !== "tick") busyUntil = c.currentTime + 0.03 + SYNTH_LENGTH[kind];
  } catch {
    /* audio failed — never break the page for a sound */
  }
}

// Dev preview only: lets `window.__hlPlayQueueSound("found")` audition sounds.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __hlPlayQueueSound?: typeof playQueueSound }).__hlPlayQueueSound = playQueueSound;
}
