import { useEffect, useMemo, useState } from 'react';
import { X, Search, Type, Image as ImageIcon, Video, Group } from 'lucide-react';
import { clsx } from 'clsx';
import PromptLibrary from '../PromptLibrary.jsx';

/* Bảng bên trái của Canvas (Phase 5): 2 tab Node | Prompt.
   - Tab Node: danh sách nút (tìm kiếm + lọc theo loại), bấm để đưa nút ra giữa
     màn hình và mở bảng cấu hình của nó.
   - Tab Prompt: nhúng trực tiếp nội dung thư viện prompt (không còn drawer riêng).
   Panel nổi bên trái, đè lên canvas (không đẩy canvas); trên điện thoại thành
   drawer với nền mờ, bấm nền mờ / X / Escape để đóng. */
const TYPE_META = {
  text: { label: 'Chữ', icon: Type },
  image: { label: 'Ảnh', icon: ImageIcon },
  video: { label: 'Video', icon: Video },
  group: { label: 'Nhóm', icon: Group },
};

const STATUS_DOT = {
  done: 'bg-brand-400',
  running: 'bg-amber-400',
  failed: 'bg-rose-400',
};

const STATUS_TEXT = {
  done: 'Đã tạo xong',
  running: 'Đang tạo',
  failed: 'Thất bại',
};

const FILTERS = [
  ['all', 'Tất cả'],
  ['text', 'Chữ'],
  ['image', 'Ảnh'],
  ['video', 'Video'],
  ['group', 'Nhóm'],
];

export default function CanvasSidePanel({
  open,
  onClose,
  nodes,
  links,
  selectedIds,
  onFocusNode,
  onCreateTextNode,
  initialTab = 'nodes',
}) {
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  // Escape đóng panel (kể cả khi đang gõ trong ô tìm kiếm của panel)
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (nodes || []).filter((n) => {
      if (typeFilter !== 'all' && n.type !== typeFilter) return false;
      if (!q) return true;
      return ((n.label || '') + ' ' + (n.text || '')).toLowerCase().includes(q);
    });
  }, [nodes, query, typeFilter]);

  if (!open) return null;

  return (
    <>
      {/* Nền mờ trên điện thoại: bấm để đóng */}
      <div className="absolute inset-0 z-[15] bg-black/50 md:hidden" onClick={onClose} />
      <aside className="absolute bottom-20 left-0 top-14 z-20 flex w-[280px] max-w-[85vw] flex-col border-r border-white/[0.06] bg-ink-900/95 backdrop-blur-xl md:bottom-0">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-3">
          <h2 className="flex-1 text-[15px] font-semibold text-white">Bảng bên</h2>
          <button
            onClick={onClose}
            aria-label="Đóng bảng bên"
            className="rounded-lg p-1.5 text-mist-400 transition hover:bg-white/5 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-white/[0.06] px-3 py-2">
          <button
            onClick={() => setTab('nodes')}
            className={clsx(
              'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition',
              tab === 'nodes' ? 'bg-white/[0.08] text-white' : 'text-mist-300 hover:bg-white/5 hover:text-white'
            )}
          >
            Node
            <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-mist-300">
              {nodes?.length || 0}
            </span>
          </button>
          <button
            onClick={() => setTab('prompts')}
            className={clsx(
              'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition',
              tab === 'prompts' ? 'bg-white/[0.08] text-white' : 'text-mist-300 hover:bg-white/5 hover:text-white'
            )}
          >
            Prompt
          </button>
        </div>

        {tab === 'nodes' ? (
          <>
            <div className="shrink-0 space-y-2 border-b border-white/[0.06] px-3 py-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm node…"
                  aria-label="Tìm node"
                  className="h-9 w-full rounded-xl border border-white/[0.07] bg-[#0d111c] pl-9 pr-3 text-[13px] text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setTypeFilter(value)}
                    className={clsx(
                      'rounded-full px-2.5 py-1 text-[11.5px] transition',
                      typeFilter === value
                        ? 'bg-brand-400/20 text-brand-300 ring-1 ring-brand-400/40'
                        : 'bg-white/[0.04] text-mist-300 hover:bg-white/[0.08]'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-center text-[13px] text-mist-400">Không tìm thấy nút nào.</p>
              )}
              {filtered.map((n) => {
                const meta = TYPE_META[n.type] || TYPE_META.text;
                const Icon = meta.icon;
                const isSelected = selectedIds?.includes(n.id);
                const members = n.type === 'group'
                  ? (nodes || []).filter((m) => m.groupId === n.id).length
                  : 0;
                const sub = n.type === 'text'
                  ? (n.text?.trim() || 'Văn bản trống')
                  : n.type === 'group'
                    ? `${members} nút thành viên`
                    : STATUS_TEXT[n.status] || 'Chưa tạo';
                return (
                  <button
                    key={n.id}
                    onClick={() => onFocusNode(n)}
                    className={clsx(
                      'flex min-h-[44px] w-full items-center gap-2.5 border-b border-white/[0.04] px-3 py-2 text-left transition hover:bg-white/[0.04]',
                      isSelected && 'bg-brand-400/10'
                    )}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-brand-400">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-white">
                        {n.label || (n.text?.trim() ? n.text.trim().slice(0, 40) : meta.label)}
                      </span>
                      <span className="block truncate text-[11px] text-mist-400">{sub}</span>
                    </span>
                    <span
                      className={clsx('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[n.status] || 'bg-mist-400')}
                      title={STATUS_TEXT[n.status] || 'Chưa tạo'}
                    />
                    <span className="shrink-0 text-[10.5px] text-mist-400">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1">
            <PromptLibrary embedded onUse={onCreateTextNode} />
          </div>
        )}
      </aside>
    </>
  );
}
