import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Type, Image as ImageIcon, Video, Trash2, ZoomIn, ZoomOut, Maximize, Loader2, X, Sparkles,
  MousePointer2, Hand, ImagePlus, ChevronDown, Map as MapIcon, Expand,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../components/ui.jsx';
import NodeInspector from '../components/NodeInspector.jsx';

const STORE_KEY = 'xm_canvas_v1';
const IMAGE_SIZES = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const VIDEO_SIZES = ['16:9', '9:16', '1:1'];
const IMAGE_COST = 5;

const NODE_W = 260;
const NODE_H = 170;
// Chiều cao node khi render KHÔNG cố định: <p> văn bản dùng min-h 76px (border-box)
// nên node text cao 162px (ít chữ) tới 186px (đủ 4 dòng); node ảnh/video cố định 214px.
// Vì vậy không dùng số cứng: đo chiều cao thật bằng ResizeObserver (xem nodeHeights
// trong Canvas), nodeHGuess chỉ là giá trị tạm trước khi đo xong. Đường nối vẽ ở
// nodeH/2, chấm tròn ở top-1/2 của node thật, nên 2 số này phải khớp nhau thì
// đường mới chạm đúng tâm chấm tròn.
const nodeHGuess = (n) => (n.type === 'text' ? 174 : 214);

let seq = 1;
const newId = () => `n_${Date.now().toString(36)}_${seq++}`;

const defaultDoc = () => ({
  nodes: [
    {
      id: newId(),
      type: 'text',
      x: 420,
      y: 240,
      text: '输入或从下方输入区写入',
      label: '文本1',
    },
  ],
  links: [],
});

export default function Canvas() {
  const { user, refresh } = useAuth();
  const toast = useToast();

  const [doc, setDoc] = useState(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return defaultDoc();
  });

  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [selected, setSelected] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [duration, setDuration] = useState(5);
  const [size, setSize] = useState('16:9');
  const [mode, setMode] = useState('video'); // video | image
  const [inspectorId, setInspectorId] = useState(null); // id nút đang mở bảng cấu hình
  const [tool, setTool] = useState('select'); // select | hand
  const [vpSize, setVpSize] = useState({ w: 800, h: 500 });

  const viewportRef = useRef(null);
  const dragRef = useRef(null); // { mode:'pan'|'node'|'link', ... }
  const docRef = useRef(doc);
  docRef.current = doc;
  const viewRef = useRef(view);
  viewRef.current = view;
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
  const nodeH = useCallback((n) => heightsRef.current[n.id] ?? nodeHGuess(n), []);
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
      const z = Math.min(2.5, Math.max(0.25, v.z * factor));
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
    setSelected([]);
    setInspectorId(null);
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
    // Bấm vào 1 nút thì mở bảng cấu hình của nó; chọn nhiều thì đóng bảng
    if (multi) setInspectorId(null); else setInspectorId(node.id);
    dragRef.current = {
      mode: 'node',
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.x,
      nodeY: node.y,
      ids: multi ? [...selected, node.id] : [node.id],
      origins: {},
    };
    // 记录所有选中节点原位置
    if (multi) {
      const origins = {};
      for (const n of doc.nodes) {
        if (selected.includes(n.id) || n.id === node.id) origins[n.id] = { x: n.x, y: n.y };
      }
      dragRef.current.origins = origins;
    }
  };

  // Bắt đầu kéo nối từ chấm tròn của nút (chuột lẫn cảm ứng)
  const onPortDown = (e, node, side) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button === 2) return;
    dragRef.current = { mode: 'link', from: node.id };
    setLinkDrag({
      from: node.id,
      side,
      x: side === 'left' ? node.x : node.x + NODE_W,
      y: node.y + nodeH(node) / 2,
    });
  };

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'link') {
        const p = screenToCanvas(e.clientX, e.clientY);
        setLinkDrag((prev) => (prev ? { ...prev, x: p.x, y: p.y } : prev));
        return;
      }
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;

      if (d.mode === 'pan') {
        setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
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
      const d = dragRef.current;
      dragRef.current = null;
      if (!d || d.mode !== 'link') return;
      setLinkDrag(null);
      if (!e || e.clientX == null) return;
      const cur = docRef.current;
      const p = screenToCanvas(e.clientX, e.clientY);
      const target = cur.nodes.find(
        (n) => n.id !== d.from && p.x >= n.x && p.x <= n.x + NODE_W && p.y >= n.y && p.y <= n.y + nodeH(n)
      );
      if (!target) return;
      const src = cur.nodes.find((n) => n.id === d.from);
      if (!src) return;
      // Nối theo chiều trái -> phải để đường cong hiển thị đúng
      const from = target.x >= src.x ? src.id : target.id;
      const to = target.x >= src.x ? target.id : src.id;
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
    const onCancel = () => {
      dragRef.current = null;
      setLinkDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [view.z]);

  /* ---------------- 键盘 ---------------- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selected.length) return;
        e.preventDefault();
        setDoc((d) => pruneLinks({ ...d, nodes: d.nodes.filter((n) => !selected.includes(n.id)) }));
        setSelected([]);
        setInspectorId(null);
      }
      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'h' || e.key === 'H') setTool('hand');
      if (e.key === 'Escape') { setSelected([]); setInspectorId(null); }
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
      text: type === 'text' ? 'Nhấp đúp để nhập hoặc viết từ ô nhập phía dưới' : '',
      label: type === 'text' ? 'Văn bản' : type === 'image' ? 'Hình ảnh' : 'Video',
    };
    setDoc((d) => ({ ...d, nodes: [...d.nodes, n] }));
    setSelected([n.id]);
    setInspectorId(n.id);
  };

  const removeSelected = () => {
    setDoc((d) => pruneLinks({ ...d, nodes: d.nodes.filter((n) => !selected.includes(n.id)) }));
    setSelected([]);
    setInspectorId(null);
  };

  /* ---------------- Cấu hình nút ---------------- */
  const updateNode = (id, patch) => {
    setDoc((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  };

  const deleteNode = (id) => {
    setDoc((d) => pruneLinks({ ...d, nodes: d.nodes.filter((n) => n.id !== id) }));
    setSelected((s) => s.filter((i) => i !== id));
    setInspectorId(null);
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
    if (!node || node.type === 'text') return;
    const inputs = nodeInputs(node.id);
    const images = inputs.filter((n) => n.type === 'image' && n.mediaUrl).map((n) => n.mediaUrl);
    const textInputs = inputs.filter((n) => n.type === 'text' && n.text?.trim()).map((n) => n.text.trim());
    const promptText = node.text?.trim() || textInputs.join('\n') || '';
    if (promptText.length < 2) return toast('Nút này chưa có câu lệnh — nhập câu lệnh hoặc nối một nút văn bản vào', 'error');
    const isImage = node.type === 'image';
    const cost = isImage ? IMAGE_COST : 10 + 2 * (node.duration || 5);
    if ((user?.credits ?? 0) < cost) return toast('Không đủ điểm', 'error');
    setBusy(true);
    try {
      const { job } = isImage
        ? await api.createImage({ prompt: promptText, size: node.size || '1:1', images })
        : await api.createVideo({ prompt: promptText, duration: node.duration || 5, size: node.size || '16:9', images });
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
    const minX = Math.min(...doc.nodes.map((n) => n.x));
    const minY = Math.min(...doc.nodes.map((n) => n.y));
    const maxX = Math.max(...doc.nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...doc.nodes.map((n) => n.y + nodeH(n)));
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

  /* ---------------- 生成 ---------------- */
  const generate = async () => {
    // Tạo nhanh từ thanh dưới: lấy câu lệnh ở ô nhập (hoặc của nút văn bản đang chọn),
    // lấy TẤT CẢ ảnh của các nút đang chọn làm tham chiếu, nút mới nối từ mọi nút đã chọn.
    const selNodes = doc.nodes.filter((n) => selected.includes(n.id));
    const promptText = prompt.trim()
      || selNodes.find((n) => n.type === 'text')?.text?.trim()
      || '';
    if (promptText.length < 2) return toast('Hãy nhập nội dung văn bản trước', 'error');
    const images = selNodes.filter((n) => n.type === 'image' && n.mediaUrl).map((n) => n.mediaUrl);
    const cost = mode === 'image' ? IMAGE_COST : 10 + 2 * duration;
    if ((user?.credits ?? 0) < cost) return toast('Không đủ điểm', 'error');

    const rightX = selNodes.length ? Math.max(...selNodes.map((n) => n.x)) : 0;
    const anchorY = selNodes.length ? selNodes[0].y : 300;
    setBusy(true);
    try {
      const { job } = mode === 'image'
        ? await api.createImage({ prompt: promptText, size, images })
        : await api.createVideo({
          prompt: promptText,
          duration,
          size,
          images,
        });

      const node = {
        id: newId(),
        type: mode === 'image' ? 'image' : 'video',
        x: selNodes.length ? rightX + NODE_W + 60 : 520,
        y: anchorY,
        text: promptText,
        label: mode === 'image' ? 'Hình ảnh' : 'Video',
        size,
        duration,
        jobId: job.id,
        status: 'running',
        mediaUrl: null,
      };
      const newLinks = selNodes.map((n) => ({ from: n.id, to: node.id }));
      setDoc((d) => ({
        ...d,
        nodes: [...d.nodes, node],
        links: [...(d.links || []), ...newLinks],
      }));
      setSelected([node.id]);
      setInspectorId(node.id);
      setPrompt('');
      toast('Đã gửi nút để tạo', 'ok');
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- 任务轮询 ---------------- */
  const syncJobs = useCallback(async () => {
    const running = doc.nodes.filter((n) => n.jobId && n.status === 'running');
    if (!running.length) return;
    const results = await Promise.all(
      running.map(async (n) => {
        try { return { id: n.id, job: (await api.job(n.jobId)).job }; } catch { return null; }
      })
    );
    setDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        const hit = results.find((r) => r?.id === n.id)?.job;
        if (!hit) return n;
        if (hit.status === 'completed') {
          return { ...n, status: 'done', mediaUrl: hit.mediaUrl || hit.result?.url };
        }
        if (hit.status === 'failed') {
          return { ...n, status: 'failed', error: hit.error };
        }
        return { ...n, progress: hit.progress };
      }),
    }));
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

  const boundNode = selected.length === 1 ? doc.nodes.find((n) => n.id === selected[0]) : null;

  const nodeById = Object.fromEntries(doc.nodes.map((n) => [n.id, n]));
  const links = (doc.links || []).filter((l) => nodeById[l.from] && nodeById[l.to]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---------------- 标题 ---------------- */}
      <div className="flex shrink-0 items-center justify-between gap-4 px-7 pb-3 pt-5">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-white">
            Canvas vô hạn
            <span className="h-2 w-2 rounded-full bg-brand-400 shadow-[0_0_8px_rgba(79,227,193,.8)]" />
          </h1>
          <p className="mt-1 text-[12.5px] text-mist-400">Tự do sắp xếp ý tưởng và tạo video hoặc ảnh trên canvas vô hạn</p>
        </div>
        <span className="flex items-center gap-1.5 text-[11.5px] text-mist-400">
          <span className={clsx('h-1.5 w-1.5 rounded-full', saved ? 'bg-brand-400' : 'bg-mist-400')} />
          {saved ? 'Đã tự động lưu' : 'Đang lưu…'}
        </span>
      </div>

      {/* ---------------- 画布 ---------------- */}
      <div className="relative mx-5 mb-5 min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/[0.06]">
        {/* 视图 */}
        <div
          ref={viewportRef}
          data-canvasbg="1"
          onWheel={onWheel}
          onPointerDown={onBackgroundDown}
          onContextMenu={(e) => e.preventDefault()}
          className={clsx('dot-grid absolute inset-0 touch-none select-none', tool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default')}
          style={{
            backgroundSize: `${22 * view.z}px ${22 * view.z}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
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
                const x1 = a.x + NODE_W;
                const y1 = a.y + nodeH(a) / 2;
                const x2 = b.x;
                const y2 = b.y + nodeH(b) / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <path
                    key={l.from + l.to}
                    d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke="rgba(184,192,208,.45)"
                    strokeWidth="1.5"
                    strokeDasharray="5 5"
                  />
                );
              })}
              {linkDrag && nodeById[linkDrag.from] && (() => {
                const a = nodeById[linkDrag.from];
                const x1 = linkDrag.side === 'left' ? a.x : a.x + NODE_W;
                const y1 = a.y + nodeH(a) / 2;
                const mx = (x1 + linkDrag.x) / 2;
                return (
                  <path
                    d={`M${x1},${y1} C${mx},${y1} ${mx},${linkDrag.y} ${linkDrag.x},${linkDrag.y}`}
                    fill="none"
                    stroke="rgba(79,227,193,.9)"
                    strokeWidth="1.5"
                    strokeDasharray="5 5"
                  />
                );
              })()}
            </svg>

            {doc.nodes.map((n) => (
              <CanvasNode
                key={n.id}
                node={n}
                mode={mode}
                nodeRef={getNodeRef(n.id)}
                active={selected.includes(n.id)}
                onPointerDown={(e) => onNodeDown(e, n)}
                onPortDown={(e) => onPortDown(e, n)}
                onDoubleClick={() => {
                  const t = window.prompt('Văn bản của nút', n.text || '');
                  if (t != null) setDoc((d) => ({ ...d, nodes: d.nodes.map((x) => x.id === n.id ? { ...x, text: t } : x) }));
                }}
              />
            ))}
          </div>
        </div>

        {/* 顶部工具栏 */}
        <div className="absolute left-4 top-4 z-20 flex max-w-[calc(100%-32px)] flex-wrap items-center gap-1 rounded-2xl border border-white/[0.07] bg-[#121726]/90 p-1.5 shadow-xl backdrop-blur">
          <ToolBtn icon={MousePointer2} active={tool === 'select'} onClick={() => setTool('select')} title="Chọn (V)" />
          <ToolBtn icon={Hand} active={tool === 'hand'} onClick={() => setTool('hand')} title="Bàn tay (H)" />
          <Sep />
          <ToolBtn icon={Type} onClick={() => addNode('text')} title="Nút văn bản mới" />
          <ToolBtn icon={ImageIcon} onClick={() => addNode('image')} title="Nút hình ảnh mới" />
          <ToolBtn icon={Video} onClick={() => addNode('video')} title="Nút video mới" />
          <Sep />
          <ToolBtn icon={ZoomOut} onClick={() => zoomBy(1 / 1.15)} title="Thu nhỏ" />
          <button
            onClick={() => setView((v) => ({ ...v, z: 1 }))}
            title="Đặt lại 100%"
            className="flex h-9 min-w-[70px] items-center justify-center gap-1 rounded-xl border border-white/[0.06] px-2 font-mono text-[12px] text-mist-200 hover:text-white"
          >
            {Math.round(view.z * 100)}% <ChevronDown size={12} className="text-mist-400" />
          </button>
          <ToolBtn icon={ZoomIn} onClick={() => zoomBy(1.15)} title="Phóng to" />
          <Sep />
          <ToolBtn icon={Maximize} onClick={fitView} title="Vừa với canvas" />
          <ToolBtn icon={Trash2} onClick={removeSelected} disabled={!selected.length} danger title="Xóa mục đã chọn (Delete)" />
        </div>

        <span className="pointer-events-none absolute right-4 top-5 z-20 hidden font-mono text-[10px] text-mist-400/70 xl:block">
          Lăn chuột để thu phóng · Kéo bằng nút giữa/phím cách/bàn tay · Shift để chọn nhiều · Nhấp đúp để sửa · Kéo chấm tròn để nối nút
        </span>

        {/* 小地图 */}
        <Minimap nodes={doc.nodes} view={view} vp={vpSize} heights={nodeHeights} />

        {/* 底部悬浮生成条 */}
        <div className="absolute bottom-3 left-1/2 z-20 w-[min(760px,calc(100%-24px))] -translate-x-1/2 md:bottom-5 md:w-[min(760px,calc(100%-300px))]">
          <div className="mb-2 flex items-center justify-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-[#121726]/90 px-3 py-1 text-[11px] text-mist-300 backdrop-blur">
              <span className={clsx('h-1.5 w-1.5 rounded-full', selected.length ? 'bg-brand-400' : 'bg-mist-400')} />
              {selected.length === 1
                ? `Đã liên kết: ${boundNode?.label || ''} (kết quả tạo sẽ nối vào bên phải của nó)`
                : selected.length > 1
                  ? `Đã chọn ${selected.length} nút · Kết quả tạo sẽ nối từ mọi nút đã chọn`
                  : 'Chưa liên kết nút · Kết quả sẽ đặt ở giữa canvas'}
            </span>
            {selected.length > 0 && (
              <button onClick={() => { setSelected([]); setInspectorId(null); }} className="flex items-center gap-0.5 text-[11px] text-mist-400 hover:text-mist-200">
                Hủy liên kết <X size={10} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-400/30 bg-[#121726]/95 p-2 shadow-[0_0_0_1px_rgba(79,227,193,.08),0_20px_50px_-20px_rgba(0,0,0,.9),0_0_40px_-18px_rgba(79,227,193,.5)] backdrop-blur-xl">
            <div className="seg shrink-0">
              {[['video', 'Video'], ['image', 'Ảnh']].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => {
                    setMode(k);
                    if (k === 'video' && !VIDEO_SIZES.includes(size)) setSize('16:9');
                    if (k === 'image' && !IMAGE_SIZES.includes(size)) setSize('1:1');
                  }}
                  className={clsx(mode === k && 'on')}
                  style={{ minWidth: 0, padding: '4px 12px', fontSize: 12 }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => addNode('image')}
              title="Thêm nút hình ảnh"
              className="flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[12.5px] text-mist-200 transition hover:bg-white/5 hover:text-white"
            >
              <ImagePlus size={16} /> <span className="hidden sm:inline">Thêm hình ảnh</span>
            </button>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } }}
              placeholder={mode === 'image' ? 'Mô tả hình ảnh muốn tạo…' : 'Mô tả nội dung video bạn muốn tạo…'}
              className="h-11 min-w-[140px] flex-1 basis-full rounded-xl border border-white/[0.06] bg-[#0d111c] px-3.5 text-[13px] text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50 sm:basis-0"
            />
            {mode === 'video' && (
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="h-11 cursor-pointer rounded-xl border border-white/[0.06] bg-[#0d111c] px-2 font-mono text-[12px] text-mist-200 outline-none"
                title="Thời lượng"
              >
                {[5, 8, 10].map((d) => <option key={d} value={d}>{d}s</option>)}
              </select>
            )}
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="h-11 cursor-pointer rounded-xl border border-white/[0.06] bg-[#0d111c] px-2 font-mono text-[12px] text-mist-200 outline-none"
              title="Tỉ lệ"
            >
              {(mode === 'image' ? IMAGE_SIZES : VIDEO_SIZES).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <button
              onClick={generate}
              disabled={busy}
              className="mint-btn flex h-11 shrink-0 items-center gap-2 rounded-xl px-5 text-[14px] font-semibold"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {mode === 'image' ? 'Tạo ảnh' : 'Tạo'}
            </button>
          </div>
        </div>
      </div>

      {/* Bảng cấu hình nút: bấm vào 1 nút là hiện */}
      <NodeInspector
        node={inspectorId ? doc.nodes.find((n) => n.id === inspectorId) : null}
        inputs={inspectorId ? nodeInputs(inspectorId) : []}
        outputs={inspectorId ? nodeOutputs(inspectorId) : []}
        busy={busy}
        onClose={() => setInspectorId(null)}
        onUpdate={(patch) => inspectorId && updateNode(inspectorId, patch)}
        onGenerate={() => {
          const n = doc.nodes.find((x) => x.id === inspectorId);
          if (n) generateNode(n);
        }}
        onUpload={async (file) => {
          const n = doc.nodes.find((x) => x.id === inspectorId);
          if (n) await uploadToNode(n, file);
        }}
        onDelete={() => inspectorId && deleteNode(inspectorId)}
        onRemoveLink={(otherId) => inspectorId && removeLinkBetween(inspectorId, otherId)}
      />
    </div>
  );
}

function pruneLinks(d) {
  const ids = new Set(d.nodes.map((n) => n.id));
  return { ...d, links: (d.links || []).filter((l) => ids.has(l.from) && ids.has(l.to)) };
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

function Minimap({ nodes, view, vp, heights }) {
  const h = (n) => heights?.[n.id] ?? nodeHGuess(n);
  const W = 176;
  const H = 116;
  if (!nodes.length) return null;
  const vx0 = -view.x / view.z;
  const vy0 = -view.y / view.z;
  const vw = vp.w / view.z;
  const vh = vp.h / view.z;
  const minX = Math.min(vx0, ...nodes.map((n) => n.x)) - 40;
  const minY = Math.min(vy0, ...nodes.map((n) => n.y)) - 40;
  const maxX = Math.max(vx0 + vw, ...nodes.map((n) => n.x + NODE_W)) + 40;
  const maxY = Math.max(vy0 + vh, ...nodes.map((n) => n.y + h(n))) + 40;
  const k = Math.min(W / (maxX - minX), H / (maxY - minY));
  const tx = (x) => (x - minX) * k;
  const ty = (y) => (y - minY) * k;

  return (
    <div className="absolute bottom-5 right-5 z-20 hidden rounded-2xl border border-white/[0.07] bg-[#121726]/90 p-2.5 shadow-xl backdrop-blur md:block">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 text-[11.5px] text-mist-200">
          <MapIcon size={12} className="text-mist-400" /> Bản đồ nhỏ
        </span>
        <Expand size={11} className="text-mist-400" />
      </div>
      <div className="dot-grid relative overflow-hidden rounded-xl" style={{ width: W, height: H, backgroundSize: '10px 10px' }}>
        {nodes.map((n) => (
          <span
            key={n.id}
            className="absolute rounded-[3px] border border-mist-300/40 bg-mist-300/25"
            style={{ left: tx(n.x), top: ty(n.y), width: Math.max(4, NODE_W * k), height: Math.max(3, h(n) * k) }}
          />
        ))}
        <span
          className="absolute rounded-[4px] border border-brand-400/70 bg-brand-400/5"
          style={{ left: tx(vx0), top: ty(vy0), width: vw * k, height: vh * k }}
        />
      </div>
    </div>
  );
}

function CanvasNode({ node, mode, active, onPointerDown, onPortDown, onDoubleClick, nodeRef }) {
  const running = node.status === 'running';
  const failed = node.status === 'failed';
  const isText = node.type === 'text';
  const Icon = isText ? Type : node.type === 'image' ? ImageIcon : Video;
  const title = isText ? 'Câu lệnh văn bản' : node.type === 'image' ? 'Hình ảnh' : 'Xem trước video';
  const role = isText ? 'Đầu vào' : 'Đầu ra';
  const fileName = node.mediaUrl ? decodeURIComponent(node.mediaUrl.split('/').pop().split('?')[0]) : null;

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      ref={nodeRef}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: NODE_W }}
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

      <div className="mb-2.5 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-white">
          <Icon size={15} className="text-brand-400" />
          {title}
        </span>
        <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-mist-300">{role}</span>
      </div>

      {isText ? (
        <p className="line-clamp-4 min-h-[76px] rounded-xl border border-white/[0.06] bg-[#0d111c]/80 px-3 py-2.5 text-[12px] leading-relaxed text-mist-200">
          {node.text || 'Văn bản trống, nhấp đúp để sửa'}
        </p>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black/40">
          {node.mediaUrl ? (
            node.type === 'video' ? (
              <video src={node.mediaUrl} muted loop playsInline autoPlay className="h-[128px] w-full object-cover" />
            ) : (
              <img src={node.mediaUrl} alt="" className="h-[128px] w-full object-cover" />
            )
          ) : (
            <div className="grid h-[128px] place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(15,169,138,.14),transparent_60%)]">
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

      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
        {isText ? (
          <span className="flex items-center gap-1.5 text-mist-400">
            <Sparkles size={12} /> {mode === 'image' ? 'muse-image' : 'muse-video'}
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
    </div>
  );
}
