import { useEffect, useMemo, useState } from 'react';
import { X, Search, Copy, Check, BookOpen, Image as ImageIcon, Loader2, Plus, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { useToast } from './ui.jsx';

/* Thư viện prompt Muse Video — 204 mẫu, đồng bộ từ
   github.com/apimodels/muse-video-prompts (CC-BY-4.0).
   Tìm kiếm + lọc theo 13 nhóm; bấm "Dùng prompt này" để đưa vào Canvas. */
export default function PromptLibrary({ open, onClose, onUse, embedded = false }) {
  const toast = useToast();
  const [prompts, setPrompts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if ((!open && !embedded) || prompts) return;
    setLoading(true);
    api.prompts()
      .then((d) => setPrompts(d.prompts || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, embedded, prompts]);

  const categories = useMemo(() => {
    if (!prompts) return [];
    const counts = {};
    prompts.forEach((p) => { counts[p.category_en] = (counts[p.category_en] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [prompts]);

  const filtered = useMemo(() => {
    if (!prompts) return [];
    const q = query.trim().toLowerCase();
    return prompts.filter((p) => {
      if (cat !== 'all' && p.category_en !== cat) return false;
      if (!q) return true;
      return (p.title + ' ' + p.author + ' ' + (p.text || '') + ' ' + (p.category || '')).toLowerCase().includes(q);
    });
  }, [prompts, query, cat]);

  if (!open && !embedded) return null;

  const copyText = async (p) => {
    try {
      await navigator.clipboard.writeText(p.text || '');
      setCopiedId(p.id);
      setTimeout(() => setCopiedId(null), 1500);
      toast('Đã sao chép prompt', 'ok');
    } catch {
      toast('Không sao chép được', 'error');
    }
  };

  // Nội dung dùng chung cho cả drawer độc lập và chế độ nhúng (embedded):
  // embedded thì bỏ khung drawer/nền mờ và bỏ tiêu đề (bảng bên đã có tiêu đề/tab).
  const body = (
    <>
      {!embedded && (
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-3.5">
          <BookOpen size={16} className="text-brand-400" />
          <h2 className="flex-1 text-[15px] font-semibold text-white">Thư viện prompt</h2>
          <span className="font-mono text-[11px] text-mist-400">{prompts ? `${filtered.length}/${prompts.length} mẫu` : ''}</span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-mist-400 hover:bg-white/5 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

        <div className="shrink-0 space-y-2 border-b border-white/[0.06] px-4 py-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tên, tác giả, nội dung…"
              className="h-9 w-full rounded-xl border border-white/[0.07] bg-[#0d111c] pl-9 pr-3 text-[13px] text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
            />
          </div>
          {/* Mục phân loại: xổ xuống (dropdown) — hàng cuộn ngang không cuộn
              được bằng chuột thường, dropdown thì bấm là chọn */}
          <div className="relative">
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              aria-label="Lọc theo phân loại"
              className="h-9 w-full appearance-none rounded-xl border border-white/[0.07] bg-[#0d111c] pl-3 pr-9 text-[13px] text-mist-100 outline-none focus:border-brand-400/50"
            >
              <option value="all">Tất cả ({prompts?.length || 0})</option>
              {categories.map(([name, n]) => (
                <option key={name} value={name}>
                  {shortCat(name)} ({n})
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-mist-400" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-mist-400">
              <Loader2 size={16} className="animate-spin" /> Đang tải thư viện…
            </div>
          )}
          {error && <p className="py-6 text-center text-[13px] text-rose-300">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="py-6 text-center text-[13px] text-mist-400">Không tìm thấy mẫu nào.</p>
          )}
          {filtered.map((p) => {
            const expanded = expandedId === p.id;
            return (
              <div key={p.id} className="mb-2 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0d111c]">
                <button
                  onClick={() => setExpandedId(expanded ? null : p.id)}
                  className="block w-full px-3.5 py-3 text-left transition hover:bg-white/[0.03]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium leading-snug text-white">{p.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-mist-400">{p.id}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-mist-400">
                    <span>@{p.author}</span>
                    {p.aspect && <span>{p.aspect}</span>}
                    {p.seconds && <span>{p.seconds}s</span>}
                    {p.needs_reference && (
                      <span className="flex items-center gap-0.5 text-amber-300"><ImageIcon size={10} /> Cần ảnh mẫu</span>
                    )}
                    <span className={p.text_status === 'excerpt' ? 'text-mist-400' : 'text-brand-300'}>
                      {p.text_status === 'excerpt' ? 'Trích đoạn' : 'Đầy đủ'}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-mist-400">{shortCat(p.category_en)}</div>
                </button>
                {expanded && (
                  <div className="border-t border-white/[0.06] px-3.5 py-3">
                    <p className="max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-[12.5px] leading-relaxed text-mist-100">
                      {p.text}
                    </p>
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-[11px] text-brand-300 hover:underline">
                        Gốc: {p.url}
                      </a>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => onUse(p)}
                        className="mint-btn flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold"
                      >
                        <Plus size={14} /> Dùng prompt này
                      </button>
                      <button
                        onClick={() => copyText(p)}
                        className="flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 text-[12px] text-mist-200 transition hover:border-white/20 hover:text-white"
                      >
                        {copiedId === p.id ? <Check size={13} className="text-brand-400" /> : <Copy size={13} />} Sao chép
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
    </>
  );

  if (embedded) {
    return <div className="flex h-full min-h-0 flex-col">{body}</div>;
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[480px] flex-col border-l border-white/[0.06] bg-ink-900/95 backdrop-blur-xl fade-in">
        {body}
      </div>
    </>
  );
}

function shortCat(name = '') {
  return name
    .replace('Multi-shot beat cut (reference-sheet template)', 'Nhiều shot · cắt theo nhịp')
    .replace('Boyfriend POV', 'Góc nhìn bạn trai')
    .replace('Selfie and vlog', 'Tự sướng & Vlog')
    .replace('Chinese period and historical', 'Cổ phong & lịch sử')
    .replace('Dance', 'Nhảy')
    .replace('Fantasy, animation and CG', 'Giả tưởng & hoạt hình')
    .replace('Fashion portrait', 'Thời trang')
    .replace('One-liners and chat instructions', 'Một câu & hướng dẫn chat')
    .replace('Long-form and multi-clip scripts', 'Phim dài nhiều đoạn')
    .replace('Documentary and landscape', 'Tài liệu & phong cảnh')
    .replace('Transitions and outfit changes', 'Chuyển cảnh & đổi đồ')
    .replace('Cinematic and story', 'Điện ảnh & cốt truyện')
    .replace('ASMR', 'ASMR');
}
