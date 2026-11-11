import { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Loader2, Play, Film, RotateCcw, Square } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../../lib/api.js';

/* Panel Agent làm phim (Phase 6) — chạy pipeline Film Studio từ 1 câu ý tưởng.
   - Nổi bên phải canvas (đối diện bảng bên trái), trên điện thoại thành drawer
     từ phải với nền mờ, bấm nền mờ / X / Escape để đóng.
   - BẮT BUỘC xác nhận trước khi chạy: bấm "Chạy" chỉ mở hộp xác nhận nội tuyến;
     chỉ khi bấm "Chạy ngay" thì flow mới bắt đầu (điểm bị trừ khi tạo ảnh/video).
   - Flow: tạo phim → viết kịch bản → chia cảnh → đưa cảnh lên canvas thành nút
     video (nối tiếp nhau) → tạo toàn bộ (ảnh rồi video từng cảnh) → poll mỗi 5s,
     cảnh nào có video thì điền media vào nút canvas tương ứng → ghép thành phim.
   - Các op cục bộ (add_node / connect_nodes / run_generation / set_viewport)
     chạy ngay trong trình duyệt, KHÔNG qua MCP; mỗi lần gọi đều ghi vào nhật ký. */

const SHOT_OPTIONS = [4, 6, 8];
const DURATION_OPTIONS = [5, 8, 10];
const ASPECT_OPTIONS = ['9:16', '16:9'];
// Backend chỉ nhận durationTotal ∈ {15, 30, 60} giây (xem server/src/routes/films.js):
// số cảnh thực tế = làm tròn(durationTotal / sceneDuration), nên shots chỉ là
// mục tiêu — lấy giá trị hợp lệ gần nhất với shots*duration rồi dùng đúng số
// cảnh mà storyboard trả về để tạo nút.
const VALID_TOTALS = [15, 30, 60];
const nearestTotal = (target) => VALID_TOTALS.reduce((best, v) =>
  Math.abs(v - target) < Math.abs(best - target) ? v : best, VALID_TOTALS[0]);

const POLL_MS = 5000;
const POLL_MAX_ROUNDS = 360; // 30 phút — tạo video từng cảnh có thể lâu
const STITCH_MAX_ROUNDS = 120; // 10 phút

const fmtClock = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export default function CanvasAgentPanel({
  open,
  onClose,
  createNodesFromShots,
  updateNodeMedia,
  onFilmDone,
  onFocusNodes,
}) {
  const [idea, setIdea] = useState('');
  const [shots, setShots] = useState(6);
  const [duration, setDuration] = useState(10);
  const [aspect, setAspect] = useState('9:16');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [filmId, setFilmId] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [shotNodes, setShotNodes] = useState([]);
  const [readyToStitch, setReadyToStitch] = useState(false);
  const [stitching, setStitching] = useState(false);
  const [filmDone, setFilmDone] = useState(false);
  const [error, setError] = useState(null);
  const [failedStep, setFailedStep] = useState(null); // 'generate' | 'stitch' | null
  const logRef = useRef(null);
  const cancelledRef = useRef(false);
  const filmIdRef = useRef(null);
  const appliedMediaRef = useRef(new Set()); // sceneId đã điền media vào nút

  const estimate = shots * (5 + 10 + 2 * duration);
  filmIdRef.current = filmId;

  // Escape đóng panel
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Nhật ký tự cuộn xuống dòng mới nhất
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  // Hủy poll khi đóng panel / unmount
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const pushLog = (text, kind = 'info') => {
    setLogs((prev) => [...prev, { time: fmtClock(), text, kind }]);
  };

  /* ---------------- op cục bộ (ghi log kèm tên op) ---------------- */
  // add_node: tạo nút video cho từng cảnh (đi qua sendShots của Canvas.jsx:
  // xếp ngang, nối tiếp nhau, gắn filmSceneId để map ngược khi có video).
  const add_node = (sceneList) => {
    pushLog(`add_node: tạo ${sceneList.length} nút video cho các cảnh`, 'op');
    const nodes = createNodesFromShots(
      sceneList.map((s) => ({
        prompt: s.videoPrompt || s.description || '',
        shot: s.order + 1,
        duration: s.duration || duration,
      })),
      aspect,
      sceneList.map((s) => s.id),
    ) || [];
    setShotNodes(nodes);
    return nodes;
  };

  // connect_nodes: các nút shot được nối tiếp nhau ngay khi tạo (sendShots
  // tạo link from → to theo thứ tự cảnh); ghi log để nhật ký thấy rõ op này.
  const connect_nodes = (nodes) => {
    if (nodes.length > 1) {
      pushLog(`connect_nodes: nối ${nodes.length - 1} đường nối theo thứ tự cảnh`, 'op');
    }
  };

  // run_generation: gọi backend chạy pipeline tạo ảnh → video cho mọi cảnh.
  const run_generation = async (id) => {
    pushLog('run_generation: gọi filmGenerateAll — backend tạo ảnh rồi video từng cảnh', 'op');
    const out = await api.filmGenerateAll(id);
    pushLog(out?.message || 'Đã bắt đầu tạo toàn bộ các cảnh', 'ok');
    return out;
  };

  // set_viewport: đưa hàng nút shot (hoặc phim hoàn chỉnh) ra giữa màn hình.
  const set_viewport = (nodes) => {
    if (!nodes?.length) return;
    pushLog('set_viewport: đưa các nút phim ra giữa màn hình', 'op');
    onFocusNodes?.(nodes);
  };

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // Poll phim cho tới khi mọi cảnh có videoMedia (hoặc lỗi), điền media vào
  // nút canvas ngay khi từng cảnh xong.
  const pollUntilVideosDone = async (id, sceneList) => {
    const total = sceneList.length;
    setProgress({ done: 0, total });
    for (let round = 0; round < POLL_MAX_ROUNDS; round++) {
      if (cancelledRef.current) throw new Error('Đã dừng');
      await sleep(POLL_MS);
      if (cancelledRef.current) throw new Error('Đã dừng');
      const data = await api.film(id);
      const fresh = data?.scenes || [];
      let done = 0;
      for (const s of fresh) {
        if (s.videoMedia) {
          done += 1;
          if (!appliedMediaRef.current.has(s.id)) {
            appliedMediaRef.current.add(s.id);
            updateNodeMedia(s.id, s.videoMedia);
            pushLog(`Cảnh ${s.order + 1}/${total}: đã có video — điền vào nút canvas`, 'ok');
          }
        }
      }
      setProgress({ done, total });
      const failed = fresh.filter((s) => s.status === 'failed');
      if (done >= total) return { allDone: true, scenes: fresh };
      if (failed.length && done + failed.length >= total) {
        return { allDone: false, scenes: fresh, failed };
      }
    }
    throw new Error('Hết thời gian chờ tạo video (30 phút) — thử bấm "Thử lại" để tiếp tục theo dõi');
  };

  const runFlow = async () => {
    const text = idea.trim();
    if (text.length < 3 || running) return;
    cancelledRef.current = false;
    setRunning(true);
    setError(null);
    setFailedStep(null);
    setReadyToStitch(false);
    setFilmDone(false);
    setProgress({ done: 0, total: 0 });
    appliedMediaRef.current = new Set();
    const durationTotal = nearestTotal(shots * duration);
    try {
      pushLog(`Tạo phim: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`, 'info');
      if (durationTotal !== shots * duration) {
        pushLog(`Lưu ý: tổng thời lượng ${shots * duration}s không nằm trong {15, 30, 60}s nên dùng ${durationTotal}s; số cảnh thực tế theo storyboard`, 'info');
      }
      const created = await api.createFilm({
        idea: text,
        genre: 'đời thường',
        style: 'điện ảnh',
        aspect,
        durationTotal,
        sceneDuration: duration,
      });
      const id = created?.project?.id || created?.id;
      if (!id) throw new Error('Tạo phim thất bại: máy chủ không trả về ID phim');
      setFilmId(id);
      pushLog(`Đã tạo phim (ID ${id})`, 'ok');

      pushLog('Đang viết kịch bản…', 'info');
      await api.filmScript(id);
      pushLog('Đã viết xong kịch bản', 'ok');

      pushLog(`Đang chia cảnh (mục tiêu ${shots} cảnh × ${duration}s)…`, 'info');
      const sb = await api.filmStoryboard(id);
      const sceneList = sb?.scenes || [];
      if (!sceneList.length) throw new Error('Chia cảnh thất bại: không có cảnh nào');
      setScenes(sceneList);
      pushLog(`Đã chia thành ${sceneList.length} cảnh`, 'ok');

      const nodes = add_node(sceneList);
      connect_nodes(nodes);
      set_viewport(nodes);

      await run_generation(id);
      const res = await pollUntilVideosDone(id, sceneList);
      if (!res.allDone) {
        const n = res.failed?.length || 0;
        throw new Error(`${n} cảnh tạo thất bại — bấm "Thử lại" để chạy lại các cảnh lỗi`);
      }
      setReadyToStitch(true);
      setFailedStep(null);
      pushLog('Tất cả cảnh đã có video — bấm "Ghép thành phim" để hoàn tất', 'ok');
    } catch (e) {
      const msg = e?.message || 'Đã xảy ra lỗi';
      setError(msg);
      pushLog(`Lỗi: ${msg}`, 'error');
      if (filmIdRef.current && scenes.length) setFailedStep('generate');
    } finally {
      setRunning(false);
    }
  };

  // Thử lại từ bước tạo toàn bộ: backend tự bỏ qua cảnh đã xong, chỉ chạy
  // lại cảnh lỗi/chưa có video (pipeline có thể chạy lại được).
  const retryGenerate = async () => {
    if (!filmId || !scenes.length || running) return;
    cancelledRef.current = false;
    setRunning(true);
    setError(null);
    setFailedStep(null);
    try {
      pushLog('Thử lại: chạy lại các cảnh chưa xong…', 'info');
      await run_generation(filmId);
      const res = await pollUntilVideosDone(filmId, scenes);
      if (!res.allDone) {
        throw new Error(`${res.failed?.length || 0} cảnh vẫn tạo thất bại`);
      }
      setReadyToStitch(true);
      pushLog('Tất cả cảnh đã có video — bấm "Ghép thành phim" để hoàn tất', 'ok');
    } catch (e) {
      const msg = e?.message || 'Đã xảy ra lỗi';
      setError(msg);
      pushLog(`Lỗi: ${msg}`, 'error');
      setFailedStep('generate');
    } finally {
      setRunning(false);
    }
  };

  const stitch = async () => {
    if (!filmId || stitching) return;
    cancelledRef.current = false;
    setStitching(true);
    setError(null);
    setFailedStep(null);
    try {
      pushLog('Đang ghép các cảnh thành phim hoàn chỉnh…', 'info');
      await api.filmStitch(filmId);
      let finalUrl = null;
      for (let round = 0; round < STITCH_MAX_ROUNDS; round++) {
        if (cancelledRef.current) throw new Error('Đã dừng');
        await sleep(POLL_MS);
        if (cancelledRef.current) throw new Error('Đã dừng');
        const data = await api.film(filmId);
        if (data?.project?.finalUrl) { finalUrl = data.project.finalUrl; break; }
      }
      if (!finalUrl) throw new Error('Hết thời gian chờ ghép phim — bấm "Thử lại" để kiểm tra lại');
      const resultNodes = onFilmDone?.(finalUrl, shotNodes) || [];
      setFilmDone(true);
      setReadyToStitch(false);
      pushLog('Đã ghép xong phim hoàn chỉnh', 'ok');
      if (resultNodes.length) set_viewport(resultNodes);
    } catch (e) {
      const msg = e?.message || 'Đã xảy ra lỗi';
      setError(msg);
      pushLog(`Lỗi ghép phim: ${msg}`, 'error');
      setFailedStep('stitch');
    } finally {
      setStitching(false);
    }
  };

  const stopFlow = () => {
    cancelledRef.current = true;
    setRunning(false);
    setStitching(false);
    pushLog('Đã dừng theo dõi (pipeline trên máy chủ vẫn có thể đang chạy — bấm "Thử lại" để theo dõi tiếp)', 'error');
  };

  if (!open) return null;

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      {/* Nền mờ trên điện thoại: bấm để đóng */}
      <div className="absolute inset-0 z-[15] bg-black/50 md:hidden" onClick={onClose} />
      <aside className="absolute bottom-20 right-0 top-14 z-20 flex w-[340px] max-w-[85vw] flex-col border-l border-white/[0.06] bg-ink-900/95 backdrop-blur-xl md:bottom-0">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-3">
          <Sparkles size={16} className="shrink-0 text-brand-400" />
          <h2 className="flex-1 text-[15px] font-semibold text-white">Agent làm phim</h2>
          <button
            onClick={onClose}
            aria-label="Đóng Agent làm phim"
            className="rounded-lg p-1.5 text-mist-400 transition hover:bg-white/5 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {/* Ý tưởng 1 câu */}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-mist-300">Ý tưởng phim (1 câu)</label>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              disabled={running}
              rows={3}
              placeholder="VD: một con mèo cam giao đồ ăn trong đêm mưa ở Sài Gòn…"
              className="w-full resize-none rounded-xl border border-white/[0.07] bg-[#0d111c] px-3 py-2.5 text-[13px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
            />
          </div>

          {/* Cài đặt: số cảnh / thời lượng mỗi cảnh / tỉ lệ */}
          <div className="space-y-2.5">
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-mist-300">Số cảnh</p>
              <div className="flex gap-1.5">
                {SHOT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setShots(n)}
                    disabled={running}
                    className={clsx(
                      'h-9 flex-1 rounded-lg text-[13px] font-medium transition',
                      shots === n ? 'bg-brand-400/20 text-brand-300 ring-1 ring-brand-400/40' : 'bg-white/[0.04] text-mist-300 hover:bg-white/[0.08]'
                    )}
                  >
                    {n} cảnh
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-mist-300">Thời lượng mỗi cảnh</p>
              <div className="flex gap-1.5">
                {DURATION_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setDuration(n)}
                    disabled={running}
                    className={clsx(
                      'h-9 flex-1 rounded-lg text-[13px] font-medium transition',
                      duration === n ? 'bg-brand-400/20 text-brand-300 ring-1 ring-brand-400/40' : 'bg-white/[0.04] text-mist-300 hover:bg-white/[0.08]'
                    )}
                  >
                    {n}s
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-mist-300">Tỉ lệ khung hình</p>
              <div className="flex gap-1.5">
                {ASPECT_OPTIONS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAspect(a)}
                    disabled={running}
                    className={clsx(
                      'h-9 flex-1 rounded-lg text-[13px] font-medium transition',
                      aspect === a ? 'bg-brand-400/20 text-brand-300 ring-1 ring-brand-400/40' : 'bg-white/[0.04] text-mist-300 hover:bg-white/[0.08]'
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Ước tính điểm */}
          <p className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-[13px] text-mist-200">
            Ước tính: <span className="font-semibold text-white">{estimate} điểm</span>
            <span className="text-mist-400"> ({shots} cảnh × {5 + 10 + 2 * duration} điểm)</span>
          </p>

          {/* Hộp xác nhận nội tuyến (bắt buộc trước khi chạy) */}
          {confirmOpen && !running && (
            <div className="space-y-2.5 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-3 py-3">
              <p className="text-[13px] leading-relaxed text-mist-100">
                Sẽ dùng khoảng <span className="font-semibold text-white">{estimate} điểm</span> (ảnh 5 + video 10+2×thời lượng mỗi cảnh). Chạy?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setConfirmOpen(false); runFlow(); }}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-400 text-[13px] font-semibold text-[#06231c] transition hover:brightness-110"
                >
                  <Play size={14} /> Chạy ngay
                </button>
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="flex h-9 flex-1 items-center justify-center rounded-lg bg-white/[0.06] text-[13px] font-medium text-mist-200 transition hover:bg-white/[0.1]"
                >
                  Hủy
                </button>
              </div>
            </div>
          )}

          {/* Nút chạy / dừng */}
          {!confirmOpen && (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={running || idea.trim().length < 3}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-400 text-[13.5px] font-semibold text-[#06231c] transition hover:brightness-110 disabled:opacity-40"
              >
                {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {running ? 'Đang chạy…' : 'Chạy'}
              </button>
              {running && (
                <button
                  onClick={stopFlow}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-white/[0.06] px-4 text-[13px] font-medium text-mist-200 transition hover:bg-white/[0.1]"
                >
                  <Square size={13} /> Dừng
                </button>
              )}
            </div>
          )}

          {/* Thanh tiến độ */}
          {progress.total > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[12px] text-mist-300">
                <span>Tiến độ tạo video</span>
                <span className="font-mono">{progress.done}/{progress.total} cảnh ({pct}%)</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-brand-400 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {/* Ghép phim / Thử lại */}
          {readyToStitch && !filmDone && (
            <button
              onClick={stitch}
              disabled={stitching}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-brand-400 text-[13.5px] font-semibold text-[#06231c] transition hover:brightness-110 disabled:opacity-40"
            >
              {stitching ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}
              {stitching ? 'Đang ghép…' : 'Ghép thành phim'}
            </button>
          )}
          {filmDone && (
            <p className="rounded-xl border border-brand-400/30 bg-brand-400/[0.08] px-3 py-2.5 text-[13px] text-brand-300">
              Đã xong — nút “Phim hoàn chỉnh” nằm ở cuối hàng cảnh trên canvas.
            </p>
          )}
          {error && !running && (
            <div className="space-y-2 rounded-xl border border-rose-400/30 bg-rose-400/[0.07] px-3 py-2.5">
              <p className="text-[13px] leading-relaxed text-rose-200">{error}</p>
              {failedStep === 'generate' && filmId && (
                <button
                  onClick={retryGenerate}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] text-[13px] font-medium text-mist-100 transition hover:bg-white/[0.1]"
                >
                  <RotateCcw size={14} /> Thử lại
                </button>
              )}
              {failedStep === 'stitch' && (
                <button
                  onClick={stitch}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] text-[13px] font-medium text-mist-100 transition hover:bg-white/[0.1]"
                >
                  <RotateCcw size={14} /> Thử ghép lại
                </button>
              )}
            </div>
          )}

          {/* Nhật ký tiến trình */}
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-mist-300">Nhật ký</p>
            <div
              ref={logRef}
              className="h-44 space-y-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-[#0d111c]/80 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed"
            >
              {logs.length === 0 && (
                <p className="text-mist-400">Chưa có gì — nhập ý tưởng rồi bấm “Chạy”.</p>
              )}
              {logs.map((l, i) => (
                <p
                  key={i}
                  className={clsx(
                    l.kind === 'error' && 'text-rose-300',
                    l.kind === 'ok' && 'text-brand-300',
                    l.kind === 'op' && 'text-sky-300',
                    l.kind === 'info' && 'text-mist-200'
                  )}
                >
                  <span className="text-mist-400">{l.time}</span> {l.text}
                </p>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
