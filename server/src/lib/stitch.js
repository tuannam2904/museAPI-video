// Generic video stitching helper (ffmpeg concat).
// Used by the Canvas 60s flow (6 x 10s segments -> one 60s video).
// Same approach as Film Studio's stitchFilm: if all inputs share codec/size/fps,
// concat with stream copy; otherwise re-encode to a common format.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { MEDIA_DIR } from '../config.js';

function runCmd(cmd, args, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} thất bại: ${String(stderr || err.message).slice(-300)}`));
      resolve();
    });
  });
}

async function probeVideo(file) {
  const out = await new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
      '-of', 'json', file,
    ], { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`ffprobe thất bại: ${String(stderr || err.message).slice(-200)}`));
      resolve(stdout);
    });
  });
  try {
    return JSON.parse(out).streams?.[0] || null;
  } catch {
    return null;
  }
}

// files: absolute paths to the segment mp4s (in order).
// outName: output filename inside MEDIA_DIR.
// Returns the output filename.
export async function stitchVideos(files, outName) {
  if (!Array.isArray(files) || files.length < 2) throw new Error('Cần ít nhất 2 video để nối');
  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error(`Thiếu file video: ${path.basename(f)}`);
  }
  const outFile = path.join(MEDIA_DIR, outName);
  const listPath = path.join(MEDIA_DIR, `${outName}.txt`);
  fs.writeFileSync(listPath, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    const probes = await Promise.all(files.map(probeVideo));
    const first = probes[0];
    const same = first && probes.every((p) => p
      && p.codec_name === first.codec_name
      && p.width === first.width && p.height === first.height
      && p.r_frame_rate === first.r_frame_rate);
    if (same) {
      await runCmd('ffmpeg', ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', outFile]);
    } else {
      await runCmd('ffmpeg', [
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', outFile,
      ]);
    }
  } finally {
    try { fs.unlinkSync(listPath); } catch { /* ignore */ }
  }
  return outName;
}
