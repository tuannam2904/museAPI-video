import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Type, Image as ImageIcon, Video, Trash2, Maximize, Loader2, X, Sparkles, Wand2, Check,
  MousePointer2, Hand, ImagePlus, Expand, Clapperboard,
  Download, Undo2, Redo2, Menu, Palette, Eraser, Crosshair, Sun, Moon,
  Group, Ungroup,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { getCanvasTheme } from '../lib/canvas-theme.js';
import {
  nodeBounds, getConnectionTargetAnchor, getConnectionSourceAnchor,
  normalizeConnection, fitNodeSize, nodeSizeFromRatio, groupBounds, isNodeInGroup,
} from '../lib/canvas-geometry.js';
import { useAuth } from '../store/auth.jsx';
import { useToast, Modal } from '../components/ui.jsx';
import { useConfirmDialog } from '../components/ConfirmDialog.jsx';
import NodeInspector from '../components/NodeInspector.jsx';
import CanvasMinimap from '../components/canvas/CanvasMinimap.jsx';
import CanvasSidePanel from '../components/canvas/CanvasSidePanel.jsx';
import CanvasAgentPanel from '../components/canvas/CanvasAgentPanel.jsx';
import StoryboardDrawer from '../components/StoryboardDrawer.jsx';

const STORE_KEY = 'xm_canvas_v1';
const GRID_KEY = 'xm_canvas_grid';
const NODE_W = 260;
const NODE_H = 170;
// Chiều cao node khi render KHÔNG cố định: <p> văn bản dùng min-h 76px (border-box)
// nên node text cao 162px (ít chữ) tới 186px (đủ 4 dòng); node ảnh/video cố định 214px.
// Vì vậy không dùng số cứng: đo chiều cao thật bằng ResizeObserver (xem nodeHeights
// trong Canvas), nodeHGuess chỉ là giá trị tạm trước khi đo xong. Đường nối vẽ ở
// nodeH/2, chấm tròn ở top-1/2 của node thật, nên 2 số này phải khớp nhau thì
// đường mới chạm đúng tâm chấm tròn.
const nodeHGuess = (n) => (n.type === 'text' ? 174 : 214);

// Nhờ Muse viết lại câu lệnh (dùng tài khoản Muse đã liên kết) — dùng chung
// cho nút văn bản đang nhập trực tiếp (trước đây nằm trong NodeInspector).
const ASSIST_SYSTEM = 'Bạn là trợ lý viết prompt cho công cụ tạo video và ảnh AI. Người dùng mô tả ý tưởng bằng tiếng Việt. Nhiệm vụ của bạn: viết lại thành một prompt chi tiết, sinh động, sẵn sàng dùng để tạo video/ảnh. Chỉ trả về duy nhất nội dung prompt, không giải thích, không thêm tiêu đề hay dấu ngoặc kép bao quanh. Prompt viết bằng tiếng Việt.';

// Snapshot {nodes, links} cho lịch sử hoàn tác (deep copy)
const snapshotDoc = (d) => JSON.parse(JSON.stringify({ nodes: d.nodes, links: d.links || [] }));
// Chữ ký chỉ tính thay đổi cấu trúc (thêm/xóa/di chuyển/nối/gỡ nối/sửa chữ):
// tiến độ %, trạng thái job, mediaUrl, jobId, lỗi không tạo mục lịch sử.
const structuralSig = (d) => JSON.stringify({
  nodes: d.nodes.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, width: n.width, height: n.height, groupId: n.groupId, disabledInputs: n.disabledInputs, text: n.text, label: n.label, size: n.size, duration: n.duration })),
  links: d.links || [],
});

let seq = 1;
const newId = () => `n_${Date.now().toString(36)}_${seq++}`;

const defaultDoc = () => ({
  title: 'Canvas vô hạn',
  nodes: [
    {
      id: newId(),
      type: 'text',
      x: 420,
      y: 240,
      width: NODE_W,
      text: 'Nhập hoặc viết từ ô nhập bên dưới',
      label: 'Văn bản 1',
    },
  ],
  links: [],
});

export default function Canvas() {
  const { refresh } = useAuth();
  const toast = useToast();
  const confirmDialog = useConfirmDialog();

  const [doc, setDoc] = useState(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Tài liệu cũ chưa có title: mặc định "Canvas vô hạn"
        // Di trú Phase 4: nút cũ chưa có width/height thì thêm mặc định,
        // KHÔNG xóa hay di chuyển nút/link nào.
        const nodes = (parsed.nodes || []).map((n) => ({
          ...n,
          width: n.width ?? NODE_W,
          height: n.height ?? nodeHGuess(n),
        }));
        return { title: 'Canvas vô hạn', links: [], ...parsed, nodes };
      }
    } catch { /* ignore */ }
    return defaultDoc();
  });
  const theme = getCanvasTheme();

  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [inspectorId, setInspectorId] = useState(null); // id nút đang mở bảng cấu hình
  const inspectorIdRef = useRef(null);
  inspectorIdRef.current = inspectorId;
  const [editingTextId, setEditingTextId] = useState(null); // id nút văn bản đang nhập trực tiếp trong nút
  const [assistingText, setAssistingText] = useState(false); // đang nhờ Muse viết lại câu lệnh của nút văn bản
  const [viewing, setViewing] = useState(null); // nút đang mở xem video/ảnh to
  const [sideOpen, setSideOpen] = useState(false); // bảng bên trái (tab Node / Prompt)
  const [sideTab, setSideTab] = useState('nodes'); // tab mặc định khi mở bảng bên
  const [storyOpen, setStoryOpen] = useState(false); // drawer bảng phân cảnh
  const [agentOpen, setAgentOpen] = useState(false); // panel Agent làm phim (Phase 6, bên phải)
  const [tool, setTool] = useState('select'); // select | hand
  // Giao diện dock (Phase 3): chế độ lưới nền + hiện/ẩn dòng thông tin nút
  const [gridMode, setGridMode] = useState(() => {
    try { return localStorage.getItem(GRID_KEY) || 'dots'; } catch { return 'dots'; }
  }); // dots | lines | blank
  const [showNodeInfo, setShowNodeInfo] = useState(true);
  const [appearanceOpen, setAppearanceOpen] = useState(false); // popover Giao diện
  const dockFileRef = useRef(null); // input file ẩn cho nút Tải ảnh trên dock
  const [vpSize, setVpSize] = useState({ w: 800, h: 500 });

  const viewportRef = useRef(null);
  const dragRef = useRef(null); // { mode:'pan'|'node'|'link', ... }
  // Chụm 2 ngón để zoom (cảm ứng): { pointers: Map<id,{x,y}>, startDist, startZ, startMid, startView }
  const pinchRef = useRef(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const viewRef = useRef(view);
  viewRef.current = view;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Lịch sử hoàn tác/làm lại (chỉ trong bộ nhớ, không lưu localStorage)
  const historyRef = useRef({ past: [], future: [] });
  const lastHistoryRef = useRef(null); // snapshot {nodes, links} trước thay đổi gần nhất
  const lastSigRef = useRef(null); // chữ ký cấu trúc của lastHistoryRef
  const applyingHistoryRef = useRef(false); // đang áp dụng undo/redo: không ghi lại
  const historyPausedRef = useRef(false); // syncJobs cập nhật tiến độ: không ghi lại
  const historyCommitTimerRef = useRef(null);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const clipboardRef = useRef(null); // { nodes: [...], links: [...] } đã sao chép
  // Khung chọn vùng bằng Ctrl/Cmd+kéo (tọa độ canvas/world)
  const [selectionBox, setSelectionBox] = useState(null);
  const selectionBoxRef = useRef(null);
  const setBox = (b) => { selectionBoxRef.current = b; setSelectionBox(b); };
  // Đo chiều cao THẬT của từng node (ResizeObserver) để đường nối chạm đúng tâm
  // chấm tròn: node text cao 162-186px tùy độ dài chữ, không có số cứng nào đúng hết.
  const [nodeHeights, setNodeHeights] = useState({});
  const heightsRef = useRef({});
  const nodeEls = useRef(new Map());
  const nodeRefCbs = useRef(new Map());
  const roRef = useRef(null);
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      const next = { ...heightsRef.current };
      for (const e of entries) {
        const id = e.target.getAttribute('data-node-id');
        const h = Math.round(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight);
        if (id && next[id] !== h) { next[id] = h; changed = true; }
      }
      if (changed) { heightsRef.current = next; setNodeHeights(next); }
    });
    roRef.current = ro;
    nodeEls.current.forEach((el) => ro.observe(el));
    return () => { ro.disconnect(); roRef.current = null; };
  }, []);
  // Callback ref ổn định cho từng node (tránh detach/attach lại mỗi lần render)
  const getNodeRef = (id) => {
    if (!nodeRefCbs.current.has(id)) {
      nodeRefCbs.current.set(id, (el) => {
        if (el) { nodeEls.current.set(id, el); roRef.current?.observe(el); }
        else {
          const old = nodeEls.current.get(id);
          if (old) roRef.current?.unobserve(old);
          nodeEls.current.delete(id);
        }
      });
    }
    return nodeRefCbs.current.get(id);
  };
  // Đọc qua ref nên không bị kẹt giá trị cũ trong các window listener (onUp).
  // Ưu tiên chiều cao đo thật (ResizeObserver); chưa đo xong thì dùng
  // node.height (do kéo đổi cỡ / đổi tỉ lệ đặt), cuối cùng mới đoán.
  const nodeH = useCallback((n) => heightsRef.current[n.id] ?? n.height ?? nodeHGuess(n), []);
  const [linkDrag, setLinkDrag] = useState(null); // { from, side, x, y } — đầu tạm của đường nối đang kéo
  const bootRef = useRef(false);

  // 首次进入默认选中第一个节点（对齐原站的高亮态）
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    if (doc.nodes.length) setSelected([doc.nodes[0].id]);
  }, [doc.nodes]);

  /* ---------------- 持久化 ---------------- */
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      localStorage.setItem(STORE_KEY, JSON.stringify(doc));
      setSaved(true);
    }, 400);
    return () => clearTimeout(t);
  }, [doc]);

  // Chế độ lưới nền lưu riêng (khóa nhỏ, không nằm trong doc)
  useEffect(() => {
    try { localStorage.setItem(GRID_KEY, gridMode); } catch { /* ignore */ }
  }, [gridMode]);

  /* ---------------- 历史记录（Hoàn tác / Làm lại） ---------------- */
  // Chỉ ghi lại thay đổi cấu trúc, debounce ~180ms để cả lần kéo nút gộp
  // thành 1 mục. Lịch sử chỉ nằm trong bộ nhớ, không lưu vào localStorage.
  useEffect(() => {
    if (lastHistoryRef.current == null) {
      lastHistoryRef.current = snapshotDoc(doc);
      lastSigRef.current = structuralSig(doc);
      return undefined;
    }
    if (applyingHistoryRef.current) {
      // Đang áp dụng undo/redo: không ghi lại chính nó
      applyingHistoryRef.current = false;
      lastHistoryRef.current = snapshotDoc(doc);
      lastSigRef.current = structuralSig(doc);
      return undefined;
    }
    if (historyPausedRef.current) return undefined;
    const sig = structuralSig(doc);
    if (sig === lastSigRef.current) return undefined; // chỉ đổi tiến độ/trạng thái job
    if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
    historyCommitTimerRef.current = setTimeout(() => {
      historyCommitTimerRef.current = null;
      const prev = lastHistoryRef.current;
      const cur = snapshotDoc(docRef.current);
      if (!prev || structuralSig(cur) === structuralSig(prev)) {
        lastHistoryRef.current = cur;
        lastSigRef.current = structuralSig(cur);
        return;
      }
      const past = [...historyRef.current.past.slice(-49), prev];
      historyRef.current = { past, future: [] };
      lastHistoryRef.current = cur;
      lastSigRef.current = structuralSig(cur);
      setHistoryState({ canUndo: past.length > 0, canRedo: false });
    }, 180);
    return undefined;
  }, [doc]);

  useEffect(() => () => {
    if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
  }, []);

  /* ---------------- 视口变换 ---------------- */
  const screenToCanvas = (clientX, clientY) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const v = viewRef.current;
    return {
      x: (clientX - rect.left - v.x) / v.z,
      y: (clientY - rect.top - v.y) / v.z,
    };
  };

  const zoomBy = (factor, cx, cy) => {
    setView((v) => {
      const z = Math.min(4, Math.max(0.1, v.z * factor));
      const rect = viewportRef.current?.getBoundingClientRect();
      const px = cx ?? (rect ? rect.width / 2 : 0);
      const py = cy ?? (rect ? rect.height / 2 : 0);
      // 以光标为中心缩放
      const nx = px - ((px - v.x) / v.z) * z;
      const ny = py - ((py - v.y) / v.z) * z;
      return { x: nx, y: ny, z };
    });
  };

  const onWheel = (e) => {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    const cx = rect ? e.clientX - rect.left : undefined;
    const cy = rect ? e.clientY - rect.top : undefined;
    zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08, cx, cy);
  };

  /* ---------------- 拖拽 ---------------- */
  const onBackgroundDown = (e) => {
    if (e.button === 2) return;
    const isMiddle = e.button === 1;
    const isSpace = e.getModifierState?.(' ') || false;
    // 只有空白处、中键、按住空格时平移
    if (tool !== 'hand' && !isMiddle && !isSpace && e.target !== e.currentTarget && !e.target.dataset.canvasbg) return;
    // Ctrl/Cmd+kéo trên nền trống (chuột): chọn vùng thay vì di chuyển
    if ((e.ctrlKey || e.metaKey) && e.pointerType !== 'touch' && tool !== 'hand' && e.button === 0
      && (e.target === e.currentTarget || e.target.dataset.canvasbg)) {
      const p = screenToCanvas(e.clientX, e.clientY);
      dragRef.current = { mode: 'box', startX: e.clientX, startY: e.clientY };
      setBox({ startWorldX: p.x, startWorldY: p.y, currentWorldX: p.x, currentWorldY: p.y });
      return;
    }
    setSelected([]);
    setInspectorId(null);
    setEditingTextId(null);
    dragRef.current = {
      mode: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      ox: view.x,
      oy: view.y,
    };
  };

  const onNodeDown = (e, node) => {
    if (tool === 'hand') return; // 抓手模式：交给画布平移
    e.stopPropagation();
    if (e.button === 2) return;
    const multi = e.shiftKey;
    setSelected((sel) => {
      if (multi) return sel.includes(node.id) ? sel.filter((i) => i !== node.id) : [...sel, node.id];
      return sel.includes(node.id) ? sel : [node.id];
    });
    // Chọn nhiều thì đóng bảng; bấm đơn thì mở bảng ở lúc nhả chuột (xem onUp)
    // để kéo di chuyển nút không bật bảng lên
    if (multi) setInspectorId(null);
    // Bấm vào ảnh/video của nút thì mở xem to (không mở bảng); bấm chỗ khác thì mở bảng
    const fromMedia = !!e.target?.closest?.('[data-media]');
    // Kéo 1 nhóm thì các thành viên đi cùng; kéo nhiều nút thì ghi lại vị trí
    // gốc của tất cả nút sẽ di chuyển (kể cả thành viên của nhóm được chọn).
    const baseIds = multi ? [...selectedRef.current, node.id] : [node.id];
    const idsToMove = new Set(baseIds);
    for (const id of [...idsToMove]) {
      const g = doc.nodes.find((x) => x.id === id);
      if (g?.type === 'group') doc.nodes.filter((m) => m.groupId === id).forEach((m) => idsToMove.add(m.id));
    }
    const origins = {};
    for (const n of doc.nodes) {
      if (idsToMove.has(n.id)) origins[n.id] = { x: n.x, y: n.y };
    }
    dragRef.current = {
      mode: 'node',
      id: node.id,
      fromMedia,
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.x,
      nodeY: node.y,
      ids: [...idsToMove],
      origins,
    };
  };

  // Bắt đầu kéo nối từ chấm tròn của nút (chuột lẫn cảm ứng)
  const onPortDown = (e, node, side) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button === 2) return;
    dragRef.current = { mode: 'link', from: node.id };
    const anchor = side === 'left'
      ? getConnectionTargetAnchor(node, nodeH)
      : getConnectionSourceAnchor(node, nodeH);
    setLinkDrag({ from: node.id, side, x: anchor.x, y: anchor.y });
  };

  // Bắt đầu kéo đổi cỡ từ tay nắm góc của nút đang chọn (chuột lẫn cảm ứng)
  const onResizeDown = (e, node, corner) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button === 2) return;
    // Nút ảnh/video giữ nguyên tỉ lệ khung khi kéo; nút văn bản kéo tự do.
    const ratio = (node.type === 'image' || node.type === 'video')
      ? (node.width ?? NODE_W) / nodeH(node)
      : null;
    dragRef.current = {
      mode: 'resize',
      id: node.id,
      corner,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.x,
      origY: node.y,
      origW: node.width ?? NODE_W,
      origH: nodeH(node),
      ratio,
    };
  };

  useEffect(() => {
    // Chụm 2 ngón (cảm ứng) để zoom: theo dõi mọi con trỏ chạm vào canvas.
    const onDown = (e) => {
      if (e.pointerType === 'mouse') return; // chuột chỉ có 1 con trỏ, không pinch được
      if (!viewportRef.current?.contains(e.target)) return;
      const pr = pinchRef.current || (pinchRef.current = { pointers: new Map() });
      pr.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pr.pointers.size === 2) {
        const [a, b] = [...pr.pointers.values()];
        const rect = viewportRef.current?.getBoundingClientRect();
        pr.startDist = Math.hypot(a.x - b.x, a.y - b.y);
        pr.startZ = viewRef.current.z;
        pr.startMid = { x: (a.x + b.x) / 2 - (rect?.left || 0), y: (a.y + b.y) / 2 - (rect?.top || 0) };
        pr.startView = { x: viewRef.current.x, y: viewRef.current.y };
        // Hủy drag đang dở (kéo nút / pan / nối / chọn vùng) để hai ngón chỉ zoom
        dragRef.current = null;
        setLinkDrag(null);
        setBox(null);
      }
    };
    const onMove = (e) => {
      const pr = pinchRef.current;
      if (pr && pr.pointers.has(e.pointerId)) {
        pr.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pr.pointers.size === 2 && pr.startDist > 0) {
          const [a, b] = [...pr.pointers.values()];
          const rect = viewportRef.current?.getBoundingClientRect();
          const midX = (a.x + b.x) / 2 - (rect?.left || 0);
          const midY = (a.y + b.y) / 2 - (rect?.top || 0);
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const z = Math.min(4, Math.max(0.1, pr.startZ * (dist / pr.startDist)));
          // Giữ điểm canvas dưới điểm giữa hai ngón cố định, đồng thời dịch theo điểm giữa
          const nx = midX - ((pr.startMid.x - pr.startView.x) / pr.startZ) * z;
          const ny = midY - ((pr.startMid.y - pr.startView.y) / pr.startZ) * z;
          setView({ x: nx, y: ny, z });
          return;
        }
      }
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'box') {
        const p = screenToCanvas(e.clientX, e.clientY);
        const prev = selectionBoxRef.current;
        if (prev) setBox({ ...prev, currentWorldX: p.x, currentWorldY: p.y });
        return;
      }
      if (d.mode === 'link') {
        const p = screenToCanvas(e.clientX, e.clientY);
        setLinkDrag((prev) => (prev ? { ...prev, x: p.x, y: p.y } : prev));
        return;
      }
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;

      if (d.mode === 'pan') {
        setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
      } else if (d.mode === 'resize') {
        // Kéo đổi cỡ: delta chuột chia theo zoom để ra tọa độ world.
        // Góc tây/bắc thì cạnh đối diện giữ nguyên (x/y dịch theo).
        const cdx = dx / view.z;
        const cdy = dy / view.z;
        const west = d.corner.includes('w');
        const north = d.corner.includes('n');
        let newW = west ? d.origW - cdx : d.origW + cdx;
        let newH = north ? d.origH - cdy : d.origH + cdy;
        if (d.ratio) {
          // Giữ tỉ lệ khung: trục nào đổi nhiều hơn thì trục đó dẫn.
          if (Math.abs(newW - d.origW) >= Math.abs(newH - d.origH)) newH = newW / d.ratio;
          else newW = newH * d.ratio;
        }
        newW = Math.max(120, newW);
        newH = Math.max(80, newH);
        if (d.ratio) {
          if (newW / d.ratio < 80) { newH = 80; newW = 80 * d.ratio; }
          else newH = newW / d.ratio;
        }
        const nx = west ? d.origX + d.origW - newW : d.origX;
        const ny = north ? d.origY + d.origH - newH : d.origY;
        setDoc((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === d.id
            ? { ...n, x: Math.round(nx), y: Math.round(ny), width: Math.round(newW), height: Math.round(newH) }
            : n)),
        }));
      } else if (d.mode === 'node') {
        const cdx = dx / view.z;
        const cdy = dy / view.z;
        setDoc((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => {
            if (d.origins && d.origins[n.id]) {
              return { ...n, x: d.origins[n.id].x + cdx, y: d.origins[n.id].y + cdy };
            }
            if (n.id === d.id) return { ...n, x: d.nodeX + cdx, y: d.nodeY + cdy };
            return n;
          }),
        }));
      }
    };
    const onUp = (e) => {
      const pr = pinchRef.current;
      if (pr) {
        pr.pointers.delete(e.pointerId);
        if (pr.pointers.size < 2) pinchRef.current = null;
      }
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.mode === 'box') {
        const b = selectionBoxRef.current;
        setBox(null);
        if (b) {
          const x0 = Math.min(b.startWorldX, b.currentWorldX);
          const x1 = Math.max(b.startWorldX, b.currentWorldX);
          const y0 = Math.min(b.startWorldY, b.currentWorldY);
          const y1 = Math.max(b.startWorldY, b.currentWorldY);
          const ids = docRef.current.nodes
            .filter((n) => {
              const b = nodeBounds(n, nodeH);
              return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
            })
            .map((n) => n.id);
          setSelected(ids);
          setInspectorId(null);
        }
        return;
      }
      if (d.mode === 'resize') {
        // Kéo đổi cỡ xong: không mở bảng cấu hình, không làm gì thêm
        // (đổi cỡ đã ghi vào lịch sử qua structuralSig).
        return;
      }
      if (d.mode === 'node') {
        // Bấm (không kéo) vào nút: bấm vào ảnh/video thì mở xem to; nút văn bản
        // thì nhập trực tiếp trong nút; nút ảnh/video thì mở bảng cấu hình
        const moved = e && e.clientX != null ? Math.hypot(e.clientX - d.startX, e.clientY - d.startY) : 99;
        if (moved < 6) {
          if (d.fromMedia) {
            const node = docRef.current.nodes.find((n) => n.id === d.id);
            if (node?.mediaUrl) setViewing(node);
          } else {
            const node = docRef.current.nodes.find((n) => n.id === d.id);
            // Nhóm không có bảng cấu hình riêng
            if (node?.type === 'text') {
              setInspectorId(null);
              setEditingTextId(d.id);
            } else if (node?.type !== 'group') {
              setEditingTextId(null);
              setInspectorId(d.id);
            }
          }
          return;
        }
        // Kéo nút thành viên ra khỏi nhóm: tâm nút rời khỏi khung nhóm thì hết groupId;
        // nhóm nào hết thành viên thì tự xóa.
        const draggedIds = d.origins ? Object.keys(d.origins) : [d.id];
        if (draggedIds.length) {
          setDoc((prev) => {
            let changed = false;
            const nodes = prev.nodes.map((n) => {
              if (!draggedIds.includes(n.id) || !n.groupId) return n;
              const g = prev.nodes.find((x) => x.id === n.groupId);
              if (!g) { changed = true; return { ...n, groupId: undefined }; }
              const b = nodeBounds(n, nodeH);
              const gb = nodeBounds(g, nodeH);
              const cx = b.x + b.w / 2;
              const cy = b.y + b.h / 2;
              if (cx < gb.x || cx > gb.x + gb.w || cy < gb.y || cy > gb.y + gb.h) {
                changed = true;
                return { ...n, groupId: undefined };
              }
              return n;
            });
            return changed ? pruneEmptyGroups({ ...prev, nodes }) : prev;
          });
        }
        return;
      }
      if (d.mode !== 'link') return;
      setLinkDrag(null);
      if (!e || e.clientX == null) return;
      const cur = docRef.current;
      const p = screenToCanvas(e.clientX, e.clientY);
      const target = cur.nodes.find(
        (n) => n.id !== d.from && p.x >= n.x && p.x <= n.x + (n.width ?? NODE_W) && p.y >= n.y && p.y <= n.y + nodeH(n)
      );
      if (!target) return;
      const src = cur.nodes.find((n) => n.id === d.from);
      if (!src) return;
      // Nối theo chiều trái -> phải để đường cong hiển thị đúng
      const from = target.x >= src.x ? src.id : target.id;
      const to = target.x >= src.x ? target.id : src.id;
      const check = normalizeConnection(from, to, cur.nodes);
      if (!check.ok) {
        toast(check.reason || 'Không thể nối hai nút này', 'error');
        return;
      }
      const exists = (cur.links || []).some(
        (l) => (l.from === from && l.to === to) || (l.from === to && l.to === from)
      );
      if (exists) {
        toast('Hai nút này đã nối với nhau', 'error');
        return;
      }
      setDoc((prev) => ({ ...prev, links: [...(prev.links || []), { from, to }] }));
      toast('Đã nối 2 nút', 'ok');
    };
    const onCancel = (e) => {
      const pr = pinchRef.current;
      if (pr) {
        if (e?.pointerId != null) pr.pointers.delete(e.pointerId);
        if (pr.pointers.size < 2) pinchRef.current = null;
      }
      dragRef.current = null;
      setLinkDrag(null);
      setBox(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [view.z]);

  /* ---------------- 撤销/重做 + 复制粘贴 ---------------- */
  const applyHistory = (entry) => {
    if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
    applyingHistoryRef.current = true;
    lastHistoryRef.current = snapshotDoc(entry);
    lastSigRef.current = structuralSig(entry);
    // Giữ nguyên title của doc hiện tại (lịch sử chỉ lưu nodes/links)
    setDoc((d) => ({ ...d, nodes: entry.nodes, links: entry.links }));
    setSelected((sel) => sel.filter((id) => entry.nodes.some((n) => n.id === id)));
    setInspectorId((id) => (entry.nodes.some((n) => n.id === id) ? id : null));
  };

  const undoCanvas = () => {
    const { past, future } = historyRef.current;
    if (!past.length) return;
    const entry = past[past.length - 1];
    const cur = snapshotDoc(docRef.current);
    historyRef.current = { past: past.slice(0, -1), future: [cur, ...future] };
    setHistoryState({ canUndo: past.length - 1 > 0, canRedo: true });
    applyHistory(entry);
  };

  const redoCanvas = () => {
    const { past, future } = historyRef.current;
    if (!future.length) return;
    const [entry, ...rest] = future;
    const cur = snapshotDoc(docRef.current);
    historyRef.current = { past: [...past, cur], future: rest };
    setHistoryState({ canUndo: true, canRedo: rest.length > 0 });
    applyHistory(entry);
  };

  const copySelected = () => {
    const sel = selectedRef.current;
    if (!sel.length) return;
    const nodes = docRef.current.nodes
      .filter((n) => sel.includes(n.id))
      .map((n) => JSON.parse(JSON.stringify(n)));
    const ids = new Set(nodes.map((n) => n.id));
    const links = (docRef.current.links || [])
      .filter((l) => ids.has(l.from) && ids.has(l.to))
      .map((l) => ({ ...l }));
    clipboardRef.current = { nodes, links };
  };

  const pasteClipboard = () => {
    const clip = clipboardRef.current;
    if (!clip?.nodes?.length) return;
    const idMap = {};
    // Dán ra nút mới: nhóm không sao chép theo, nút dán ra không còn trong nhóm cũ
    const nodes = clip.nodes.filter((n) => n.type !== 'group').map((n) => {
      const copy = JSON.parse(JSON.stringify(n));
      const id = newId();
      idMap[n.id] = id;
      copy.id = id;
      copy.x = n.x + 24;
      copy.y = n.y + 24;
      delete copy.groupId;
      // Dán ra nút mới: không mang theo job đang chạy của nút gốc
      delete copy.jobId;
      delete copy.status;
      delete copy.progress;
      delete copy.error;
      return copy;
    });
    if (!nodes.length) return;
    const links = clip.links
      .filter((l) => idMap[l.from] && idMap[l.to])
      .map((l) => ({ from: idMap[l.from], to: idMap[l.to] }));
    setDoc((d) => ({ ...d, nodes: [...d.nodes, ...nodes], links: [...(d.links || []), ...links] }));
    setSelected(nodes.map((n) => n.id));
    setInspectorId(null);
  };

  /* ---------------- 键盘 ---------------- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.activeElement?.isContentEditable || e.target?.closest?.('[contenteditable="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoCanvas(); else undoCanvas();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redoCanvas(); return; }
      if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copySelected(); return; }
      if (mod && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); pasteClipboard(); return; }
      if (mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected(); else groupSelected();
        return;
      }
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelected(docRef.current.nodes.map((n) => n.id));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selected.length) return;
        e.preventDefault();
        setDoc((d) => removeNodes(d, selected));
        setSelected([]);
        setInspectorId(null);
      }
      if (!mod && (e.key === 'v' || e.key === 'V')) setTool('select');
      if (!mod && (e.key === 'h' || e.key === 'H')) setTool('hand');
      if (e.key === 'Escape') {
        setSelected([]);
        setInspectorId(null);
        setEditingTextId(null);
        setSideOpen(false);
        setBox(null);
        if (dragRef.current?.mode === 'link') { dragRef.current = null; setLinkDrag(null); }
        else if (dragRef.current?.mode === 'box') { dragRef.current = null; }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  /* ---------------- 节点操作 ---------------- */
  const addNode = (type) => {
    const center = screenToCanvas(
      (viewportRef.current?.getBoundingClientRect().left ?? 0) + (viewportRef.current?.clientWidth ?? 400) / 2,
      (viewportRef.current?.getBoundingClientRect().top ?? 0) + (viewportRef.current?.clientHeight ?? 300) / 2
    );
    const n = {
      id: newId(),
      type,
      x: Math.round(center.x - NODE_W / 2 + (Math.random() * 40 - 20)),
      y: Math.round(center.y - NODE_H / 2 + (Math.random() * 40 - 20)),
      width: NODE_W,
      text: '',
      label: type === 'text' ? 'Văn bản' : type === 'image' ? 'Hình ảnh' : 'Video',
    };
    setDoc((d) => ({ ...d, nodes: [...d.nodes, n] }));
    setSelected([n.id]);
    if (type === 'text') {
      setInspectorId(null);
      setEditingTextId(n.id); // nút văn bản mới: nhập trực tiếp ngay, không mở bảng
    } else {
      setEditingTextId(null);
      setInspectorId(n.id);
    }
  };

  const removeSelected = () => {
    setDoc((d) => removeNodes(d, selected));
    setSelected([]);
    setInspectorId(null);
  };

  // Xóa toàn bộ canvas (hỏi trước; vẫn hoàn tác được bằng Ctrl+Z)
  const clearCanvas = async () => {
    if (!doc.nodes.length) return;
    if (!(await confirmDialog('Xóa hết tất cả nút trên canvas?', { dontAskKey: 'canvas-clear' }))) return;
    setDoc((d) => ({ ...d, nodes: [], links: [] }));
    setSelected([]);
    setInspectorId(null);
  };

  // Tải ảnh từ máy lên thành một nút ảnh mới ở giữa màn hình
  const uploadAsNewNode = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Chỉ nhận tệp hình ảnh', 'error');
    setBusy(true);
    try {
      const out = await api.upload([file]);
      const url = out.files?.[0]?.url;
      if (!url) throw new Error('Tải lên thất bại');
      const center = screenToCanvas(
        (viewportRef.current?.getBoundingClientRect().left ?? 0) + (viewportRef.current?.clientWidth ?? 400) / 2,
        (viewportRef.current?.getBoundingClientRect().top ?? 0) + (viewportRef.current?.clientHeight ?? 300) / 2
      );
      const n = {
        id: newId(),
        type: 'image',
        x: Math.round(center.x - NODE_W / 2),
        y: Math.round(center.y - NODE_H / 2),
        width: NODE_W,
        text: 'Ảnh tải lên',
        label: 'Hình ảnh',
        mediaUrl: url,
        status: 'done',
      };
      setDoc((d) => ({ ...d, nodes: [...d.nodes, n] }));
      setSelected([n.id]);
      setInspectorId(n.id);
      toast('Đã tải ảnh lên canvas', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Đưa một prompt từ thư viện vào Canvas thành nút văn bản mới
  const usePrompt = (p) => {
    const center = screenToCanvas(
      (viewportRef.current?.getBoundingClientRect().left ?? 0) + (viewportRef.current?.clientWidth ?? 400) / 2,
      (viewportRef.current?.getBoundingClientRect().top ?? 0) + (viewportRef.current?.clientHeight ?? 300) / 2
    );
    const n = {
      id: newId(),
      type: 'text',
      x: Math.round(center.x - NODE_W / 2),
      y: Math.round(center.y - NODE_H / 2),
      width: NODE_W,
      text: p.text || '',
      label: (p.title || 'Prompt mẫu').slice(0, 20),
    };
    setDoc((d) => ({ ...d, nodes: [...d.nodes, n] }));
    setSelected([n.id]);
    setInspectorId(null);
    setEditingTextId(n.id); // mở nhập trực tiếp để xem/sửa prompt vừa đưa vào
    toast('Đã đưa prompt vào Canvas', 'ok');
  };

  // Đưa bảng phân cảnh lên Canvas: mỗi shot thành một nút video, nối tiếp nhau.
  // filmSceneIds (tùy chọn, Agent làm phim dùng): gắn id cảnh của phim vào
  // từng nút để khi cảnh có video thì điền media đúng nút. Trả về các nút đã tạo.
  const sendShots = (shots, aspect, filmSceneIds) => {
    if (!shots?.length) return [];
    const center = screenToCanvas(
      (viewportRef.current?.getBoundingClientRect().left ?? 0) + (viewportRef.current?.clientWidth ?? 400) / 2,
      (viewportRef.current?.getBoundingClientRect().top ?? 0) + (viewportRef.current?.clientHeight ?? 300) / 2
    );
    const startX = Math.round(center.x - NODE_W / 2);
    const startY = Math.round(center.y - NODE_H / 2);
    const nodes = shots.map((s, i) => ({
      id: newId(),
      type: 'video',
      x: startX + i * (NODE_W + 60),
      y: startY,
      width: NODE_W,
      text: s.prompt || s.visual || '',
      label: `Shot ${s.shot || i + 1}`,
      size: aspect || '9:16',
      duration: s.duration || 8,
      ...(filmSceneIds?.[i] ? { filmSceneId: filmSceneIds[i] } : {}),
    }));
    const links = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }));
    setDoc((d) => ({ ...d, nodes: [...d.nodes, ...nodes], links: [...(d.links || []), ...links] }));
    setSelected([nodes[0].id]);
    setInspectorId(nodes[0].id);
    setStoryOpen(false);
    toast(`Đã đưa ${nodes.length} shot lên Canvas`, 'ok');
    return nodes;
  };

  // Agent làm phim dùng: tạo nút video cho các cảnh phim qua sendShots
  // (giữ nguyên logic xếp hàng + nối tiếp), trả về các nút đã tạo.
  const createNodesFromShots = (shots, aspect, filmSceneIds) => sendShots(shots, aspect, filmSceneIds);

  // Agent làm phim dùng: cảnh phim có video thì điền media vào nút canvas
  // có filmSceneId khớp (đánh dấu đã tạo xong).
  const updateNodeMedia = (filmSceneId, mediaUrl) => {
    if (!filmSceneId || !mediaUrl) return;
    setDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.filmSceneId === filmSceneId
        ? { ...n, mediaUrl, status: 'done', progress: 100, error: null }
        : n)),
    }));
  };

  // Agent làm phim dùng: phim ghép xong thì tạo nút kết quả ở cuối hàng cảnh
  // (bên phải nút shot cuối cùng, nối từ nút đó), trả về nút đã tạo.
  const handleFilmDone = (finalUrl, shotNodes) => {
    if (!finalUrl) return [];
    const row = (shotNodes?.length ? shotNodes : docRef.current.nodes.filter((n) => n.filmSceneId))
      .map((n) => docRef.current.nodes.find((x) => x.id === n.id) || n);
    const last = row.length
      ? row.reduce((a, b) => (b.x > a.x ? b : a))
      : null;
    const n = {
      id: newId(),
      type: 'video',
      x: last ? last.x + (last.width ?? NODE_W) + 60 : 420,
      y: last ? last.y : 240,
      width: NODE_W,
      text: 'Phim hoàn chỉnh',
      label: 'Phim hoàn chỉnh',
      size: last?.size || '9:16',
      duration: last?.duration || 10,
      mediaUrl: finalUrl,
      status: 'done',
    };
    setDoc((d) => ({
      ...d,
      nodes: [...d.nodes, n],
      links: last ? [...(d.links || []), { from: last.id, to: n.id }] : (d.links || []),
    }));
    setSelected([n.id]);
    setInspectorId(n.id);
    toast('Đã đưa phim hoàn chỉnh lên Canvas', 'ok');
    return [n];
  };

  // Đưa 1 nhóm nút cho trước ra giữa màn hình (Agent làm phim dùng để focus
  // hàng cảnh / nút phim hoàn chỉnh); giữ nguyên mức zoom nếu khung vừa.
  const focusNodes = (nodes) => {
    const list = (nodes || []).map((n) => docRef.current.nodes.find((x) => x.id === n.id) || n).filter(Boolean);
    if (!list.length) return;
    const bs = list.map((n) => nodeBounds(n, nodeH));
    const minX = Math.min(...bs.map((b) => b.x));
    const minY = Math.min(...bs.map((b) => b.y));
    const maxX = Math.max(...bs.map((b) => b.x + b.w));
    const maxY = Math.max(...bs.map((b) => b.y + b.h));
    const rect = viewportRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 800;
    const h = rect?.height ?? 500;
    const z = Math.min(1.4, Math.max(0.3, Math.min(w / (maxX - minX + 160), h / (maxY - minY + 160))));
    setView({
      x: w / 2 - ((minX + maxX) / 2) * z,
      y: h / 2 - ((minY + maxY) / 2) * z,
      z,
    });
  };

  // Xuất canvas hiện tại ra file JSON (tải về máy, không gọi máy chủ)
  const exportCanvasJSON = () => {
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
    const safeTitle = (doc.title || 'canvas').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-') || 'canvas';
    const payload = {
      title: doc.title || 'Canvas vô hạn',
      exportedAt: now.toISOString(),
      nodes: doc.nodes,
      links: doc.links || [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-${safeTitle}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Đã xuất canvas ra file JSON', 'ok');
  };

  /* ---------------- Cấu hình nút ---------------- */
  const updateNode = (id, patch) => {
    setDoc((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  };

  // Nhờ Muse viết lại câu lệnh của nút văn bản đang nhập trực tiếp
  const assistNodeText = async (node) => {
    const idea = node.text?.trim();
    if (!idea) return toast('Nhập ý tưởng trước đã', 'error');
    setAssistingText(true);
    try {
      const out = await api.chat({
        model: 'muse-spark',
        messages: [
          { role: 'system', content: ASSIST_SYSTEM },
          { role: 'user', content: `Viết prompt video/ảnh: ${idea}` },
        ],
      });
      const content = out?.content?.trim();
      if (!content) throw new Error('Muse không trả về nội dung');
      updateNode(node.id, { text: content });
      toast('Đã viết xong prompt', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAssistingText(false);
    }
  };

  const deleteNode = (id) => {
    setDoc((d) => removeNodes(d, [id]));
    setSelected((s) => s.filter((i) => i !== id));
    setInspectorId(null);
    setEditingTextId(null);
  };

  // Đổi tên nhóm (nhấp đúp vào khung nhóm)
  const renameGroup = (node) => {
    const t = window.prompt('Tên nhóm', node.label || 'Nhóm');
    if (t != null) updateNode(node.id, { label: t });
  };

  // Gom các nút đang chọn (≥2) thành 1 nhóm (Ctrl/Cmd+G)
  const groupSelected = () => {
    const cur = docRef.current;
    const members = cur.nodes.filter((n) => selectedRef.current.includes(n.id) && n.type !== 'group');
    if (members.length < 2) return toast('Chọn ít nhất 2 nút để gom nhóm', 'error');
    const gid = newId();
    const b = groupBounds(members, nodeH);
    setDoc((d) => {
      let nodes = d.nodes.map((n) => (members.some((m) => m.id === n.id) ? { ...n, groupId: gid } : n));
      nodes = [...nodes, {
        id: gid, type: 'group',
        x: Math.round(b.x), y: Math.round(b.y),
        width: Math.round(b.w), height: Math.round(b.h),
        label: 'Nhóm', text: '',
      }];
      // Nút nào vừa gom từ nhóm cũ sang thì nhóm cũ có thể hết thành viên
      return pruneEmptyGroups({ ...d, nodes });
    });
    setSelected([gid]);
    setInspectorId(null);
    toast('Đã gom nhóm', 'ok');
  };

  // Bỏ gom (nhóm) các nút/nhóm đang chọn (Ctrl/Cmd+Shift+G)
  const ungroupSelected = () => {
    const cur = docRef.current;
    const gids = new Set();
    selectedRef.current.forEach((id) => {
      const n = cur.nodes.find((x) => x.id === id);
      if (!n) return;
      if (n.type === 'group') gids.add(n.id);
      else if (n.groupId) gids.add(n.groupId);
    });
    if (!gids.size) return toast('Chưa chọn nhóm nào để bỏ gom', 'error');
    setDoc((d) => {
      const nodes = d.nodes
        .map((n) => (n.groupId && gids.has(n.groupId) ? { ...n, groupId: undefined } : n))
        .filter((n) => !gids.has(n.id));
      return pruneLinks({ ...d, nodes });
    });
    setSelected([]);
    setInspectorId(null);
    toast('Đã bỏ gom nhóm', 'ok');
  };

  // Bật/tắt 1 đầu vào của nút (lưu trên nút đích, hoàn tác được)
  const toggleInput = (nodeId, inputId) => {
    setDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const cur = n.disabledInputs || [];
        return {
          ...n,
          disabledInputs: cur.includes(inputId) ? cur.filter((i) => i !== inputId) : [...cur, inputId],
        };
      }),
    }));
  };

  // Đổi tỉ lệ (seg trong bảng cấu hình): đổi cỡ nút giữ nguyên tâm,
  // chiều rộng giữ nguyên, chiều cao theo tỉ lệ mới (+ phần khung nút).
  const changeNodeSize = (nodeId, size) => {
    const node = docRef.current.nodes.find((n) => n.id === nodeId);
    if (!node || (node.type !== 'image' && node.type !== 'video')) {
      updateNode(nodeId, { size });
      return;
    }
    const [rw, rh] = String(size).split(':').map(Number);
    if (!rw || !rh) { updateNode(nodeId, { size }); return; }
    const w = node.width ?? NODE_W;
    const sized = nodeSizeFromRatio(rw / rh, w);
    const fitted = fitNodeSize(sized.width, sized.height, 640, 640);
    const chrome = 86; // tiêu đề + lề + dòng thông tin dưới nút
    const newH = fitted.height + chrome;
    const cx = node.x + w / 2;
    const cy = node.y + nodeH(node) / 2;
    updateNode(nodeId, {
      size,
      width: fitted.width,
      height: newH,
      x: Math.round(cx - fitted.width / 2),
      y: Math.round(cy - newH / 2),
    });
  };

  const removeLinkBetween = (a, b) => {
    setDoc((d) => ({
      ...d,
      links: (d.links || []).filter((l) => !((l.from === a && l.to === b) || (l.from === b && l.to === a))),
    }));
  };

  // Các nút nối VÀO nút này (đầu vào): văn bản làm câu lệnh, ảnh làm tham chiếu
  const nodeInputs = (nodeId, d = doc) => {
    const ids = (d.links || []).filter((l) => l.to === nodeId).map((l) => l.from);
    return ids.map((id) => d.nodes.find((n) => n.id === id)).filter(Boolean);
  };

  const nodeOutputs = (nodeId, d = doc) => {
    const ids = (d.links || []).filter((l) => l.from === nodeId).map((l) => l.to);
    return ids.map((id) => d.nodes.find((n) => n.id === id)).filter(Boolean);
  };

  // Tạo nội dung cho 1 nút ảnh/video từ các nút nối vào nó
  const generateNode = async (node) => {
    if (!node || node.type === 'text' || node.type === 'group') return;
    // Đầu vào: nút nối thẳng vào + thành viên của nhóm được nối vào
    // (nhóm mở rộng thành các nút con, như nối trực tiếp từng nút con);
    // đầu vào nào bị tắt (disabledInputs) thì bỏ qua.
    const disabled = new Set(node.disabledInputs || []);
    const expanded = [];
    for (const inp of nodeInputs(node.id)) {
      if (disabled.has(inp.id)) continue;
      if (inp.type === 'group') {
        for (const m of doc.nodes.filter((x) => x.groupId === inp.id)) {
          if (!disabled.has(m.id)) expanded.push(m);
        }
      } else {
        expanded.push(inp);
      }
    }
    const images = expanded.filter((n) => n.type === 'image' && n.mediaUrl).map((n) => n.mediaUrl);
    const textInputs = expanded.filter((n) => n.type === 'text' && n.text?.trim()).map((n) => n.text.trim());
    const promptText = node.text?.trim() || textInputs.join('\n') || '';
    if (promptText.length < 2) return toast('Nút này chưa có câu lệnh — nhập câu lệnh hoặc nối một nút văn bản vào', 'error');
    const isImage = node.type === 'image';
    setBusy(true);
    try {
      const { job } = isImage
        ? await api.createImage({ prompt: promptText, size: node.size || '1:1', images })
        : await api.createVideo({ prompt: promptText, duration: node.duration || 5, size: node.size || '16:9', images, ...(node.vip ? { vip: true } : {}) });
      updateNode(node.id, { jobId: job.id, status: 'running', progress: 10, mediaUrl: null, error: null });
      toast('Đã gửi nút để tạo', 'ok');
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Tải ảnh từ máy lên làm nội dung của 1 nút ảnh
  const uploadToNode = async (node, file) => {
    const out = await api.upload([file]);
    const url = out.files?.[0]?.url;
    if (!url) throw new Error('Tải lên thất bại');
    updateNode(node.id, { mediaUrl: url, status: 'done', text: node.text || 'Ảnh tải lên' });
  };

  const fitView = () => {
    if (!doc.nodes.length) return setView({ x: 0, y: 0, z: 1 });
    const bs = doc.nodes.map((n) => nodeBounds(n, nodeH));
    const minX = Math.min(...bs.map((b) => b.x));
    const minY = Math.min(...bs.map((b) => b.y));
    const maxX = Math.max(...bs.map((b) => b.x + b.w));
    const maxY = Math.max(...bs.map((b) => b.y + b.h));
    const rect = viewportRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 800;
    const h = rect?.height ?? 500;
    const z = Math.min(1.4, Math.max(0.3, Math.min(w / (maxX - minX + 160), h / (maxY - minY + 160))));
    setView({
      x: w / 2 - ((minX + maxX) / 2) * z,
      y: h / 2 - ((minY + maxY) / 2) * z,
      z,
    });
  };

  // Đưa các nút đang chọn ra giữa màn hình (giống fitView nhưng chỉ tính nút chọn)
  const focusSelected = () => {
    const nodes = doc.nodes.filter((n) => selected.includes(n.id));
    if (!nodes.length) return;
    const bs = nodes.map((n) => nodeBounds(n, nodeH));
    const minX = Math.min(...bs.map((b) => b.x));
    const minY = Math.min(...bs.map((b) => b.y));
    const maxX = Math.max(...bs.map((b) => b.x + b.w));
    const maxY = Math.max(...bs.map((b) => b.y + b.h));
    const rect = viewportRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 800;
    const h = rect?.height ?? 500;
    const z = Math.min(1.4, Math.max(0.3, Math.min(w / (maxX - minX + 160), h / (maxY - minY + 160))));
    setView({
      x: w / 2 - ((minX + maxX) / 2) * z,
      y: h / 2 - ((minY + maxY) / 2) * z,
      z,
    });
  };

  // Đưa 1 điểm world ra giữa màn hình, GIỮ nguyên mức zoom (bản đồ nhỏ dùng).
  // screen = world * z + view offset  =>  view.x = screenCX - world.x * z
  const centerOnWorld = (worldX, worldY) => {
    const w = vpSize.w;
    const h = vpSize.h;
    setView((v) => ({ ...v, x: w / 2 - worldX * v.z, y: h / 2 - worldY * v.z }));
  };

  // Đưa 1 nút ra giữa màn hình (giữ nguyên zoom), chọn nó và mở bảng cấu hình
  // để sửa/tạo ngay. Nhóm thì lấy tâm khung nhóm.
  const focusNode = (node) => {
    if (!node) return;
    const b = nodeBounds(node, nodeH);
    centerOnWorld(b.x + b.w / 2, b.y + b.h / 2);
    setSelected([node.id]);
    if (node.type === 'text') {
      setInspectorId(null);
      setEditingTextId(node.id);
    } else {
      setEditingTextId(null);
      setInspectorId(node.id);
    }
  };

  /* ---------------- 生成 ---------------- */
  /* ---------------- 任务轮询 ---------------- */
  const syncJobs = useCallback(async () => {
    const running = doc.nodes.filter((n) => n.jobId && n.status === 'running');
    if (!running.length) return;
    const results = await Promise.all(
      running.map(async (n) => {
        try { return { id: n.id, job: (await api.job(n.jobId)).job }; } catch { return null; }
      })
    );
    let justDone = null;
    // Cập nhật tiến độ job không ghi vào lịch sử hoàn tác
    historyPausedRef.current = true;
    setDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        const hit = results.find((r) => r?.id === n.id)?.job;
        if (!hit) return n;
        if (hit.status === 'completed') {
          const done = { ...n, status: 'done', mediaUrl: hit.mediaUrl || hit.result?.url };
          // Nút nào đang mở bảng cấu hình thì tự mở xem khi tạo xong
          if (inspectorIdRef.current === n.id) justDone = done;
          return done;
        }
        if (hit.status === 'failed') {
          return { ...n, status: 'failed', error: hit.error };
        }
        return { ...n, progress: hit.progress };
      }),
    }));
    historyPausedRef.current = false;
    if (justDone) setViewing(justDone);
  }, [doc.nodes]);

  useEffect(() => {
    const hasRunning = doc.nodes.some((n) => n.jobId && n.status === 'running');
    if (!hasRunning) return undefined;
    const t = setInterval(syncJobs, 2500);
    return () => clearInterval(t);
  }, [doc.nodes, syncJobs]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setVpSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodeById = Object.fromEntries(doc.nodes.map((n) => [n.id, n]));
  const links = (doc.links || []).filter((l) => nodeById[l.from] && nodeById[l.to]);

  // Vị trí bảng cấu hình: xổ xuống liền với nút đang chọn, cùng chiều rộng
  // với nút (như menu thả xuống), không rời rạc. Bảng phóng to theo mức zoom
  // (giới hạn 0.7–1.5x) nên chiều rộng CSS tính ngược lại để sau khi scale
  // bằng đúng chiều rộng hiển thị của nút. Không đủ chỗ bên dưới thì lật lên
  // trên nút (vẫn liền, mép dưới bảng chạm mép trên nút).
  const inspectorNode = inspectorId ? doc.nodes.find((n) => n.id === inspectorId) : null;
  const panelInfo = inspectorNode ? (() => {
    const PANEL_H = 260;
    const s = Math.min(1.5, Math.max(0.7, view.z)); // tỉ lệ bảng theo zoom
    const nodeW = inspectorNode.width ?? NODE_W;
    const scaledW = nodeW * view.z; // chiều rộng hiển thị của nút = của bảng
    const PANEL_W = scaledW / s; // chiều rộng CSS (chưa scale) để sau khi scale bằng đúng nút
    const scaledH = PANEL_H * s;
    const vh = vpSize.h;
    const nx = inspectorNode.x * view.z + view.x;
    const ny = inspectorNode.y * view.z + view.y;
    const nBottom = (inspectorNode.y + nodeH(inspectorNode)) * view.z + view.y;
    const below = nBottom + scaledH <= vh;
    const top = below ? nBottom : Math.max(0, ny - scaledH);
    const left = nx;
    return {
      style: { left, top, width: PANEL_W, transform: `scale(${s})`, transformOrigin: 'top left' },
      placement: below ? 'below' : 'above',
    };
  })() : null;
  const panelStyle = panelInfo?.style || null;
  const panelPlacement = panelInfo?.placement || 'below';

  // Nền canvas theo chế độ lưới (dots = chấm như cũ, lines = kẻ, blank = trống)
  const gridStyle = gridMode === 'dots'
    ? {
        backgroundSize: `${22 * view.z}px ${22 * view.z}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }
    : gridMode === 'lines'
      ? {
          backgroundColor: theme.canvas.background,
          backgroundImage: `linear-gradient(${theme.canvas.gridLine} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.gridLine} 1px, transparent 1px)`,
          backgroundSize: `${22 * view.z}px ${22 * view.z}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }
      : { backgroundColor: theme.canvas.background };

  return (
    <div className="relative h-full min-h-0">
      {/* ---------------- 画布 (toàn màn hình, thanh trên/dock nổi bên trên) ---------------- */}
      <div className="absolute inset-0 overflow-hidden">
        {/* 视图 */}
        <div
          ref={viewportRef}
          data-canvasbg="1"
          onWheel={onWheel}
          onPointerDown={onBackgroundDown}
          onContextMenu={(e) => e.preventDefault()}
          className={clsx(gridMode === 'dots' && 'dot-grid', 'absolute inset-0 touch-none select-none', tool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default')}
          style={gridStyle}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
          >
            {/* 连线 */}
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
              {links.map((l) => {
                const a = nodeById[l.from];
                const b = nodeById[l.to];
                const s = getConnectionSourceAnchor(a, nodeH);
                const t = getConnectionTargetAnchor(b, nodeH);
                const mx = (s.x + t.x) / 2;
                return (
                  <path
                    key={l.from + l.to}
                    d={`M${s.x},${s.y} C${mx},${s.y} ${mx},${t.y} ${t.x},${t.y}`}
                    fill="none"
                    stroke="rgba(184,192,208,.45)"
                    strokeWidth="1.5"
                    strokeDasharray="5 5"
                  />
                );
              })}
              {linkDrag && nodeById[linkDrag.from] && (() => {
                const a = nodeById[linkDrag.from];
                const s = linkDrag.side === 'left'
                  ? getConnectionTargetAnchor(a, nodeH)
                  : getConnectionSourceAnchor(a, nodeH);
                const mx = (s.x + linkDrag.x) / 2;
                return (
                  <path
                    d={`M${s.x},${s.y} C${mx},${s.y} ${mx},${linkDrag.y} ${linkDrag.x},${linkDrag.y}`}
                    fill="none"
                    stroke="rgba(79,227,193,.9)"
                    strokeWidth="1.5"
                    strokeDasharray="5 5"
                  />
                );
              })()}
            </svg>

            {/* Nhóm vẽ trước (ở dưới), nút thường vẽ sau (ở trên) */}
            {doc.nodes.filter((n) => n.type === 'group').map((n) => (
              <CanvasNode
                key={n.id}
                node={n}
                showInfo={showNodeInfo}
                nodeRef={getNodeRef(n.id)}
                active={selected.includes(n.id)}
                onPointerDown={(e) => onNodeDown(e, n)}
                onPortDown={(e) => onPortDown(e, n)}
                onView={() => setViewing(n)}
                onDoubleClick={() => renameGroup(n)}
              />
            ))}
            {doc.nodes.filter((n) => n.type !== 'group').map((n) => (
              <CanvasNode
                key={n.id}
                node={n}
                showInfo={showNodeInfo}
                nodeRef={getNodeRef(n.id)}
                active={selected.includes(n.id)}
                onPointerDown={(e) => onNodeDown(e, n)}
                onPortDown={(e) => onPortDown(e, n)}
                onView={() => setViewing(n)}
                showResize={selected.length === 1 && selected[0] === n.id}
                onResizeDown={onResizeDown}
                z={view.z}
                editing={editingTextId === n.id}
                assisting={assistingText}
                onTextChange={(t) => updateNode(n.id, { text: t })}
                onTextDone={() => setEditingTextId(null)}
                onAssist={() => assistNodeText(n)}
                onDoubleClick={() => {
                  // Nút văn bản nhập trực tiếp bằng 1 lần bấm, không dùng hộp thoại
                  if (n.type === 'text') return;
                  const t = window.prompt('Văn bản của nút', n.text || '');
                  if (t != null) setDoc((d) => ({ ...d, nodes: d.nodes.map((x) => x.id === n.id ? { ...x, text: t } : x) }));
                }}
              />
            ))}
            {/* Khung chọn vùng bằng Ctrl/Cmd+kéo */}
            {selectionBox && (
              <div
                className="pointer-events-none absolute z-30 rounded-[2px] border border-dashed border-brand-400 bg-brand-400/10"
                style={{
                  left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                  top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                  width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                  height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                }}
              />
            )}
          </div>
        </div>

        {/* Thanh trên tối giản: phẳng, không viền/bóng, chỉ hover nhẹ */}
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex h-14 items-center justify-between gap-2 px-3">
          <div className="pointer-events-auto flex min-w-0 items-center gap-1">
            <button
              onClick={() => { setSideTab('nodes'); setSideOpen((v) => !v); }}
              title="Bảng bên (Node / Prompt)"
              aria-label="Mở bảng bên"
              aria-expanded={sideOpen}
              className={clsx(
                'grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 transition',
                sideOpen
                  ? 'bg-brand-400/20 text-brand-300 ring-brand-400/40'
                  : 'bg-white/[0.07] text-white ring-white/10 hover:bg-white/[0.12]'
              )}
            >
              <Menu size={17} />
            </button>
            <input
              value={doc.title || ''}
              onChange={(e) => setDoc((d) => ({ ...d, title: e.target.value }))}
              placeholder="Canvas vô hạn"
              aria-label="Tên canvas"
              className="h-9 min-w-0 max-w-[200px] rounded-lg bg-transparent px-2 text-[15px] font-semibold text-white outline-none placeholder:text-mist-400 hover:bg-white/5 focus:bg-white/5 sm:max-w-[320px]"
            />
            <span className="hidden shrink-0 items-center gap-1.5 text-[11.5px] text-mist-400 sm:flex">
              <span className={clsx('h-1.5 w-1.5 rounded-full', saved ? 'bg-brand-400' : 'bg-mist-400')} />
              {saved ? 'Đã tự động lưu' : 'Đang lưu…'}
            </span>
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-1">
            <button
              onClick={() => setAgentOpen(true)}
              title="Mở Agent làm phim"
              className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-mist-200 transition hover:bg-white/5 hover:text-white"
            >
              <Sparkles size={15} className="text-brand-400" /> Agent
            </button>
            <button
              onClick={exportCanvasJSON}
              title="Xuất canvas (JSON)"
              className="grid h-9 w-9 place-items-center rounded-lg text-mist-200 transition hover:bg-white/5 hover:text-white"
            >
              <Download size={16} />
            </button>
          </div>
        </div>

        {/* Bảng bên trái: tab Node / Prompt (nổi bên trái, đè lên canvas) */}
        <CanvasSidePanel
          open={sideOpen}
          onClose={() => setSideOpen(false)}
          nodes={doc.nodes}
          links={doc.links}
          selectedIds={selected}
          onFocusNode={focusNode}
          onCreateTextNode={usePrompt}
          initialTab={sideTab}
        />

        {/* Dock dưới: thanh công cụ chính, cuộn ngang trên màn hẹp */}
        <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2">
          <div className="relative">
            {appearanceOpen && (
              <div
                className="absolute bottom-[calc(100%+10px)] right-0 z-30 w-[240px] rounded-xl border p-3 shadow-xl backdrop-blur"
                style={{ backgroundColor: theme.node.panelOverlay, borderColor: theme.toolbar.border }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <p className="mb-1.5 text-[11px] font-medium text-mist-400">Giao diện</p>
                <div className="flex gap-1">
                  <button
                    disabled
                    title="Chưa hỗ trợ"
                    className="flex h-9 flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg text-[12px] text-mist-400 opacity-50"
                  >
                    <Sun size={13} /> Sáng
                  </button>
                  <button
                    title="Giao diện tối"
                    className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[12px]"
                    style={{ backgroundColor: theme.toolbar.activeBg, color: theme.toolbar.activeText }}
                  >
                    <Moon size={13} /> Tối
                  </button>
                </div>
                <p className="mb-1.5 mt-3 text-[11px] font-medium text-mist-400">Lưới nền</p>
                <div className="flex gap-1">
                  {([['dots', 'Chấm'], ['lines', 'Kẻ'], ['blank', 'Trống']]).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => setGridMode(v)}
                      title={label === 'Chấm' ? 'Lưới chấm' : label === 'Kẻ' ? 'Lưới kẻ ô' : 'Không có lưới'}
                      className="h-9 flex-1 rounded-lg text-[12px] transition hover:bg-white/5"
                      style={gridMode === v
                        ? { backgroundColor: theme.toolbar.activeBg, color: theme.toolbar.activeText }
                        : { color: theme.toolbar.item }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[12px] text-mist-200">Hiện thông tin ảnh</span>
                  <button
                    role="switch"
                    aria-checked={showNodeInfo}
                    aria-label="Hiện thông tin ảnh"
                    title="Hiện/ẩn dòng thông tin dưới nút ảnh/video"
                    onClick={() => setShowNodeInfo((v) => !v)}
                    className="relative h-5 w-9 shrink-0 rounded-full transition"
                    style={{ backgroundColor: showNodeInfo ? '#0fa98a' : 'rgba(255,255,255,0.15)' }}
                  >
                    <span
                      className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
                      style={{ left: showNodeInfo ? 18 : 2 }}
                    />
                  </button>
                </div>
              </div>
            )}
            <div
              className="no-scrollbar relative flex h-14 max-w-[calc(100vw-32px)] items-center gap-1 overflow-x-auto rounded-xl border px-1.5 shadow-lg backdrop-blur"
              style={{ backgroundColor: theme.toolbar.panel, borderColor: theme.toolbar.border }}
            >
              <ToolBtn icon={MousePointer2} active={tool === 'select'} onClick={() => setTool('select')} title="Chọn (V)" />
              <ToolBtn icon={Hand} active={tool === 'hand'} onClick={() => setTool('hand')} title="Bàn tay (H)" />
              <Sep />
              <ToolBtn icon={Undo2} onClick={undoCanvas} disabled={!historyState.canUndo} title="Hoàn tác (Ctrl+Z)" />
              <ToolBtn icon={Redo2} onClick={redoCanvas} disabled={!historyState.canRedo} title="Làm lại (Ctrl+Shift+Z)" />
              <ToolBtn icon={Crosshair} onClick={focusSelected} disabled={!selected.length} title="Căn giữa nút đã chọn" />
              <Sep />
              <ToolBtn icon={Type} onClick={() => addNode('text')} title="Nút văn bản mới" />
              <ToolBtn icon={ImageIcon} onClick={() => addNode('image')} title="Nút hình ảnh mới" />
              <ToolBtn icon={Video} onClick={() => addNode('video')} title="Nút video mới" />
              <ToolBtn icon={ImagePlus} onClick={() => dockFileRef.current?.click()} title="Tải ảnh lên thành nút mới" />
              <Sep />
              <ToolBtn icon={Clapperboard} onClick={() => setStoryOpen(true)} title="Bảng phân cảnh" />
              <Sep />
              <ToolBtn icon={Palette} active={appearanceOpen} onClick={() => setAppearanceOpen((v) => !v)} title="Giao diện & lưới nền" />
              <Sep />
              <ToolBtn icon={Trash2} onClick={removeSelected} disabled={!selected.length} danger title="Xóa mục đã chọn (Delete)" />
              <ToolBtn icon={Eraser} onClick={clearCanvas} disabled={!doc.nodes.length} danger title="Xóa toàn bộ canvas" />
            </div>
          </div>
        </div>

        {/* Bản đồ nhỏ + điều khiển zoom (góc dưới-phải; trên điện thoại đẩy lên trên dock) */}
        <div className="absolute bottom-24 right-5 z-20 flex flex-col items-end gap-2 md:bottom-5">
          <ZoomControls
            z={view.z}
            onZoomTo={(target) => zoomBy(target / viewRef.current.z)}
            onReset={() => zoomBy(1 / viewRef.current.z)}
            onFit={fitView}
          />
          <CanvasMinimap nodes={doc.nodes} view={view} vp={vpSize} heights={nodeHeights} onCenterWorld={centerOnWorld} />
        </div>

        {/* Thanh gom/bỏ gom: nổi phía trên (hoặc dưới) khung bao vùng chọn ≥2 nút */}
        {selected.length >= 2 && (() => {
          const selNodes = doc.nodes.filter((n) => selected.includes(n.id));
          if (selNodes.length < 2) return null;
          const bs = selNodes.map((n) => nodeBounds(n, nodeH));
          const minX = Math.min(...bs.map((b) => b.x));
          const minY = Math.min(...bs.map((b) => b.y));
          const maxX = Math.max(...bs.map((b) => b.x + b.w));
          const maxY = Math.max(...bs.map((b) => b.y + b.h));
          const cx = ((minX + maxX) / 2) * view.z + view.x;
          const topScreen = minY * view.z + view.y;
          const bottomScreen = maxY * view.z + view.y;
          const above = topScreen - 56 > 56;
          const top = above ? topScreen - 10 : bottomScreen + 10;
          const hasGroup = selNodes.some((n) => n.type === 'group' || n.groupId);
          return (
            <div
              className="absolute z-20 flex items-center gap-1 rounded-full border border-white/[0.08] bg-[#121726]/95 p-1 shadow-xl backdrop-blur"
              style={{
                left: Math.max(96, Math.min(cx, vpSize.w - 96)),
                top,
                transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={groupSelected}
                className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-mist-100 transition hover:bg-white/5 hover:text-white"
              >
                <Group size={14} className="text-brand-400" /> Gom nhóm
              </button>
              {hasGroup && (
                <button
                  onClick={ungroupSelected}
                  className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-mist-100 transition hover:bg-white/5 hover:text-white"
                >
                  <Ungroup size={14} className="text-brand-400" /> Bỏ gom
                </button>
              )}
            </div>
          );
        })()}

        {/* Bảng cấu hình: xổ xuống liền với nút ảnh/video đang chọn (nút văn bản
            nhập trực tiếp trong nút nên không mở bảng này) */}
        {inspectorNode && inspectorNode.type !== 'group' && inspectorNode.type !== 'text' && panelStyle && (
          <NodeInspector
            node={inspectorNode}
            inputs={nodeInputs(inspectorNode.id)}
            busy={busy}
            style={panelStyle}
            placement={panelPlacement}
            onClose={() => setInspectorId(null)}
            onUpdate={(patch) => updateNode(inspectorNode.id, patch)}
            onGenerate={() => generateNode(inspectorNode)}
            onUpload={async (file) => { await uploadToNode(inspectorNode, file); }}
            onDelete={() => deleteNode(inspectorNode.id)}
            onRemoveLink={(otherId) => removeLinkBetween(inspectorNode.id, otherId)}
            onToggleInput={(inputId) => toggleInput(inspectorNode.id, inputId)}
            onSizeChange={(sz) => changeNodeSize(inspectorNode.id, sz)}
          />
        )}

        {/* Xem video/ảnh to của nút */}
        <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.label || (viewing?.type === 'video' ? 'Video' : 'Hình ảnh')} width="max-w-3xl">
          {viewing && (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl bg-black/50">
                {viewing.type === 'video' ? (
                  <video src={viewing.mediaUrl} controls autoPlay loop className="max-h-[65vh] w-full" />
                ) : (
                  <img src={viewing.mediaUrl} alt="" className="max-h-[65vh] w-full object-contain" />
                )}
              </div>
              {viewing.text && <p className="text-[13px] leading-relaxed text-mist-200">{viewing.text}</p>}
              <div className="flex justify-end gap-2">
                <a href={viewing.mediaUrl} download>
                  <button className="flex items-center gap-1.5 rounded-lg border border-[#232a38] px-3.5 py-1.5 text-[12px] text-mist-200 hover:border-brand-500/50 hover:text-white">
                    <Download size={13} /> Tải xuống
                  </button>
                </a>
                <button
                  onClick={() => setViewing(null)}
                  className="rounded-lg border border-[#232a38] px-3.5 py-1.5 text-[12px] text-mist-200 hover:border-brand-500/50 hover:text-white"
                >
                  Đóng
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>

      {/* Lớp nền trong suốt để bấm ra ngoài thì đóng popover Giao diện
          (đặt ở gốc — không nằm trong khối dock bị translate, fixed mới phủ đúng viewport) */}
      {appearanceOpen && (
        <div className="fixed inset-0 z-10" onPointerDown={() => setAppearanceOpen(false)} />
      )}

      {/* Bảng phân cảnh (thư viện prompt giờ nằm trong bảng bên) */}
      <StoryboardDrawer open={storyOpen} onClose={() => setStoryOpen(false)} onSend={sendShots} />

      {/* Agent làm phim (Phase 6): panel bên phải, độc lập với bảng bên trái */}
      <CanvasAgentPanel
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        createNodesFromShots={createNodesFromShots}
        updateNodeMedia={updateNodeMedia}
        onFilmDone={handleFilmDone}
        onFocusNodes={focusNodes}
      />

      {/* Input file ẩn cho nút Tải ảnh trên dock */}
      <input
        ref={dockFileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadAsNewNode(f); }}
      />

    </div>
  );
}

function ZoomControls({ z, onZoomTo, onReset, onFit }) {
  const pct = Math.round(z * 100);
  const t = getCanvasTheme();
  return (
    <div
      className="flex h-11 items-center gap-1 rounded-2xl border px-2 shadow-xl backdrop-blur"
      style={{ backgroundColor: t.toolbar.panel, borderColor: t.toolbar.border }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={onReset}
        title="Đặt lại 100%"
        className="flex h-9 min-w-[44px] items-center justify-center rounded-xl px-2 font-mono text-[12px] text-mist-200 hover:bg-white/5 hover:text-white"
      >
        {pct}%
      </button>
      <input
        type="range"
        min="25"
        max="250"
        step="1"
        value={Math.min(250, Math.max(25, pct))}
        onChange={(e) => onZoomTo(Number(e.target.value) / 100)}
        title="Thu phóng (25–250%)"
        aria-label="Thu phóng"
        className="h-9 w-24 cursor-pointer md:w-28"
        style={{ accentColor: '#4fe3c1' }}
      />
      <ToolBtn icon={Maximize} onClick={onFit} title="Vừa với canvas" />
    </div>
  );
}

function pruneLinks(d) {
  const ids = new Set(d.nodes.map((n) => n.id));
  return { ...d, links: (d.links || []).filter((l) => ids.has(l.from) && ids.has(l.to)) };
}

// Nhóm nào hết thành viên thì tự xóa.
function pruneEmptyGroups(d) {
  const nodes = d.nodes.filter((n) => n.type !== 'group' || d.nodes.some((m) => isNodeInGroup(m, n)));
  return { ...d, nodes };
}

// Xóa nút: gỡ luôn link liên quan, thành viên của nhóm bị xóa thì hết groupId,
// nhóm nào hết thành viên thì tự xóa theo.
function removeNodes(d, ids) {
  const remaining = d.nodes.filter((n) => !ids.includes(n.id));
  const cleaned = remaining.map((n) => (n.groupId && !remaining.some((x) => x.id === n.groupId)
    ? { ...n, groupId: undefined }
    : n));
  return pruneLinks(pruneEmptyGroups({ ...d, nodes: cleaned }));
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-white/[0.08]" />;
}

function ToolBtn({ icon: Icon, onClick, active, disabled, danger, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        'grid h-9 w-9 place-items-center rounded-xl transition disabled:opacity-35',
        active ? 'bg-white/[0.08] text-white' : 'text-mist-300 hover:bg-white/5 hover:text-white',
        danger && 'hover:!text-rose-400'
      )}
    >
      <Icon size={16} />
    </button>
  );
}

function CanvasNode({ node, active, showInfo = true, onPointerDown, onPortDown, onDoubleClick, onView, nodeRef, showResize, onResizeDown, z = 1, editing = false, assisting = false, onTextChange, onTextDone, onAssist }) {
  const running = node.status === 'running';
  const failed = node.status === 'failed';
  const isText = node.type === 'text';
  const isGroup = node.type === 'group';
  const Icon = isText ? Type : node.type === 'image' ? ImageIcon : Video;
  const title = isText ? 'Câu lệnh văn bản' : node.type === 'image' ? 'Hình ảnh' : 'Xem trước video';
  const role = isText ? 'Đầu vào' : 'Đầu ra';
  const fileName = node.mediaUrl ? decodeURIComponent(node.mediaUrl.split('/').pop().split('?')[0]) : null;
  const nodeW = node.width ?? NODE_W;
  // Chiều cao vùng xem trước theo chiều cao nút (mặc định 214 - 86 = 128px như cũ):
  // kéo đổi cỡ nút ảnh/video thì vùng xem trước to/nhỏ theo.
  const mediaH = Math.max(64, (node.height ?? nodeHGuess(node)) - 86);

  // Nhóm: khung viền đứt nét, không media, không nút tạo; chỉ có chấm nối
  // bên phải để làm nguồn nối (nối nhóm vào nút tạo sẽ lấy hết tài nguyên
  // của các thành viên). Vẽ ở dưới các nút thành viên (cha vẽ nhóm trước).
  if (isGroup) {
    return (
      <div
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        ref={nodeRef}
        data-node-id={node.id}
        style={{ left: node.x, top: node.y, width: nodeW, height: node.height ?? nodeHGuess(node) }}
        className={clsx(
          'absolute touch-none cursor-grab rounded-2xl border-2 border-dashed bg-brand-400/[0.04]',
          active ? 'border-brand-400 bg-brand-400/[0.08]' : 'border-brand-400/40'
        )}
      >
        <span className="absolute left-3 top-2.5 rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-mist-300">
          {node.label || 'Nhóm'}
        </span>
        <span
          onPointerDown={(e) => onPortDown(e, node, 'right')}
          className={clsx(
            "absolute -right-[8px] top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 bg-[#0d111c] before:absolute before:-inset-2 before:content-['']",
            active ? 'border-brand-400' : 'border-mist-400/60'
          )}
        />
      </div>
    );
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      ref={nodeRef}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: nodeW, minHeight: node.height ?? nodeHGuess(node) }}
      className={clsx('glass-node absolute touch-none cursor-grab p-3.5 active:cursor-grabbing', active && 'is-active')}
    >
      {/* 连接点 — kéo từ chấm tròn để nối sang nút khác */}
      {['-left-[8px]', '-right-[8px]'].map((pos) => (
        <span
          key={pos}
          onPointerDown={(e) => onPortDown(e, node, pos.startsWith('-left') ? 'left' : 'right')}
          className={clsx(
            "absolute top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 bg-[#0d111c] before:absolute before:-inset-2 before:content-['']",
            active ? 'border-brand-400' : 'border-mist-400/60',
            pos
          )}
        />
      ))}

      {/* Tay nắm đổi cỡ ở 4 góc — chỉ khi đúng 1 nút (không phải nhóm) được chọn.
          Kích thước chia theo zoom để trên màn hình luôn ~12px (ô vuông) / 16px (vùng chạm). */}
      {showResize && ['nw', 'ne', 'sw', 'se'].map((corner) => {
        const hs = 16 / z;
        const vs = 12 / z;
        const pos = {
          nw: { left: -hs / 2, top: -hs / 2, cursor: 'nwse-resize' },
          ne: { right: -hs / 2, top: -hs / 2, cursor: 'nesw-resize' },
          sw: { left: -hs / 2, bottom: -hs / 2, cursor: 'nesw-resize' },
          se: { right: -hs / 2, bottom: -hs / 2, cursor: 'nwse-resize' },
        }[corner];
        return (
          <span
            key={corner}
            onPointerDown={(e) => onResizeDown(e, node, corner)}
            className="absolute z-10 grid place-items-center"
            style={{ width: hs, height: hs, ...pos }}
          >
            <span className="block rounded-[2px] border border-brand-400 bg-white shadow" style={{ width: vs, height: vs }} />
          </span>
        );
      })}

      {/* Hàng tiêu đề nút: chiều cao cố định (h-6) để khi đang nhập văn bản,
          nút trợ giúp/Xong hiện ra cũng không làm nút đổi kích thước */}
      <div className="mb-2.5 flex h-6 items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-white">
          <Icon size={15} className="text-brand-400" />
          {title}
        </span>
        <span className="flex items-center gap-1">
          {isText && editing && (
            <>
              <button
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onAssist?.(); }}
                disabled={assisting || !node.text?.trim()}
                title="Nhờ Muse viết prompt"
                aria-label="Nhờ Muse viết prompt"
                className="grid h-6 w-6 place-items-center rounded-lg text-brand-300 transition hover:bg-brand-400/10 disabled:opacity-40"
              >
                {assisting ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              </button>
              <button
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onTextDone?.(); }}
                title="Xong"
                aria-label="Xong"
                className="grid h-6 w-6 place-items-center rounded-lg bg-brand-400/15 text-brand-300 transition hover:bg-brand-400/25"
              >
                <Check size={12} />
              </button>
            </>
          )}
          <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-mist-300">{role}</span>
        </span>
      </div>

      {isText ? (
        editing ? (
          // Nhập trực tiếp trong nút: ô nhập đúng bằng khung hiển thị (không làm
          // nút đổi kích thước); cuộn chuột trên ô nhập thì cuộn text, không zoom canvas.
          <textarea
            autoFocus
            value={node.text || ''}
            onChange={(e) => onTextChange?.(e.target.value)}
            onBlur={() => onTextDone?.()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') onTextDone?.();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            rows={4}
            placeholder="Nhập câu lệnh…"
            className="block min-h-[76px] w-full resize-none rounded-xl border border-brand-400/50 bg-[#0d111c]/80 px-3 py-2.5 text-[12px] leading-relaxed text-mist-200 outline-none placeholder:text-mist-400/70"
          />
        ) : (
          <p className="line-clamp-4 min-h-[76px] rounded-xl border border-white/[0.06] bg-[#0d111c]/80 px-3 py-2.5 text-[12px] leading-relaxed text-mist-200">
            {node.text || 'Nhấn vào để nhập câu lệnh…'}
          </p>
        )
      ) : (
        <div data-media className="relative cursor-pointer overflow-hidden rounded-xl bg-black/40" title="Bấm để xem to" style={{ height: mediaH }}>
          {node.mediaUrl ? (
            <>
              {node.type === 'video' ? (
                <video src={node.mediaUrl} muted loop playsInline autoPlay className="w-full object-cover" style={{ height: mediaH }} />
              ) : (
                <img src={node.mediaUrl} alt="" className="w-full object-cover" style={{ height: mediaH }} />
              )}
              <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white backdrop-blur">
                <Expand size={13} />
              </span>
            </>
          ) : (
            <div className="grid place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(15,169,138,.14),transparent_60%)]" style={{ height: mediaH }}>
              {running ? (
                <div className="flex items-center gap-1.5 text-[12px] text-brand-300">
                  <Loader2 size={14} className="animate-spin" /> {node.progress || 0}%
                </div>
              ) : failed ? (
                <span className="text-[11.5px] text-rose-400">Tạo thất bại</span>
              ) : (
                <span className="text-[11.5px] text-mist-400">Chờ tạo</span>
              )}
            </div>
          )}
        </div>
      )}

      {showInfo && (
        <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
          {isText ? (
            <span className="flex items-center gap-1.5 text-mist-400">
              <Sparkles size={12} /> Câu lệnh
            </span>
          ) : (
            <>
              <span className="truncate text-mist-200" title={node.text}>{fileName || node.text || node.label}</span>
              <span className={clsx('flex shrink-0 items-center gap-1', failed ? 'text-rose-300' : running ? 'text-mist-300' : node.mediaUrl ? 'text-brand-300' : 'text-mist-400')}>
                <span className={clsx('h-1.5 w-1.5 rounded-full', failed ? 'bg-rose-400' : running ? 'bg-amber-400' : node.mediaUrl ? 'bg-brand-400' : 'bg-mist-400')} />
                {failed ? 'Thất bại' : running ? 'Đang tạo' : node.mediaUrl ? 'Đã tạo xong' : 'Trống'}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
