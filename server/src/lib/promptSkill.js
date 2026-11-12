import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'prompt-writer-skill.md'
);

/**
 * Đọc kỹ năng viết prompt (file markdown trong server/src/data).
 * Đọc lại mỗi lần gọi để người dùng sửa file là có hiệu lực ngay,
 * không cần khởi động lại máy chủ. Trả về chuỗi rỗng nếu file thiếu.
 */
export function getPromptSkill() {
  try {
    return fs.readFileSync(SKILL_PATH, 'utf8');
  } catch {
    return '';
  }
}
