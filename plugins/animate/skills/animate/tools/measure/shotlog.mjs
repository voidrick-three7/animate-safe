#!/usr/bin/env node
// Measure a video's editing and sound per second, so a shot log can be written against numbers.
// Usage: node tools/measure/shotlog.mjs references/some-video.mp4 [more videos] [--fps N]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function validateVideoPath(v) {
  if (typeof v !== 'string' || v.startsWith('-')) {
    throw new Error(`Invalid video path argument: ${v}`);
  }
  const resolved = path.resolve(v);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`File not found: ${resolved}`);
  }
  return resolved;
}

const S = 270;

function getFrames(v) {
  const target = validateVideoPath(v);
  const res = spawnSync('ffmpeg', ['-v', 'error', '-i', target, '-vf', `scale=${S}:${S}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1024 * 1024 * 500 });
  if (res.error) throw res.error;
  const buf = res.stdout;
  const frameSize = S * S;
  const numFrames = Math.floor(buf.length / frameSize);
  const frames = [];
  for (let i = 0; i < numFrames; i++) {
    frames.push(buf.subarray(i * frameSize, (i + 1) * frameSize));
  }
  return frames;
}

function getAudio(v, sr = 16000) {
  const target = validateVideoPath(v);
  const res = spawnSync('ffmpeg', ['-v', 'error', '-i', target, '-ac', '1', '-ar', String(sr), '-f', 's16le', '-'], { maxBuffer: 1024 * 1024 * 200 });
  if (res.error) throw res.error;
  const buf = res.stdout;
  const samples = new Float32Array(buf.length / 2);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return { samples, sr };
}

function getFps(v) {
  const target = validateVideoPath(v);
  const res = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', target], { encoding: 'utf8' });
  if (res.error) return 24;
  const parts = res.stdout.trim().split('/');
  if (parts.length === 2 && Number(parts[1])) return Number(parts[0]) / Number(parts[1]);
  return Number(parts[0]) || 24;
}

function measure(v, fps = 24) {
  const target = validateVideoPath(v);
  const frames = getFrames(target);
  const n = frames.length;
  if (n === 0) {
    console.log(`=== ${v}: 0 frames`);
    return;
  }
  const d = new Float64Array(n);
  for (let f = 1; f < n; f++) {
    const prev = frames[f - 1];
    const curr = frames[f];
    let diff = 0;
    for (let i = 0; i < prev.length; i++) {
      diff += Math.abs(curr[i] - prev[i]);
    }
    d[f] = diff / prev.length;
  }
  console.log(`=== ${v}: ${n} frames @ ${fps}fps (${(n / fps).toFixed(2)}s)`);
}

const args = process.argv.slice(2);
let wantFps = null;
const fpsIdx = args.indexOf('--fps');
if (fpsIdx >= 0) {
  wantFps = parseFloat(args[fpsIdx + 1]);
  args.splice(fpsIdx, 2);
}

for (const arg of args) {
  try {
    const fps = wantFps || Math.round(getFps(arg));
    measure(arg, fps);
  } catch (err) {
    console.error(`Error measuring ${arg}:`, err.message);
  }
}
