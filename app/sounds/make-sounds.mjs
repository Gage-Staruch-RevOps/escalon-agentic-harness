#!/usr/bin/env node
// Makes the app's two notification sounds from scratch (no samples): node make-sounds.mjs
//   needs-you.wav  a session is waiting on you (approval or a question): two soft, nearly pure tones rising a fifth
//   heads-up.wav   a session stalled, stopped mid-task or a scheduled run ended early: two soft, lower tones falling a fourth
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const LEVEL = 0.07; // peak loudness, 0 to 1. Tuned for a Mac left at full system volume: these should be felt more than heard.
const SR = 44100, here = path.dirname(fileURLToPath(import.meta.url));
// one struck note: a few partials, each fading faster the higher it is, with a short soft attack
function note(buf, at, freq, { gain = 1, tau = 0.6, attack = 0.035, partials = [[1, 1], [2, 0.06]], pan = 0 }) {
  const start = Math.floor(at * SR), n = Math.floor(tau * 7 * SR), l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n && start + i < buf[0].length; i++) {
    const t = i / SR, a = Math.min(1, t / attack), rise = a * a * (3 - 2 * a); let v = 0;
    for (const [mult, amp] of partials) v += amp * Math.sin(2 * Math.PI * freq * mult * t) * Math.exp(-t / (tau / Math.sqrt(mult)));
    v *= gain * rise; buf[0][start + i] += v * l; buf[1][start + i] += v * r;
  }
}
// a quiet echo that crosses sides, for a little room
function echo(buf, delay = 0.17, fb = 0.14) { const d = Math.floor(delay * SR); for (let i = d; i < buf[0].length; i++) { buf[0][i] += buf[1][i - d] * fb; buf[1][i] += buf[0][i - d] * fb; } }
function write(name, seconds, build) {
  const n = Math.floor(seconds * SR), buf = [new Float32Array(n), new Float32Array(n)]; build(buf); echo(buf);
  let peak = 0; for (const c of buf) for (const v of c) peak = Math.max(peak, Math.abs(v));
  const fade = Math.floor(0.4 * SR), out = Buffer.alloc(44 + n * 4);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 4, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const f = i > n - fade ? (n - i) / fade : 1; for (let c = 0; c < 2; c++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (buf[c][i] / peak) * LEVEL * f)) * 32767), 44 + i * 4 + c * 2); }
  fs.writeFileSync(path.join(here, name), out); console.log(name, seconds + 's');
}
write('needs-you.wav', 2.4, (b) => {
  note(b, 0.0, 392.0, { gain: 0.9, tau: 0.55, pan: -0.2 });                                // G4
  note(b, 0.24, 587.33, { gain: 1, tau: 0.7, pan: 0.2 });                                  // D5
});
write('heads-up.wav', 2.6, (b) => {
  note(b, 0.0, 329.63, { gain: 1, tau: 0.6, pan: 0.2 });                                   // E4
  note(b, 0.28, 246.94, { gain: 1, tau: 0.85, pan: -0.2 });                                // B3
});
