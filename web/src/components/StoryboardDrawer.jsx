import { useState } from 'react';
import { X, Loader2, Clapperboard, Send, Copy, Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from './ui.jsx';

const STORY_SYSTEM = 'Bạn là đạo diễn phân cảnh cho video AI. Người dùng đưa một ý tưởng bằng tiếng Việt. Hãy chia ý tưởng thành N shot theo yêu cầu, trả về DUY NHẤT một mảng JSON, không giải thích, không thêm chữ nào ngoài JSON. Mỗi shot là một object với các trường: shot (số thứ tự, số nguyên), visual (mô tả hình ảnh trong shot, tiếng Việt), camera (chuyển động máy quay, tiếng Việt), duration (số giây, số nguyên), prompt (prompt chi tiết để tạo video cho shot này, tiếng Việt, sinh động và cụ thể — prompt PHẢI bao gồm cả góc quay và chuyển động camera trong chính nội dung prompt, không để riêng ở trường camera), voiceover (lời thoại hoặc phụ đề nếu có, tiếng Việt, có thể là chuỗi rỗng).';

/* Bảng phân cảnh: gõ một câu ý tưởng → Muse chia thành bảng shot
   (hình ảnh, chuyển động máy, thời lượng, prompt, lời thoại) →
   đưa các shot lên Canvas thành các nút video nối tiếp nhau. */
export default function StoryboardDrawer({ open, onClose, onSend }) {
  const toast = useToast();
  const [idea, setIdea] = useState('');
  const [shotCount, setShotCount] = useState(6);
  const [aspect, setAspect] = useState('9:16');
  const [shotDuration, setShotDuration] = useState(8);
  const [building, setBuilding] = useState(false);
  const [shots, setShots] = useState(null);
  const [rawText, setRawText] = useState('');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const build = async () => {
    const text = idea.trim();
    if (text.length < 2) return toast('Nhập ý tưởng trước đã', 'error');
    setBuilding(true);
    setShots(null);
    setRawText('');
    try {
      const out = await api.chat({
        model: 'muse-spark',
        messages: [
          { role: 'system', content: STORY_SYSTEM },
          { role: 'user', content: `Ý tưởng: ${text}\nSố shot: ${shotCount}\nMỗi shot: ${shotDuration} giây\nTỉ lệ: ${aspect}` },
        ],
      });
      const content = (out?.content || '').trim();
      if (!content) throw new Error('Muse không trả về nội dung');
      const parsed = parseShots(content);
      if (parsed) {
        setShots(parsed);
        toast(`Đã lập bảng ${parsed.length} shot`, 'ok');
      } else {
        setRawText(content);
        toast('Muse trả về văn bản (không phải bảng JSON) — bạn có thể sao chép để dùng', 'error');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBuilding(false);
    }
  };

  const updateShot = (i, patch) => {
    setShots((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  };

  const copyRaw = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast('Đã sao chép', 'ok');
    } catch {
      toast('Không sao chép được', 'error');
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l border-white/[0.06] bg-ink-900/95 backdrop-blur-xl fade-in">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-3.5">
          <Clapperboard size={16} className="text-brand-400" />
          <h2 className="flex-1 text-[15px] font-semibold text-white">Bảng phân cảnh</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-mist-400 hover:bg-white/5 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="shrink-0 space-y-3 border-b border-white/[0.06] px-4 py-3">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={2}
            placeholder="Một câu ý tưởng, ví dụ: mèo cam giao đồ ăn trong đêm mưa ở Sài Gòn"
            className="block w-full resize-none rounded-xl border border-white/[0.07] bg-[#0d111c] px-3 py-2.5 text-[13px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[12px] text-mist-300">Số shot</label>
            <div className="seg">
              {[4, 6, 8].map((n) => (
                <button key={n} onClick={() => setShotCount(n)} className={shotCount === n ? 'on' : ''} style={{ minWidth: 0, padding: '4px 12px', fontSize: 12 }}>
                  {n}
                </button>
              ))}
            </div>
            <label className="text-[12px] text-mist-300">Mỗi shot</label>
            <div className="seg">
              {[5, 8, 10].map((d) => (
                <button key={d} onClick={() => setShotDuration(d)} className={shotDuration === d ? 'on' : ''} style={{ minWidth: 0, padding: '4px 12px', fontSize: 12 }}>
                  {d}s
                </button>
              ))}
            </div>
            <label className="text-[12px] text-mist-300">Tỉ lệ</label>
            <div className="seg">
              {['9:16', '16:9'].map((a) => (
                <button key={a} onClick={() => setAspect(a)} className={aspect === a ? 'on' : ''} style={{ minWidth: 0, padding: '4px 12px', fontSize: 12 }}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={build}
            disabled={building || idea.trim().length < 2}
            className="mint-btn flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold disabled:opacity-50"
          >
            {building ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />}
            {building ? 'Muse đang chia shot…' : 'Lập bảng phân cảnh'}
          </button>
          <p className="text-[11px] leading-relaxed text-mist-400">
            Muse chia ý tưởng thành các shot nối tiếp nhau (hình ảnh, chuyển động máy, prompt, lời thoại). Bạn sửa prompt từng shot rồi đưa cả bảng lên Canvas.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {shots && (
            <>
              {shots.map((s, i) => (
                <div key={i} className="mb-2 rounded-xl border border-white/[0.06] bg-[#0d111c] px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-400/15 font-mono text-[11px] font-semibold text-brand-300">
                      {s.shot || i + 1}
                    </span>
                    <span className="flex-1 truncate text-[12.5px] font-medium text-white">{s.visual || ''}</span>
                    <span className="shrink-0 font-mono text-[11px] text-mist-400">{s.duration || shotDuration}s</span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-400">
                    🎥 {s.camera || ''}
                    {s.voiceover ? ` · 💬 ${s.voiceover}` : ''}
                  </p>
                  <textarea
                    value={s.prompt || ''}
                    onChange={(e) => updateShot(i, { prompt: e.target.value })}
                    rows={2}
                    className="mt-2 block w-full resize-none rounded-lg border border-white/[0.07] bg-black/30 px-2.5 py-2 text-[12.5px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
                  />
                </div>
              ))}
              <button
                onClick={() => onSend(shots, aspect)}
                className="mint-btn mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold"
              >
                <Send size={14} /> Đưa {shots.length} shot lên Canvas
              </button>
            </>
          )}
          {rawText && (
            <div>
              <p className="mb-2 text-[12.5px] text-mist-300">Muse trả về dạng văn bản, chưa tách được thành bảng:</p>
              <p className="whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-[12.5px] leading-relaxed text-mist-100">{rawText}</p>
              <button
                onClick={copyRaw}
                className="mt-3 flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 text-[12px] text-mist-200 transition hover:border-white/20 hover:text-white"
              >
                {copied ? <Check size={13} className="text-brand-400" /> : <Copy size={13} />} Sao chép toàn bộ
              </button>
            </div>
          )}
          {!shots && !rawText && !building && (
            <p className="py-8 text-center text-[13px] text-mist-400">
              Chưa có bảng phân cảnh. Nhập ý tưởng rồi bấm “Lập bảng phân cảnh”.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

// Lấy mảng JSON shot ra khỏi câu trả lời (thường nằm trong ```json ... ```).
function parseShots(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr
      .filter((s) => s && typeof s === 'object' && (s.prompt || s.visual))
      .map((s, i) => ({
        shot: s.shot || i + 1,
        visual: String(s.visual || ''),
        camera: String(s.camera || ''),
        duration: Number(s.duration) || 8,
        prompt: String(s.prompt || s.visual || ''),
        voiceover: String(s.voiceover || ''),
      }));
  } catch {
    return null;
  }
}
