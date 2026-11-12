/* Tự dọn thư mục media trên server:
 *  - File quá hạn lưu trữ (mediaRetentionDays, mặc định 7 ngày) thì xóa.
 *  - Hạn mức là MỖI USER (mediaMaxMB, mặc định 1024 MB): user nào vượt mức
 *    của mình thì chỉ xóa file cũ nhất của chính user đó, không đụng tới
 *    file của user khác. File mồ côi (không còn DB tham chiếu) chỉ dọn
 *    theo hạn ngày, không tính vào hạn mức của ai.
 * Chỉ đụng tới file của job đã hoàn thành / phim đã ghép xong; job đang chạy
 * không bao giờ bị xóa. Xóa file xong thì dọn luôn tham chiếu trong DB để
 * giao diện hiện "File đã bị xóa" thay vì link hỏng.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting } from './db.js';
import { MEDIA_DIR } from './config.js';

const MB = 1048576;

export function mediaRetentionDays() {
  return Math.max(1, Number(getSetting('mediaRetentionDays') || 7));
}

export function mediaMaxMB() {
  return Math.max(0, Number(getSetting('mediaMaxMB') || 1024));
}

/* Mức trần toàn server (MB) — tổng media của mọi user cộng lại không vượt mức này. */
export function mediaGlobalMaxMB() {
  return Math.max(0, Number(getSetting('mediaGlobalMaxMB') || 5120));
}

/* Hạn mức media của riêng một user (cột media_max_mb); null thì dùng mức chung. */
function mediaMaxMBForUser(userId) {
  const row = db.prepare('SELECT media_max_mb FROM users WHERE id = ?').get(userId);
  if (row && row.media_max_mb != null) return Math.max(0, Number(row.media_max_mb));
  return mediaMaxMB();
}

/* Đọc toàn bộ file trong thư mục media. */
function readMediaDir() {
  const entries = [];
  try {
    for (const name of fs.readdirSync(MEDIA_DIR)) {
      try {
        const st = fs.statSync(path.join(MEDIA_DIR, name));
        if (st.isFile()) entries.push({ name, mtime: st.mtimeMs, size: st.size });
      } catch { /* ignore */ }
    }
  } catch { /* thư mục chưa có */ }
  return entries;
}

/* Chủ của từng file: media_file của job (kèm user_id) + final_file của phim. */
function fileOwners() {
  const owners = new Map();
  for (const r of db.prepare(
    `SELECT media_file, user_id FROM jobs WHERE status = 'completed' AND media_file IS NOT NULL`
  ).all()) owners.set(r.media_file, r.user_id);
  for (const r of db.prepare(
    `SELECT final_file AS media_file, user_id FROM film_projects WHERE final_file IS NOT NULL`
  ).all()) owners.set(r.media_file, r.user_id);
  return owners;
}

/* Dung lượng từng user đang dùng (chỉ tính file còn trên đĩa). */
export function usageByUser() {
  const owners = fileOwners();
  const entries = readMediaDir();
  const byUser = new Map();
  let totalBytes = 0;
  let totalFiles = 0;
  for (const e of entries) {
    totalBytes += e.size;
    totalFiles += 1;
    const uid = owners.get(e.name);
    if (!uid) continue;
    const u = byUser.get(uid) || { bytes: 0, files: 0 };
    u.bytes += e.size;
    u.files += 1;
    byUser.set(uid, u);
  }
  return { byUser, totalBytes, totalFiles };
}

/* Thống kê cho MỘT user (dùng cho banner của chính user đó). */
export function mediaStatsForUser(userId) {
  const { byUser } = usageByUser();
  const u = byUser.get(userId) || { bytes: 0, files: 0 };
  return {
    totalBytes: u.bytes,
    totalMB: +(u.bytes / MB).toFixed(1),
    files: u.files,
    maxMB: mediaMaxMB(),
    retentionDays: mediaRetentionDays(),
  };
}

/* Thống kê toàn server + chi tiết từng user (dùng cho admin). */
export function mediaStatsAll() {
  const { byUser, totalBytes, totalFiles } = usageByUser();
  const users = [];
  for (const [userId, u] of byUser) {
    const row = db.prepare('SELECT email, name FROM users WHERE id = ?').get(userId);
    users.push({
      userId,
      email: row?.email || userId,
      name: row?.name || null,
      totalBytes: u.bytes,
      totalMB: +(u.bytes / MB).toFixed(1),
      files: u.files,
    });
  }
  users.sort((a, b) => b.totalBytes - a.totalBytes);
  return {
    totalBytes,
    totalMB: +(totalBytes / MB).toFixed(1),
    files: totalFiles,
    maxMB: mediaMaxMB(),
    globalMaxMB: mediaGlobalMaxMB(),
    retentionDays: mediaRetentionDays(),
    users,
  };
}

// Giữ tên cũ cho các chỗ gọi mediaStats() không truyền user: trả thống kê toàn server.
export function mediaStats() {
  return mediaStatsAll();
}

function nullRefs(name) {
  db.prepare('UPDATE jobs SET media_file = NULL WHERE media_file = ?').run(name);
  db.prepare('UPDATE film_projects SET final_file = NULL WHERE final_file = ?').run(name);
  const url = `/media/${name}`;
  db.prepare('UPDATE film_scenes SET image_media = NULL WHERE image_media = ?').run(url);
  db.prepare('UPDATE film_scenes SET video_media = NULL WHERE video_media = ?').run(url);
}

function deleteFile(name) {
  try {
    fs.unlinkSync(path.join(MEDIA_DIR, name));
  } catch {
    return false;
  }
  nullRefs(name);
  return true;
}

export function cleanupMedia() {
  const cutoff = Date.now() - mediaRetentionDays() * 86400 * 1000;
  const owners = fileOwners();
  const entries = readMediaDir();

  // File của job đang chạy dở thì không xóa.
  const running = new Set(db.prepare(
    `SELECT media_file FROM jobs WHERE status IN ('queued','processing') AND media_file IS NOT NULL`
  ).all().map((r) => r.media_file));

  const deleted = [];
  let freedBytes = 0;
  const remove = (e, reason) => {
    if (deleteFile(e.name)) {
      deleted.push({ file: e.name, reason, bytes: e.size });
      freedBytes += e.size;
      return true;
    }
    return false;
  };

  // 1. Quá hạn ngày: xóa mọi file cũ (kể cả file mồ côi), cũ nhất trước.
  const candidates = entries.filter((e) => !running.has(e.name)).sort((a, b) => a.mtime - b.mtime);
  const remaining = [];
  for (const e of candidates) {
    if (e.mtime < cutoff) remove(e, 'expired');
    else remaining.push(e);
  }

  // 2. Vượt hạn mức mỗi user: chỉ xóa file của chính user đó, cũ nhất trước.
  const perUser = new Map();
  for (const e of remaining) {
    const uid = owners.get(e.name);
    if (!uid) continue; // file mồ côi không tính vào hạn mức của ai
    if (!perUser.has(uid)) perUser.set(uid, []);
    perUser.get(uid).push(e);
  }
  const still = [...remaining]; // file còn sống sau bước 2, để bước 3 dùng
  for (const [uid, list] of perUser) {
    // Hạn mức của riêng user này (cột media_max_mb), null thì dùng mức chung.
    const capBytes = mediaMaxMBForUser(uid) * MB;
    let bytes = list.reduce((s, e) => s + e.size, 0);
    list.sort((a, b) => a.mtime - b.mtime);
    for (const e of list) {
      if (bytes <= capBytes) break;
      if (remove(e, 'over-limit')) {
        bytes -= e.size;
        const i = still.indexOf(e);
        if (i >= 0) still.splice(i, 1);
      }
    }
  }

  // 3. Vượt mức trần toàn server: xóa file cũ nhất trước (bất kể của ai) cho
  // tới khi tổng về dưới mức. Đây là lưới an toàn cuối cùng để điện thoại
  // không bao giờ đầy dù có nhiều user.
  const globalMaxBytes = mediaGlobalMaxMB() * MB;
  let total = still.reduce((s, e) => s + e.size, 0);
  still.sort((a, b) => a.mtime - b.mtime);
  for (const e of still) {
    if (total <= globalMaxBytes) break;
    if (remove(e, 'over-global-limit')) total -= e.size;
  }

  const after = mediaStatsAll();
  return { ...after, deleted, freedBytes, freedMB: +(freedBytes / MB).toFixed(1) };
}

export function startMediaCleanup() {
  const run = (tag) => {
    try {
      const r = cleanupMedia();
      if (r.deleted.length) {
        console.log(`[media-cleanup] ${tag}: đã dọn ${r.deleted.length} file, giải phóng ${r.freedMB} MB (còn ${r.totalMB} MB)`);
      }
    } catch (e) {
      console.warn('[media-cleanup] lỗi:', e.message);
    }
  };
  run('khởi động');
  const t = setInterval(() => run('định kỳ'), 3600_000);
  if (t.unref) t.unref();
}
