// Hình học thuần túy cho Canvas (không React, không DOM).
// Dùng chung cho: vị trí chấm nối, khung nhóm, đổi kích thước nút.
// nodeH là hàm đo chiều cao thật của nút (ResizeObserver ở Canvas.jsx);
// node.width ?? 260 là chiều rộng thật, NODE_DEFAULT_W là mặc định.

export const NODE_DEFAULT_W = 260;
export const GROUP_WRAP_PADDING = 24;
export const NODE_MIN_W = 120;
export const NODE_MIN_H = 80;

// Khung bao của 1 nút: { x, y, w, h }
export function nodeBounds(node, nodeH) {
  return {
    x: node.x,
    y: node.y,
    w: node.width ?? NODE_DEFAULT_W,
    h: nodeH(node),
  };
}

// Chấm nối bên trái (đích): giữa cạnh trái của nút
export function getConnectionTargetAnchor(node, nodeH) {
  return { x: node.x, y: node.y + nodeH(node) / 2 };
}

// Chấm nối bên phải (nguồn): giữa cạnh phải của nút
export function getConnectionSourceAnchor(node, nodeH) {
  return { x: node.x + (node.width ?? NODE_DEFAULT_W), y: node.y + nodeH(node) / 2 };
}

// Kiểm tra 1 đường nối có hợp lệ không trước khi tạo.
// Hiện chỉ chặn: tự nối chính mình, và nối nhóm -> nhóm.
export function normalizeConnection(fromId, toId, nodes) {
  if (fromId === toId) {
    return { ok: false, reason: 'Không thể nối một nút với chính nó' };
  }
  const from = (nodes || []).find((n) => n.id === fromId);
  const to = (nodes || []).find((n) => n.id === toId);
  if (!from || !to) {
    return { ok: false, reason: 'Không tìm thấy nút để nối' };
  }
  if (from.type === 'group' && to.type === 'group') {
    return { ok: false, reason: 'Không thể nối hai nhóm với nhau' };
  }
  return { ok: true };
}

// Thu nhỏ (w, h) giữ nguyên tỉ lệ, không vượt quá maxW/maxH.
export function fitNodeSize(w, h, maxW = 640, maxH = 640) {
  const s = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

// Kích thước từ tỉ lệ (vd 16/9) với chiều rộng gốc cho trước.
export function nodeSizeFromRatio(ratio, baseW = 260) {
  return { width: baseW, height: Math.round(baseW / ratio) };
}

// Khung bao của 1 nhóm = khung bao các thành viên + padding mỗi phía.
export function groupBounds(members, nodeH, padding = GROUP_WRAP_PADDING) {
  if (!members?.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of members) {
    const b = nodeBounds(m, nodeH);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  };
}

// Nút có thuộc về nhóm này không (qua groupId).
export function isNodeInGroup(node, group) {
  return !!node && !!group && node.groupId === group.id;
}
