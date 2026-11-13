import { useRef, useState } from 'react';
import {
  X, Type, Image as ImageIcon, Video, Sparkles, Loader2, Trash2, Upload, Unlink, Wand2,
  Check, Layers,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useToast } from './ui.jsx';
import { api } from '../lib/api.js';
import { getCanvasTheme } from '../lib/canvas-theme.js';

const ASSIST_SYSTEM = 'Bạn là trợ lý viết prompt cho công cụ tạo video và ảnh AI. Người dùng mô tả ý tưởng bằng tiếng Việt. Nhiệm vụ của bạn: viết lại thành một prompt chi tiết, sinh động, sẵn sàng dùng để tạo video/ảnh. Chỉ trả về duy nhất nội dung prompt, không giải thích, không thêm tiêu đề hay dấu ngoặc kép bao quanh. Prompt viết bằng tiếng Việt.';

const IMAGE_SIZES = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const VIDEO_SIZES = ['16:9', '9:16', '1:1'];
const DURATIONS = [5, 8, 10];

const inputName = (n) => n.label
  || (n.type === 'image' ? 'Hình ảnh' : n.type === 'text' ? 'Văn bản' : n.type === 'group' ? 'Nhóm' : 'Nút');

/* Bảng cấu hình của nút ảnh/video — xếp dọc, rộng toàn bộ:
   - Hàng trên (góc trái): Đầu vào — thay cho tên nút, để ô nhập prompt rộng hơn.
   - Giữa: ô nhập câu lệnh rộng toàn bộ + "Nhờ Muse viết prompt".
   - Hàng dưới: thời gian + tỉ lệ (trái), tạo / tải lên / xóa (phải).
   Nút văn bản KHÔNG dùng bảng này nữa — nhấn vào là nhập trực tiếp trong nút.
   - Nút ảnh: câu lệnh + tỉ lệ + "Tạo ảnh" (tạo ngay trong nút này) hoặc tải ảnh lên.
   - Nút video: câu lệnh + thời lượng + tỉ lệ + "Tạo video"; lấy tất cả ảnh/văn bản
     của các nút nối VÀO nó làm tham chiếu (nhiều nút ảnh cùng nối vào 1 nút video được).
   Mỗi đầu vào hiện tên nút (Ảnh 1, Ảnh 2…) để biết gọi nút nào khi làm ảnh tham chiếu. */
export default function NodeInspector({
  node, inputs, busy, style, placement = 'below', onClose, onUpdate, onGenerate, onUpload, onDelete, onRemoveLink,
  onToggleInput, onSizeChange,
}) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const theme = getCanvasTheme();

  if (!node) return null;

  const isText = node.type === 'text';
  const isImage = node.type === 'image';
  const isVideo = node.type === 'video';
  const Icon = isText ? Type : isImage ? ImageIcon : Video;
  const running = node.status === 'running';
  const failed = node.status === 'failed';

  // Nhờ Muse viết lại câu lệnh bằng tiếng Việt (dùng tài khoản Muse đã liên kết)
  const assistPrompt = async () => {
    const idea = node.text?.trim();
    if (!idea) return toast('Nhập ý tưởng trước đã', 'error');
    const kind = isVideo ? 'video' : isImage ? 'ảnh' : 'video/ảnh';
    setAssisting(true);
    try {
      const out = await api.chat({
        model: 'muse-spark',
        messages: [
          { role: 'system', content: ASSIST_SYSTEM },
          { role: 'user', content: `Viết prompt ${kind}: ${idea}` },
        ],
      });
      const content = out?.content?.trim();
      if (!content) throw new Error('Muse không trả về nội dung');
      onUpdate({ text: content });
      toast('Đã viết xong prompt', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAssisting(false);
    }
  };

  const pickFile = async (files) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Chỉ nhận tệp hình ảnh', 'error');
    setUploading(true);
    try {
      await onUpload(f);
      toast('Đã tải ảnh lên nút này', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      style={{
        ...style,
        backgroundColor: theme.node.panelOverlay,
        borderColor: `color-mix(in srgb, ${theme.node.activeStroke} 30%, transparent)`,
      }}
      className="absolute z-30 rounded-2xl border p-3 shadow-[0_20px_50px_-12px_rgba(0,0,0,.9)] backdrop-blur-xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Hàng trên: Đầu vào ở góc trái (thay cho tên nút) + trạng thái + đóng */}
      {!isText && (
        <div className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-[11px] text-mist-400">Đầu vào ({inputs.length}):</p>
            {inputs.length > 0 && (
              <div className="flex flex-wrap items-start gap-2">
                {inputs.map((n) => {
                  const off = (node.disabledInputs || []).includes(n.id);
                  return (
                    <span key={n.id} className={clsx('flex w-[52px] flex-col items-center gap-1', off && 'opacity-40')}>
                      <span className="group relative inline-flex items-center">
                        {n.type === 'group' ? (
                          <span className="grid h-7 w-9 place-items-center rounded-md bg-ink-800 ring-1 ring-white/10" title={inputName(n)}>
                            <Layers size={11} className="text-brand-400" />
                          </span>
                        ) : n.type === 'image' && n.mediaUrl ? (
                          <img src={n.mediaUrl} alt={inputName(n)} title={inputName(n)} className="h-7 w-9 rounded-md object-cover ring-1 ring-white/10" />
                        ) : (
                          <span className="grid h-7 w-9 place-items-center rounded-md bg-ink-800 ring-1 ring-white/10" title={inputName(n)}>
                            <Type size={11} className="text-brand-400" />
                          </span>
                        )}
                        <button
                          onClick={() => onToggleInput?.(n.id)}
                          title="Bật/Tắt đầu vào này"
                          aria-label="Bật/Tắt đầu vào này"
                          className="absolute -bottom-1 -left-1 grid h-4 w-4 place-items-center rounded-full bg-ink-800 text-mist-300 ring-1 ring-white/20 hover:text-white"
                        >
                          {off ? <X size={8} /> : <Check size={8} className="text-brand-400" />}
                        </button>
                        <button
                          onClick={() => onRemoveLink(n.id)}
                          title="Gỡ kết nối này"
                          className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-ink-800 text-mist-400 ring-1 ring-white/20 hover:text-rose-400"
                        >
                          <Unlink size={8} />
                        </button>
                      </span>
                      <span className="w-full truncate text-center text-[10px] leading-tight text-mist-300" title={inputName(n)}>
                        {inputName(n)}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <span className={clsx(
            'mt-1 h-2 w-2 shrink-0 rounded-full',
            running ? 'bg-amber-400 pulse-dot' : failed ? 'bg-rose-400' : node.mediaUrl ? 'bg-brand-400' : 'bg-mist-400'
          )}
          />
          <button onClick={onClose} className="shrink-0 rounded-md p-1 text-mist-400 hover:bg-white/5 hover:text-white">
            <X size={13} />
          </button>
        </div>
      )}
      {isText && (
        <div className="mb-2 flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-ink-800">
            <Icon size={13} className="text-brand-400" />
          </span>
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-white">{node.label || 'Văn bản'}</span>
          <button onClick={onClose} className="shrink-0 rounded-md p-1 text-mist-400 hover:bg-white/5 hover:text-white">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Câu lệnh: ô nhập prompt rộng toàn bộ */}
      <textarea
        value={node.text || ''}
        onChange={(e) => onUpdate({ text: e.target.value })}
        rows={3}
        placeholder={isText
          ? 'Nhập câu lệnh… (sẽ truyền vào nút ảnh/video nối từ đây)'
          : isImage
            ? 'Mô tả ảnh muốn tạo… (trống thì dùng câu lệnh nút văn bản nối vào)'
            : 'Mô tả video muốn tạo… (trống thì dùng câu lệnh nút văn bản nối vào)'}
        className="block w-full resize-none rounded-xl border border-white/[0.07] bg-[#0d111c] px-3 py-2 text-[12.5px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
      />

      {/* Nhờ Muse viết prompt bằng tiếng Việt */}
      <button
        onClick={assistPrompt}
        disabled={assisting || !node.text?.trim()}
        className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-brand-400/30 text-[12px] text-brand-300 transition hover:bg-brand-400/10 disabled:opacity-40"
      >
        {assisting ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
        {assisting ? 'Muse đang viết…' : 'Nhờ Muse viết prompt'}
      </button>

      {/* Hàng dưới: thời gian + tỉ lệ (trái), tạo / tải lên / xóa (phải) */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {!isText && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
            {isVideo && (
              <div className="seg">
                {DURATIONS.map((d) => (
                  <button key={d} onClick={() => onUpdate({ duration: d })} className={clsx((node.duration || 5) === d && 'on')} style={{ minWidth: 0, padding: '3px 10px', fontSize: 11 }}>
                    {d}s
                  </button>
                ))}
              </div>
            )}
            <div className="seg">
              {(isImage ? IMAGE_SIZES : VIDEO_SIZES).map((sz) => (
                <button
                  key={sz}
                  onClick={() => (onSizeChange ? onSizeChange(sz) : onUpdate({ size: sz }))}
                  className={clsx((node.size || (isImage ? '1:1' : '16:9')) === sz && 'on')}
                  style={{ minWidth: 0, padding: '3px 10px', fontSize: 11 }}
                >
                  {sz}
                </button>
              ))}
            </div>
            <span className="font-mono text-[10.5px] text-mist-400">
              {running ? `Đang tạo ${node.progress || 0}%` : failed ? 'Thất bại' : node.mediaUrl ? 'Đã tạo xong' : ''}
            </span>
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isImage && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || running}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 text-[12px] text-mist-200 transition hover:border-white/20 hover:text-white disabled:opacity-50"
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Tải lên
            </button>
          )}
          {!isText && (
            <button
              onClick={onGenerate}
              disabled={busy || running}
              className="mint-btn flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold disabled:opacity-50"
            >
              {busy || running ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {isImage ? 'Tạo ảnh' : 'Tạo video'}
            </button>
          )}
          <button
            onClick={onDelete}
            title="Xóa nút này"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-rose-500/30 text-rose-300 transition hover:bg-rose-500/10"
          >
            <Trash2 size={13} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickFile(e.target.files)} />
        </div>
      </div>
    </div>
  );
}
