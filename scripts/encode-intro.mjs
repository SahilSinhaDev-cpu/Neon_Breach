import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Offline production tool only. Neither FFmpeg nor frame captures are needed
// to build, publish, or play the game; the finished MP4s are committed assets.
const ffmpeg = process.argv[2] || 'ffmpeg';
const frames = process.argv[3] || '/private/tmp/neon-intro-frames';
const audio = resolve('artifacts/intro/intro-mix.wav');
mkdirSync('public/intro', { recursive: true });
mkdirSync('artifacts/intro', { recursive: true });

function run(args) {
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout + result.stderr;
}

function boxes(buffer) {
  const types = [];
  for (let offset = 0; offset + 8 <= buffer.length;) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (size === 1) size = Number(buffer.readBigUInt64BE(offset + 8));
    if (size === 0) size = buffer.length - offset;
    assert.ok(size >= 8 && offset + size <= buffer.length, `Invalid MP4 box ${type}`);
    types.push(type); offset += size;
  }
  return types;
}

const exports = [];
for (const spec of [{ width: 1920, height: 1080, rate: '3000k', buffer: '6000k', level: '4.0' }, { width: 1280, height: 720, rate: '1800k', buffer: '3600k', level: '3.1' }]) {
  const path = `public/intro/neon-breach-${spec.height}p.mp4`;
  console.log(`Encoding ${spec.width} × ${spec.height}…`);
  run(['-hide_banner', '-loglevel', 'warning', '-y', '-framerate', '30', '-start_number', '0', '-i', resolve(frames, '%04d.png'), '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-t', '18', '-r', '30',
    '-vf', `scale=${spec.width}:${spec.height}:flags=lanczos:out_color_matrix=bt709`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', spec.rate, '-bufsize', spec.buffer,
    '-profile:v', 'high', '-level:v', spec.level, '-pix_fmt', 'yuv420p', '-g', '60',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', path]);
  // Decode every frame and the entire audio stream, rather than trusting the
  // encoder exit code or a filename to prove that the export is playable.
  const decoded = run(['-hide_banner', '-v', 'info', '-i', path, '-map', '0:v:0', '-map', '0:a:0', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-']);
  assert.match(decoded, /Video: h264/); assert.match(decoded, /Audio: aac/);
  assert.match(decoded, new RegExp(`${spec.width}x${spec.height}`));
  assert.match(decoded, /30 fps/); assert.match(decoded, /Duration: 00:00:18\.00/);
  const frameCount = Number([...decoded.matchAll(/^frame=(\d+)$/gm)].at(-1)?.[1]);
  assert.equal(frameCount, 540);
  const bytes = statSync(path).size, contents = readFileSync(path), atoms = boxes(contents);
  assert.ok(bytes < 8_000_000, `${path} exceeds 8 MB`);
  assert.ok(atoms.indexOf('moov') >= 0 && atoms.indexOf('moov') < atoms.indexOf('mdat'), 'Missing fast-start MP4 metadata');
  exports.push({ path, ...spec, codec: 'H.264 High', audio: 'AAC stereo 48 kHz 96 kbps', seconds: 18, fps: 30, decodedFrames: frameCount, bytes, fastStart: true, sha256: createHash('sha256').update(contents).digest('hex') });
}
writeFileSync('artifacts/intro/encoding-report.json', JSON.stringify({ capturedInEngine: true, generatedFootage: false, encoder: run(['-version']).split('\n')[0], exports }, null, 2) + '\n');
console.log(JSON.stringify(exports, null, 2));
