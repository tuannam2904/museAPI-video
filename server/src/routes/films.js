import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { requireAuth } from '../auth.js';
import { CFG, MEDIA_DIR } from '../config.js';
import { db, uid, now, createJob, getJob, updateJob, addCredits, priceOf } from '../db.js';
import * as muse from '../muse.js';
import { normalizeRefs } from './generate.js';

const r = Router();

/* ------------------------------ helpers ------------------------------ */

const GENRES = ['đời thường', 'hành động', 'hài hước', 'tình cảm', 'kinh dị', 'viễn tưởng', 'tài liệu'];
const STYLES = ['điện ảnh', 'chân thực', 'hoạt hình', 'tài liệu', 'hoài cổ'];
const ASPECTS = ['9:16', '16:9', '1:1'];
const SCENE_DURATIONS = [5, 8, 10];

function shapeProject(p) {
  if (!p) return null;
  return {
    id: p.id, userId: p.user_id, title: p.title, idea: p.idea,
    genre: p.genre, durationTotal: p.duration_total, sceneDuration: p.scene_duration,
    style: p.style, aspect: p.aspect, script: p.script,
    status: p.status, finalFile: p.final_file,
    finalUrl: p.final_file ? `/media/${p.final_file}` : null,
    createdAt: p.created_at, updatedAt: p.updated_at,
  };
}

function shapeScene(s) {
  if (!s) return null;
  return {
    id: s.id, projectId: s.project_id, order: s.sort_order, duration: s.duration,
    description: s.description, characters: s.characters, action: s.action,
    camera: s.camera, lighting: s.lighting, setting: s.setting,
    imagePrompt: s.image_prompt, videoPrompt: s.video_prompt,
    imageJobId: s.image_job_id, videoJobId: s.video_job_id,
    imageMedia: s.image_media, videoMedia: s.video_media,
    status: s.status, error: s.error,
    createdAt: s.created_at, updatedAt: s.updated_at,
  };
}

function getProject(userId, id) {
  const p = db.prepare('SELECT * FROM film_projects WHERE id = ? AND user_id = ?').get(id, userId);
  return p ? shapeProject(p) : null;
}

function listScenesRaw(projectId) {
  return db.prepare('SELECT * FROM film_scenes WHERE project_id = ? ORDER BY sort_order ASC').all(projectId);
}

function listScenes(projectId) {
  return listScenesRaw(projectId).map(shapeScene);
}

function shapeCharacter(c) {
  if (!c) return null;
  let photos = [];
  try { photos = JSON.parse(c.photos || '[]'); } catch { photos = []; }
  if (!Array.isArray(photos)) photos = [];
  return {
    id: c.id, projectId: c.project_id, name: c.name, description: c.description,
    photos, createdAt: c.created_at,
  };
}

function listFilmCharacters(projectId) {
  return db.prepare('SELECT * FROM film_characters WHERE project_id = ? ORDER BY created_at ASC').all(projectId).map(shapeCharacter);
}

function getFilmCharacter(projectId, charId) {
  const c = db.prepare('SELECT * FROM film_characters WHERE id = ? AND project_id = ?').get(charId, projectId);
  return c ? shapeCharacter(c) : null;
}

/** Đồng bộ trạng thái cảnh từ job đã liên kết (worker đã poll sẵn). */
function syncSceneFromJob(scene) {
  const patch = {};
  if (scene.image_job_id) {
    const j = getJob(scene.image_job_id);
    if (j) {
      if (j.status === 'completed' && j.mediaUrl) {
        const url = j.mediaUrl;
        if (scene.image_media !== url) patch.image_media = url;
        if (scene.status === 'image' || scene.status === 'pending') patch.status = 'image_done';
      } else if (j.status === 'failed') {
        if (scene.status !== 'failed') { patch.status = 'failed'; patch.error = (j.error || 'Tạo ảnh thất bại').slice(0, 300); }
      } else if ((j.status === 'processing' || j.status === 'queued') && scene.status === 'pending') {
        patch.status = 'image';
      }
    }
  }
  if (scene.video_job_id) {
    const j = getJob(scene.video_job_id);
    if (j) {
      if (j.status === 'completed' && j.mediaUrl) {
        const url = j.mediaUrl;
        if (scene.video_media !== url) patch.video_media = url;
        if (scene.status !== 'done') patch.status = 'done';
      } else if (j.status === 'failed') {
        if (scene.status !== 'failed') { patch.status = 'failed'; patch.error = (j.error || 'Tạo video thất bại').slice(0, 300); }
      } else if ((j.status === 'processing' || j.status === 'queued') && scene.status !== 'video') {
        patch.status = 'video';
      }
    }
  }
  if (Object.keys(patch).length) {
    patch.updated_at = now();
    db.prepare(`UPDATE film_scenes SET ${Object.keys(patch).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...Object.values(patch), scene.id);
    return { ...scene, ...patch };
  }
  return scene;
}

async function chatText(system, user, timeoutMs = 600_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const up = await fetch(`${CFG.museBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CFG.museKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'muse-spark',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
      }),
      signal: controller.signal,
    });
    const data = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(data?.error?.message || data?.detail || `Lỗi HTTP ${up.status} từ upstream`);
    return data?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonArray(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('Không tách được JSON từ phản hồi của Muse');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Tách danh sách cảnh từ phản hồi của Muse một cách chắc chắn.
 * Muse đôi khi trả JSON mảng sạch, đôi khi trả nhiều object rời rạc,
 * đôi khi mảng bị lỗi cú pháp (thiếu dấu phẩy). Thử lần lượt:
 *  1) mảng JSON trong cặp [ ... ] ngoài cùng;
 *  2) toàn bộ nội dung là JSON (mảng hoặc object);
 *  3) quét từng object { ... } cân bằng ngoặc và parse riêng từng cái.
 */
function extractScenes(text) {
  const clean = String(text || '');
  // 1) mảng JSON
  try {
    const arr = parseJsonArray(clean);
    if (Array.isArray(arr) && arr.length) return arr;
  } catch { /* thử cách khác */ }
  // 2) toàn bộ là JSON
  try {
    const whole = JSON.parse(clean.trim());
    if (Array.isArray(whole) && whole.length) return whole;
    if (whole && typeof whole === 'object' && whole.description) return [whole];
    if (whole && typeof whole === 'object' && Array.isArray(whole.scenes)) return whole.scenes;
  } catch { /* thử cách khác */ }
  // 3) Tách theo từng lần xuất hiện của "description" (mỗi cảnh bắt đầu bằng
  //    trường này). Cách này không phụ thuộc ngoặc cân bằng — Muse đôi khi
  //    trả JSON thừa/thiếu ngoặc hoặc lặp lại cảnh.
  const descRe = /"description"\s*:\s*"/g;
  const descPositions = [];
  let dm;
  while ((dm = descRe.exec(clean)) !== null) {
    descPositions.push({ start: dm.index, valueStart: descRe.lastIndex });
  }
  for (let i = 0; i < descPositions.length; i++) {
    const spanStart = descPositions[i].start;
    const spanEnd = i + 1 < descPositions.length ? descPositions[i + 1].start : clean.length;
    const obj = parseSceneObjectLoose(clean.slice(spanStart, spanEnd));
    if (obj && typeof obj === 'object' && (obj.description || obj.image_prompt || obj.video_prompt)) {
      scenes.push(obj);
    }
  }
  if (scenes.length) return scenes;
  throw new Error('Không tách được danh sách cảnh (JSON) từ phản hồi của Muse');
}

/** Tách các trường của một object cảnh khi JSON.parse lỗi (dấu " trong lời thoại không escape). */
function parseSceneObjectLoose(objText) {
  const fields = ['description', 'characters', 'action', 'camera', 'lighting', 'setting', 'image_prompt', 'video_prompt'];
  const fieldRe = new RegExp('"(' + fields.join('|') + ')"\\s*:\\s*"', 'g');
  const positions = [];
  let m;
  while ((m = fieldRe.exec(objText)) !== null) {
    positions.push({ field: m[1], valueStart: fieldRe.lastIndex });
  }
  if (!positions.length) return null;
  const out = {};
  for (let i = 0; i < positions.length; i++) {
    const { field, valueStart } = positions[i];
    let valueEnd;
    if (i + 1 < positions.length) {
      const nextKey = '"' + positions[i + 1].field + '"';
      const nextKeyPos = objText.indexOf(nextKey, valueStart);
      valueEnd = nextKeyPos < 0 ? objText.length : findValueEnd(objText, valueStart, nextKeyPos);
    } else {
      const closeBrace = objText.lastIndexOf('}');
      valueEnd = objText.lastIndexOf('"', closeBrace);
      if (valueEnd < valueStart) valueEnd = objText.length;
    }
    if (valueEnd <= valueStart) continue;
    const val = objText.slice(valueStart, valueEnd)
      .replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    out[field] = val.trim();
  }
  return (out.description || out.image_prompt || out.video_prompt) ? out : null;
}

/** Tìm dấu " đóng giá trị: dấu " mà sau nó chỉ có khoảng trắng + dấu phẩy rồi tới tên trường kế. */
function findValueEnd(objText, fromPos, nextKeyPos) {
  for (let j = nextKeyPos - 1; j >= fromPos; j--) {
    if (objText[j] === '"') {
      if (/^\s*,\s*$/.test(objText.slice(j + 1, nextKeyPos))) return j;
    }
  }
  return nextKeyPos;
}

/** Số tài khoản Muse đang bật = giới hạn luồng song song (tối đa 4 để nhẹ RAM điện thoại). */
async function enabledAccountCount() {
  try {
    const { accounts } = await muse.listAccounts();
    const n = (accounts || []).filter((a) => a.enabled !== false).length;
    return Math.max(1, Math.min(4, n || 1));
  } catch {
    return 2;
  }
}

async function runLimited(tasks, limit) {
  const results = new Array(tasks.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = await tasks[idx]();
      } catch (e) {
        results[idx] = { error: e };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function failScene(sceneId, message) {
  db.prepare("UPDATE film_scenes SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
    .run(String(message).slice(0, 300), now(), sceneId);
}

/* ------------------------- tạo ảnh / video cho 1 cảnh ------------------------- */

async function createSceneImage(userId, scene, aspect) {
  const prompt = (scene.imagePrompt || scene.description || '').trim();
  if (prompt.length < 2) throw new Error('Cảnh chưa có mô tả để tạo ảnh');
  // Gắn ảnh tham chiếu của nhân vật xuất hiện trong cảnh (khớp theo tên nhân vật)
  let refs = [];
  try {
    const chars = listFilmCharacters(scene.projectId);
    const sceneText = String(scene.characters || '').toLowerCase();
    const photos = [];
    for (const ch of chars) {
      if (ch.name && sceneText.includes(ch.name.toLowerCase())) {
        for (const ph of (ch.photos || [])) {
          if (ph && ph.url) photos.push(ph);
          if (photos.length >= 3) break;
        }
      }
      if (photos.length >= 3) break;
    }
    refs = normalizeRefs(photos);
  } catch { refs = []; }
  const params = { size: ASPECTS.includes(aspect) ? aspect : '9:16' };
  const cost = priceOf('image', params);
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  if (!user || user.credits < cost) throw new Error(`Không đủ điểm (tạo ảnh cần ${cost})`);
  const job = createJob(userId, 'image', prompt, params, cost);
  addCredits(userId, -cost, 'Film: tạo ảnh cảnh', job.id);
  try {
    const payload = { prompt, model: 'muse-image', size: params.size };
    if (refs.length) payload.images = refs;
    const out = await muse.createImageTask(payload);
    const upstreamId = out?.id || out?.task_id;
    if (!upstreamId) throw new Error('Upstream không trả về ID tác vụ');
    updateJob(job.id, { upstream_id: upstreamId, status: 'processing', progress: 10 });
    db.prepare("UPDATE film_scenes SET image_job_id = ?, status = 'image', error = NULL, updated_at = ? WHERE id = ?")
      .run(job.id, now(), scene.id);
    return job;
  } catch (e) {
    updateJob(job.id, { status: 'failed', error: e.message, finished_at: Date.now() });
    addCredits(userId, cost, 'Film: hoàn điểm khi tạo ảnh thất bại', job.id);
    updateJob(job.id, { refunded: 1 });
    throw e;
  }
}

async function createSceneVideo(userId, project, scene) {
  const prompt = (scene.videoPrompt || scene.description || '').trim();
  if (prompt.length < 2) throw new Error('Cảnh chưa có mô tả để tạo video');
  const params = {
    duration: Number(scene.duration) || 5,
    size: ASPECTS.includes(project.aspect) ? project.aspect : '9:16',
    images: scene.imageMedia ? [scene.imageMedia] : [],
  };
  const cost = priceOf('video', params);
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  if (!user || user.credits < cost) throw new Error(`Không đủ điểm (tạo video cần ${cost})`);
  const job = createJob(userId, 'video', prompt, params, cost);
  addCredits(userId, -cost, 'Film: tạo video cảnh', job.id);
  try {
    const refs = normalizeRefs(params.images);
    const payload = { prompt, model: 'muse-video', duration: params.duration, size: params.size };
    if (refs.length) payload.images = refs;
    const out = await muse.createVideo(payload);
    const upstreamId = out?.id || out?.task_id;
    if (!upstreamId) throw new Error('Upstream không trả về ID tác vụ');
    updateJob(job.id, { upstream_id: upstreamId, status: 'processing', progress: 15 });
    db.prepare("UPDATE film_scenes SET video_job_id = ?, status = 'video', error = NULL, updated_at = ? WHERE id = ?")
      .run(job.id, now(), scene.id);
    return job;
  } catch (e) {
    updateJob(job.id, { status: 'failed', error: e.message, finished_at: Date.now() });
    addCredits(userId, cost, 'Film: hoàn điểm khi tạo video thất bại', job.id);
    updateJob(job.id, { refunded: 1 });
    throw e;
  }
}

/* ------------------------- pipeline nền (đa luồng) ------------------------- */

const running = new Set();

async function waitForScenes(projectId, doneFn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const scenes = listScenesRaw(projectId).map(syncSceneFromJob).map(shapeScene);
    if (scenes.length && scenes.every(doneFn)) return true;
    await new Promise((res) => setTimeout(res, 5000));
  }
  return false;
}

async function runPipeline(projectId, userId) {
  if (running.has(projectId)) return;
  running.add(projectId);
  try {
    const project = getProject(userId, projectId);
    if (!project) return;
    const limit = await enabledAccountCount();
    db.prepare("UPDATE film_projects SET status = 'generating', updated_at = ? WHERE id = ?").run(now(), projectId);

    // Giai đoạn 1: tạo ảnh tham chiếu cho mọi cảnh (song song, giới hạn theo số tài khoản)
    // Chỉ tạo cho cảnh chưa có ảnh và chưa có job ảnh đang chạy; cảnh lỗi được thử lại.
    let scenes = listScenesRaw(projectId).map(syncSceneFromJob).map(shapeScene);
    const needImage = scenes.filter((s) => !s.imageMedia && (s.status === 'failed' || !s.imageJobId));
    if (needImage.length) {
      await runLimited(needImage.map((s) => async () => {
        try { await createSceneImage(userId, s, project.aspect); }
        catch (e) { failScene(s.id, e.message); }
      }), limit);
      await waitForScenes(projectId, (s) => !!s.imageMedia || s.status === 'failed', 8 * 60 * 1000);
    }

    // Giai đoạn 2: tạo video từng cảnh, dùng ảnh tham chiếu (song song)
    // Chỉ tạo cho cảnh đã có ảnh mà chưa có video và chưa có job video đang chạy; cảnh lỗi được thử lại.
    scenes = listScenesRaw(projectId).map(syncSceneFromJob).map(shapeScene);
    const needVideo = scenes.filter((s) => s.imageMedia && !s.videoMedia && (s.status === 'failed' || !s.videoJobId));
    if (needVideo.length) {
      await runLimited(needVideo.map((s) => async () => {
        try { await createSceneVideo(userId, project, s); }
        catch (e) { failScene(s.id, e.message); }
      }), limit);
      await waitForScenes(projectId, (s) => !!s.videoMedia || s.status === 'failed', 15 * 60 * 1000);
    }

    scenes = listScenesRaw(projectId).map(syncSceneFromJob).map(shapeScene);
    const allDone = scenes.length > 0 && scenes.every((s) => s.videoMedia || s.status === 'failed');
    const anyDone = scenes.some((s) => s.videoMedia);
    db.prepare("UPDATE film_projects SET status = ?, updated_at = ? WHERE id = ?")
      .run(allDone && anyDone ? 'ready' : 'storyboard', now(), projectId);
  } catch (e) {
    console.error('[films] pipeline lỗi', projectId, e.message);
  } finally {
    running.delete(projectId);
  }
}

/* ------------------------------ ffmpeg ------------------------------ */

function runCmd(cmd, args, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} thất bại: ${String(stderr || err.message).slice(-300)}`));
      resolve(stdout);
    });
  });
}

async function probeVideo(file) {
  const out = await runCmd('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
    '-of', 'json', file,
  ], 30_000);
  try {
    return JSON.parse(out).streams?.[0] || null;
  } catch {
    return null;
  }
}

const stitching = new Set();

async function stitchFilm(projectId) {
  if (stitching.has(projectId)) return;
  stitching.add(projectId);
  try {
    const scenes = listScenesRaw(projectId).map(syncSceneFromJob).map(shapeScene).filter((s) => s.videoMedia);
    if (!scenes.length) throw new Error('Chưa có cảnh nào có video để ghép');
    const files = scenes.map((s) => path.join(MEDIA_DIR, path.basename(s.videoMedia)));
    for (const f of files) {
      if (!fs.existsSync(f)) throw new Error(`Thiếu file video: ${path.basename(f)}`);
    }
    const outName = `film_${projectId}.mp4`;
    const outFile = path.join(MEDIA_DIR, outName);
    const listPath = path.join(MEDIA_DIR, `film_${projectId}.txt`);
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
    db.prepare("UPDATE film_projects SET final_file = ?, status = 'done', updated_at = ? WHERE id = ?")
      .run(outName, now(), projectId);
  } catch (e) {
    console.error('[films] ghép phim lỗi', projectId, e.message);
    db.prepare("UPDATE film_projects SET status = 'ready', updated_at = ? WHERE id = ?").run(now(), projectId);
    throw e;
  } finally {
    stitching.delete(projectId);
  }
}

/* ------------------------------ routes ------------------------------ */

r.get('/films', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM film_projects WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ projects: rows.map((p) => {
    const proj = shapeProject(p);
    const scenes = listScenes(p.id);
    return { ...proj, sceneCount: scenes.length, doneCount: scenes.filter((s) => s.videoMedia).length };
  }) });
});

r.post('/films', requireAuth, (req, res) => {
  const b = req.body || {};
  const idea = String(b.idea || '').trim();
  if (idea.length < 3) return res.status(400).json({ error: 'Hãy nhập ý tưởng phim (ít nhất vài từ)' });
  const durationTotal = [15, 30, 60].includes(Number(b.durationTotal)) ? Number(b.durationTotal) : 30;
  const sceneDuration = SCENE_DURATIONS.includes(Number(b.sceneDuration)) ? Number(b.sceneDuration) : 5;
  const genre = GENRES.includes(b.genre) ? b.genre : 'đời thường';
  const style = STYLES.includes(b.style) ? b.style : 'điện ảnh';
  const aspect = ASPECTS.includes(b.aspect) ? b.aspect : '9:16';
  const title = String(b.title || '').trim().slice(0, 80) || idea.slice(0, 40);
  const id = uid('film_');
  const ts = now();
  db.prepare(
    `INSERT INTO film_projects(id, user_id, title, idea, genre, duration_total, scene_duration, style, aspect, status, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?)`
  ).run(id, req.user.id, title, idea, genre, durationTotal, sceneDuration, style, aspect, ts, ts);
  res.json({ project: getProject(req.user.id, id) });
});

r.get('/films/:id', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const scenes = listScenesRaw(p.id).map(syncSceneFromJob).map(shapeScene);
  res.json({ project: p, scenes });
});

r.patch('/films/:id', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const b = req.body || {};
  const patch = {};
  if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 80);
  if (typeof b.idea === 'string' && b.idea.trim()) patch.idea = b.idea.trim();
  if (GENRES.includes(b.genre)) patch.genre = b.genre;
  if (STYLES.includes(b.style)) patch.style = b.style;
  if (ASPECTS.includes(b.aspect)) patch.aspect = b.aspect;
  if ([15, 30, 60].includes(Number(b.durationTotal))) patch.duration_total = Number(b.durationTotal);
  if (SCENE_DURATIONS.includes(Number(b.sceneDuration))) patch.scene_duration = Number(b.sceneDuration);
  if (typeof b.script === 'string') patch.script = b.script;
  if (!Object.keys(patch).length) return res.json({ project: p });
  patch.updated_at = now();
  db.prepare(`UPDATE film_projects SET ${Object.keys(patch).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...Object.values(patch), p.id);
  res.json({ project: getProject(req.user.id, p.id) });
});

r.delete('/films/:id', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  db.prepare('DELETE FROM film_scenes WHERE project_id = ?').run(p.id);
  db.prepare('DELETE FROM film_characters WHERE project_id = ?').run(p.id);
  db.prepare('DELETE FROM film_projects WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

/* ---- Nhân vật tham chiếu của phim ---- */
r.get('/films/:id/characters', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  res.json({ characters: listFilmCharacters(p.id) });
});

r.post('/films/:id/characters', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Hãy nhập tên nhân vật' });
  const description = String(b.description || '').trim().slice(0, 2000);
  const photos = Array.isArray(b.photos)
    ? b.photos.filter((ph) => ph && ph.url).slice(0, 3).map((ph) => ({ url: String(ph.url) }))
    : [];
  const id = uid('char_');
  const ts = now();
  db.prepare(
    'INSERT INTO film_characters(id, project_id, name, description, photos, created_at, updated_at) VALUES(?,?,?,?,?,?,?)'
  ).run(id, p.id, name.slice(0, 100), description, JSON.stringify(photos), ts, ts);
  res.json({ character: getFilmCharacter(p.id, id) });
});

r.patch('/films/:id/characters/:charId', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const ch = getFilmCharacter(p.id, req.params.charId);
  if (!ch) return res.status(404).json({ error: 'Không tìm thấy nhân vật' });
  const b = req.body || {};
  const patch = {};
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 100);
  if (typeof b.description === 'string') patch.description = b.description.slice(0, 2000);
  if (Array.isArray(b.photos)) {
    patch.photos = JSON.stringify(
      b.photos.filter((ph) => ph && ph.url).slice(0, 3).map((ph) => ({ url: String(ph.url) }))
    );
  }
  if (!Object.keys(patch).length) return res.json({ character: ch });
  patch.updated_at = now();
  db.prepare(`UPDATE film_characters SET ${Object.keys(patch).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...Object.values(patch), ch.id);
  res.json({ character: getFilmCharacter(p.id, ch.id) });
});

r.delete('/films/:id/characters/:charId', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  db.prepare('DELETE FROM film_characters WHERE id = ? AND project_id = ?').run(req.params.charId, p.id);
  res.json({ ok: true });
});

/* ---- Tạo chân dung cho nhân vật (ảnh tham chiếu) ---- */
r.post('/films/:id/characters/:charId/portrait', requireAuth, async (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const ch = getFilmCharacter(p.id, req.params.charId);
  if (!ch) return res.status(404).json({ error: 'Không tìm thấy nhân vật' });
  const prompt = `Chân dung nhân vật ${ch.name}: ${ch.description}. Phong cách ${p.style}, tỷ lệ ${p.aspect}, chính diện, rõ mặt, ánh sáng tự nhiên.`.trim();
  const params = { size: ASPECTS.includes(p.aspect) ? p.aspect : '9:16' };
  const cost = priceOf('image', params);
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  if (!user || user.credits < cost) return res.status(502).json({ error: `Không đủ điểm (tạo chân dung cần ${cost})` });
  const job = createJob(req.user.id, 'image', prompt, params, cost);
  addCredits(req.user.id, -cost, 'Film: tạo chân dung nhân vật', job.id);
  try {
    const out = await muse.createImageTask({ prompt, model: 'muse-image', size: params.size });
    const upstreamId = out?.id || out?.task_id;
    if (!upstreamId) throw new Error('Upstream không trả về ID tác vụ');
    updateJob(job.id, { upstream_id: upstreamId, status: 'processing', progress: 10 });
    // Chờ worker poll xong job trên server (tối đa 180 giây, kiểm tra mỗi 5 giây)
    const deadline = Date.now() + 180_000;
    let mediaUrl = null;
    while (Date.now() < deadline) {
      await new Promise((r2) => setTimeout(r2, 5000));
      const j = getJob(job.id);
      if (j && j.status === 'completed' && j.mediaUrl) { mediaUrl = j.mediaUrl; break; }
      if (j && j.status === 'failed') throw new Error(j.error || 'Tạo chân dung thất bại');
    }
    if (!mediaUrl) throw new Error('Tạo chân dung quá thời gian chờ');
    // Thêm ảnh vào nhân vật (tối đa 3 ảnh; đã đủ 3 thì thay ảnh cũ nhất)
    const photos = [...(ch.photos || [])];
    if (photos.length >= 3) photos.shift();
    photos.push({ url: mediaUrl });
    db.prepare('UPDATE film_characters SET photos = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(photos), now(), ch.id);
    res.json({ character: getFilmCharacter(p.id, ch.id) });
  } catch (e) {
    updateJob(job.id, { status: 'failed', error: e.message, finished_at: Date.now() });
    addCredits(req.user.id, cost, 'Film: hoàn điểm khi tạo chân dung thất bại', job.id);
    updateJob(job.id, { refunded: 1 });
    res.status(502).json({ error: `Tạo chân dung thất bại: ${e.message}` });
  }
});

/* ---- Kịch bản: Muse viết bằng tiếng Việt ---- */
r.post('/films/:id/script', requireAuth, async (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  try {
    const system = 'Bạn là biên kịch phim ngắn chuyên nghiệp. Viết kịch bản bằng tiếng Việt, rõ ràng, có đầu-cuối, không giải thích dài dòng ngoài kịch bản.';
    const user = [
      `Ý tưởng phim: ${p.idea}`,
      `Thể loại: ${p.genre}. Phong cách hình ảnh: ${p.style}. Tỷ lệ khung hình: ${p.aspect}.`,
      `Tổng thời lượng phim: khoảng ${p.durationTotal} giây.`,
      'Hãy viết kịch bản hoàn chỉnh gồm: (1) Tóm tắt câu chuyện 2-3 câu; (2) Nhân vật chính (tên, tuổi, ngoại hình, trang phục — giữ cố định xuyên suốt phim); (3) Bối cảnh và thời gian; (4) Diễn biến theo 3 hồi: mở đầu, cao trào, kết thúc; (5) Lời thoại ngắn nếu có (phim này ưu tiên không thoại dài, chủ yếu hành động và biểu cảm).',
      'Giữ ngoại hình nhân vật và trang phục nhất quán để dùng cho mọi cảnh quay.',
    ].join('\n');
    const script = (await chatText(system, user)).trim();
    if (!script) throw new Error('Muse trả về kịch bản rỗng');
    db.prepare("UPDATE film_projects SET script = ?, status = 'script', updated_at = ? WHERE id = ?")
      .run(script, now(), p.id);
    res.json({ script, project: getProject(req.user.id, p.id) });
  } catch (e) {
    res.status(502).json({ error: `Viết kịch bản thất bại: ${e.message}` });
  }
});

/* ---- Storyboard: chia kịch bản thành các cảnh (JSON) ---- */
r.post('/films/:id/storyboard', requireAuth, async (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const script = (p.script || '').trim() || p.idea;
  const sceneCount = Math.max(1, Math.round(p.durationTotal / p.sceneDuration));
  try {
    const system = 'Bạn là đạo diễn phim ngắn. Chỉ trả về DUY NHẤT một mảng JSON, không thêm bất kỳ chữ nào ngoài JSON.';
    const user = [
      `Kịch bản phim (thể loại ${p.genre}, phong cách ${p.style}, tỷ lệ ${p.aspect}):`,
      script,
      '',
      `Chia kịch bản thành đúng ${sceneCount} cảnh, mỗi cảnh ${p.sceneDuration} giây, theo trình tự câu chuyện.`,
      'Mỗi cảnh là một object JSON với các trường, TẤT CẢ viết bằng tiếng Việt (kể cả image_prompt và video_prompt). QUAN TRỌNG: trong lời thoại KHÔNG dùng dấu ngoặc kép ("), viết thoại không có dấu ngoặc hoặc dùng dấu nháy đơn (\'); mọi chuỗi JSON phải hợp lệ, không được để dấu " không escape trong chuỗi:',
      '- description: mô tả hình ảnh của cảnh (1-2 câu)',
      '- characters: nhân vật xuất hiện trong cảnh',
      '- action: hành động cụ thể diễn ra',
      '- camera: góc quay và chuyển động camera',
      '- lighting: ánh sáng',
      '- setting: bối cảnh',
      '- image_prompt: prompt tạo ảnh HOÀN CHỈNH VÀ CHI TIẾT cho cảnh, bao gồm đầy đủ: ngoại hình và trang phục nhân vật (mô tả cụ thể, giữ cố định xuyên suốt phim), bối cảnh, ánh sáng, góc quay, phong cách hình ảnh, hành động trong cảnh',
      '- video_prompt: prompt tạo video CHI TIẾT, mô tả chuyển động, hành động và diễn biến trong cảnh, kèm góc quay và nhịp độ',
      'Giữ ngoại hình nhân vật, trang phục và bối cảnh nhất quán giữa các cảnh.',
    ].join('\n');
    let arr;
    try {
      arr = extractScenes(await chatText(system, user));
    } catch {
      // Muse thỉnh thoảng trả JSON lỗi — hỏi lại một lần rồi mới báo lỗi
      arr = extractScenes(await chatText(system, user));
    }
    if (!Array.isArray(arr) || !arr.length) throw new Error('Muse trả về danh sách cảnh rỗng');
    const ts = now();
    // Chèn cảnh mới trước, xóa cảnh cũ sau — INSERT lỗi thì cảnh cũ vẫn còn
    const oldIds = listScenesRaw(p.id).map((s) => s.id);
    const insert = db.prepare(
      `INSERT INTO film_scenes(id, project_id, sort_order, duration, description, characters, action, camera, lighting, setting, image_prompt, video_prompt, status, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`
    );
    arr.slice(0, sceneCount + 2).forEach((s, idx) => {
      insert.run(
        uid('scene_'), p.id, idx, p.sceneDuration,
        String(s.description || '').slice(0, 1000),
        String(s.characters || '').slice(0, 500),
        String(s.action || '').slice(0, 500),
        String(s.camera || '').slice(0, 300),
        String(s.lighting || '').slice(0, 300),
        String(s.setting || '').slice(0, 500),
        String(s.image_prompt || s.description || '').slice(0, 2000),
        String(s.video_prompt || s.description || '').slice(0, 2000),
        ts, ts,
      );
    });
    if (oldIds.length) db.prepare(`DELETE FROM film_scenes WHERE id IN (${oldIds.map(() => '?').join(',')})`).run(...oldIds);
    db.prepare("UPDATE film_projects SET status = 'storyboard', updated_at = ? WHERE id = ?").run(now(), p.id);
    res.json({ scenes: listScenes(p.id).map(shapeScene), project: getProject(req.user.id, p.id) });
  } catch (e) {
    res.status(502).json({ error: `Chia cảnh thất bại: ${e.message}` });
  }
});

/* ---- Sửa / thêm / xóa cảnh ---- */
r.post('/films/:id/scenes', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const b = req.body || {};
  const scenes = listScenes(p.id);
  const ts = now();
  const id = uid('scene_');
  db.prepare(
    `INSERT INTO film_scenes(id, project_id, sort_order, duration, description, characters, action, camera, lighting, setting, image_prompt, video_prompt, status, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`
  ).run(
    id, p.id, scenes.length, SCENE_DURATIONS.includes(Number(b.duration)) ? Number(b.duration) : p.sceneDuration,
    String(b.description || '').slice(0, 1000), String(b.characters || '').slice(0, 500),
    String(b.action || '').slice(0, 500), String(b.camera || '').slice(0, 300),
    String(b.lighting || '').slice(0, 300), String(b.setting || '').slice(0, 500),
    String(b.imagePrompt || b.description || '').slice(0, 2000),
    String(b.videoPrompt || b.description || '').slice(0, 2000),
    ts, ts,
  );
  res.json({ scene: shapeScene(db.prepare('SELECT * FROM film_scenes WHERE id = ?').get(id)) });
});

r.patch('/films/:id/scenes/:sceneId', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const s = db.prepare('SELECT * FROM film_scenes WHERE id = ? AND project_id = ?').get(req.params.sceneId, p.id);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy cảnh' });
  const b = req.body || {};
  const map = {
    description: 'description', characters: 'characters', action: 'action',
    camera: 'camera', lighting: 'lighting', setting: 'setting',
    imagePrompt: 'image_prompt', videoPrompt: 'video_prompt',
  };
  const patch = {};
  for (const [key, col] of Object.entries(map)) {
    if (typeof b[key] === 'string') {
      const limit = (key === 'imagePrompt' || key === 'videoPrompt') ? 2000 : 1000;
      patch[col] = b[key].slice(0, limit);
    }
  }
  if (SCENE_DURATIONS.includes(Number(b.duration))) patch.duration = Number(b.duration);
  if (typeof b.order === 'number') patch.sort_order = Math.max(0, Math.floor(b.order));
  if (!Object.keys(patch).length) return res.json({ scene: shapeScene(s) });
  patch.updated_at = now();
  db.prepare(`UPDATE film_scenes SET ${Object.keys(patch).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...Object.values(patch), s.id);
  res.json({ scene: shapeScene(db.prepare('SELECT * FROM film_scenes WHERE id = ?').get(s.id)) });
});

r.delete('/films/:id/scenes/:sceneId', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  db.prepare('DELETE FROM film_scenes WHERE id = ? AND project_id = ?').run(req.params.sceneId, p.id);
  res.json({ ok: true });
});

/* ---- Tạo ảnh / video cho 1 cảnh ---- */
r.post('/films/:id/scenes/:sceneId/image', requireAuth, async (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const s = db.prepare('SELECT * FROM film_scenes WHERE id = ? AND project_id = ?').get(req.params.sceneId, p.id);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy cảnh' });
  try {
    await createSceneImage(req.user.id, shapeScene(s), p.aspect);
    res.json({ scene: shapeScene(db.prepare('SELECT * FROM film_scenes WHERE id = ?').get(s.id)) });
  } catch (e) {
    failScene(s.id, e.message);
    res.status(502).json({ error: e.message });
  }
});

r.post('/films/:id/scenes/:sceneId/video', requireAuth, async (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const s = db.prepare('SELECT * FROM film_scenes WHERE id = ? AND project_id = ?').get(req.params.sceneId, p.id);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy cảnh' });
  try {
    await createSceneVideo(req.user.id, p, shapeScene(syncSceneFromJob(s)));
    res.json({ scene: shapeScene(db.prepare('SELECT * FROM film_scenes WHERE id = ?').get(s.id)) });
  } catch (e) {
    failScene(s.id, e.message);
    res.status(502).json({ error: e.message });
  }
});

r.post('/films/:id/scenes/:sceneId/retry', requireAuth, (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const s = db.prepare('SELECT * FROM film_scenes WHERE id = ? AND project_id = ?').get(req.params.sceneId, p.id);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy cảnh' });
  db.prepare(
    "UPDATE film_scenes SET status = 'pending', error = NULL, image_job_id = NULL, video_job_id = NULL, updated_at = ? WHERE id = ?"
  ).run(now(), s.id);
  res.json({ scene: shapeScene(db.prepare('SELECT * FROM film_scenes WHERE id = ?').get(s.id)) });
});

/* ---- Tạo toàn bộ (đa luồng: ảnh song song → video song song) ---- */
r.post('/films/:id/generate-all', requireAuth, async (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const scenes = listScenes(p.id);
  if (!scenes.length) return res.status(400).json({ error: 'Chưa có cảnh nào — hãy chia cảnh trước' });
  if (running.has(p.id)) return res.json({ started: false, message: 'Đang chạy rồi', concurrency: null });
  const concurrency = await enabledAccountCount();
  runPipeline(p.id, req.user.id); // chạy nền, không chờ
  res.json({ started: true, concurrency, message: `Đang tạo ${scenes.length} cảnh với ${concurrency} luồng (theo số tài khoản Muse đang bật)` });
});

/* ---- Ghép phim (ffmpeg) ---- */
r.post('/films/:id/stitch', requireAuth, async (req, res) => {
  const p = getProject(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const scenes = listScenesRaw(p.id).map(syncSceneFromJob).map(shapeScene).filter((s) => s.videoMedia);
  if (!scenes.length) return res.status(400).json({ error: 'Chưa có cảnh nào có video để ghép' });
  if (stitching.has(p.id)) return res.json({ started: false, message: 'Đang ghép rồi' });
  stitchFilm(p.id).catch(() => { /* lỗi đã log, status trả về ready */ });
  res.json({ started: true, message: `Đang ghép ${scenes.length} cảnh thành phim hoàn chỉnh` });
});

export default r;
