/* Chính sách lưu trữ media: file tự xóa sau N ngày (mặc định 7), dùng chung cho
 * trang Tạo nhanh, Tác phẩm và bất cứ chỗ nào hiện video/ảnh của user.
 */
import { useEffect, useState } from 'react';

// Đếm ngược tới lúc file bị xóa: còn "6 ngày 4 giờ" / "3 giờ 20 phút" / "45 phút".
export function fmtCountdown(ms) {
  if (ms == null || Number.isNaN(ms)) return null;
  if (ms <= 0) return 'sắp xóa';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  if (d > 0) return `${d} ngày ${Math.floor((m % 1440) / 60)} giờ`;
  const h = Math.floor(m / 60);
  if (h > 0) return `${h} giờ ${m % 60} phút`;
  return `${m} phút`;
}

// Mốc giờ hiện tại, cập nhật mỗi phút để đếm ngược chạy.
export function useNow(stepMs = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

// Thời điểm file của job bị xóa = lúc tạo xong + số ngày giữ file.
export function jobDeleteAt(job, retentionDays) {
  if (!job || job.status !== 'completed' || !job.mediaUrl) return null;
  const base = job.finishedAt || job.createdAt;
  if (!base) return null;
  return base + (retentionDays || 7) * 86400 * 1000;
}
