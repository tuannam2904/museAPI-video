import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';

const NODE_W = 260;
const PAD = 500;
// Chiều cao node khi render KHÔNG cố định: đo thật bằng ResizeObserver ở Canvas,
// nodeHGuess chỉ là giá trị tạm trước khi đo xong (đồng bộ với Canvas.jsx).
const nodeHGuess = (n) => (n.type === 'text' ? 174 : 214);
const NODE_COLOR = { text: '#4fe3c1', image: '#10b981', video: '#f97316' };

// Bản đồ nhỏ tương tác: kéo/kéo thả khung nhìn hoặc bấm vào bất cứ đâu để
// đưa điểm đó ra giữa màn hình, GIỮ nguyên mức zoom hiện tại.
// screen = world * z + view offset  =>  world = (screen - view offset) / z
// (xem toMinimap/toWorld bên dưới; khung nhìn vẽ từ view.x/view.y/view.z nên
// bám theo pan/zoom của canvas chính theo thời gian thực.)
export default function CanvasMinimap({ nodes, view, vp, heights, onCenterWorld }) {
  const mapRef = useRef(null);
  const draggingRef = useRef(false);
  // Kích thước thật của khung bản đồ (240×160 desktop, 160×110 mobile qua
  // Tailwind md: — đo bằng ResizeObserver để phép đổi tọa độ luôn khớp
  // với kích thước đang hiển thị, kể cả khi xoay màn hình).
  const [size, setSize] = useState({ w: 240, h: 160 });
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = useCallback((n) => heights?.[n.id] ?? nodeHGuess(n), [heights]);

  const { bounds, scale, offset } = useMemo(() => {
    if (!nodes.length) return { bounds: null, scale: 1, offset: { x: 0, y: 0 } };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + h(n));
    }
    minX -= PAD;
    minY -= PAD;
    maxX += PAD;
    maxY += PAD;
    const bw = maxX - minX;
    const bh = maxY - minY;
    const k = Math.min(size.w / bw, size.h / bh);
    return {
      bounds: { x: minX, y: minY, w: bw, h: bh },
      scale: k,
      offset: { x: (size.w - bw * k) / 2, y: (size.h - bh * k) / 2 },
    };
  }, [nodes, h, size]);

  const toMinimap = useCallback(
    (wx, wy) => ({ x: (wx - bounds.x) * scale + offset.x, y: (wy - bounds.y) * scale + offset.y }),
    [bounds, scale, offset]
  );
  const toWorld = useCallback(
    (mx, my) => ({ x: (mx - offset.x) / scale + bounds.x, y: (my - offset.y) / scale + bounds.y }),
    [bounds, scale, offset]
  );

  // Khung nhìn (viewport) trên bản đồ, tính từ view hiện tại — bám pan/zoom live.
  const viewportRect = useMemo(() => {
    if (!bounds) return null;
    const vx = -view.x / view.z;
    const vy = -view.y / view.z;
    const p1 = toMinimap(vx, vy);
    const p2 = toMinimap(vx + vp.w / view.z, vy + vp.h / view.z);
    return { x: p1.x, y: p1.y, w: Math.max(p2.x - p1.x, 4), h: Math.max(p2.y - p1.y, 4) };
  }, [bounds, toMinimap, view, vp]);

  const centerFromEvent = useCallback(
    (e) => {
      const rect = mapRef.current?.getBoundingClientRect();
      if (!rect || !bounds) return;
      const world = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      onCenterWorld(world.x, world.y);
    },
    [bounds, toWorld, onCenterWorld]
  );

  if (!nodes.length || !bounds) return null;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#121726]/90 p-2.5 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 text-[11.5px] text-mist-200">
          <MapIcon size={12} className="text-mist-400" /> Bản đồ nhỏ
        </span>
        <span className="text-[10px] text-mist-400/70">Kéo để di chuyển</span>
      </div>
      <div
        ref={mapRef}
        role="application"
        aria-label="Bản đồ nhỏ — kéo hoặc bấm để di chuyển khung nhìn"
        className="dot-grid relative h-[110px] w-[160px] cursor-crosshair touch-none overflow-hidden rounded-xl select-none md:h-[160px] md:w-[240px]"
        style={{ backgroundSize: '10px 10px' }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation(); // không cho canvas chính bắt đầu pan / box-select / pinch
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          centerFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) centerFromEvent(e);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        }}
        onPointerCancel={() => { draggingRef.current = false; }}
      >
        {nodes.map((n) => {
          const p = toMinimap(n.x, n.y);
          return (
            <span
              key={n.id}
              className="absolute rounded-[2px]"
              style={{
                left: p.x,
                top: p.y,
                width: Math.max(NODE_W * scale, 2),
                height: Math.max(h(n) * scale, 2),
                backgroundColor: NODE_COLOR[n.type] || '#b8c0d0',
                opacity: 0.85,
              }}
            />
          );
        })}
        {viewportRect && (
          <span
            className="pointer-events-none absolute rounded-[4px] border border-brand-400/80 bg-brand-400/5"
            style={{ left: viewportRect.x, top: viewportRect.y, width: viewportRect.w, height: viewportRect.h }}
          />
        )}
      </div>
    </div>
  );
}
