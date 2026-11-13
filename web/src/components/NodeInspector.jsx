import { useEffect, useRef, useState } from 'react';
import {
  X, Type, Image as ImageIcon, Video, Sparkles, Loader2, Trash2, Upload, Unlink, Wand2,
  Check, Layers, Crown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useToast } from './ui.jsx';
import { api } from '../lib/api.js';
import { getCanvasTheme } from '../lib/canvas-theme.js';

const ASSIST_SYSTEM = 'Bạn là trợ lý viết prompt cho công cụ tạo video và ảnh AI. Người dùng mô tả ý tưởng bằng tiếng Việt. Nhiệm vụ của bạn: viết lại thành một prompt chi tiết, sinh động, sẵn sàng dùng để tạo video/ảnh. Chỉ trả về duy nhất nội dung prompt, không giải thích, không thêm tiêu đề hay dấu ngoặc kép bao quanh. Prompt viết bằng tiếng Việt.';

const IMAGE_SIZES = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const VIDEO_SIZES = ['16:9', '9:16', '1:1'];
const DURATIONS = [5, 8, 10];

/* Bảng cấu hình của nút ảnh/video — xổ xuống liền với nút (như menu thả xuống),
   cùng chiều rộng với nút, mép chạm mép nút (placement 'below' = dưới nút,
   'above' = trên nút khi không đủ chỗ bên dưới). Cha truyền style { left, top,
   width } đã tính theo vị trí nút trên màn hình.
   Nút văn bản KHÔNG dùng bảng này nữa — nhấn vào là nhập trực tiếp trong nút.
   - Nút ảnh: câu lệnh + tỉ lệ + "Tạo ảnh" (tạo ngay trong nút này) hoặc tải ảnh lên.
   - Nút video: câu lệnh + thời lượng + tỉ lệ + "Tạo video"; lấy tất cả ảnh/văn bản
     của các nút nối VÀO nó làm tham chiếu (nhiều nút ảnh cùng nối vào 1 nút video được). */
export default function NodeInspector({
  node, inputs, busy, style, placement = 'below', onClose, onUpdate, onGenerate, onUpload, onDelete, onRemoveLink,
  onToggleInput, onSizeChange,
}) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [isVip, setIsVip] = useState(false);
  const theme = getCanvasTheme();

  // Chỉ user đang có VIP mới bật được công tắc acc VIP.
  useEffect(() => {
    api.vipStatus().then((st) => setIsVip(!!st?.isVip)).catch(() => {});
  }, []);

  if (!node) return null;

  const isText = node.type === 'text';
  const isImage = node.type === 'image';
  const isVideo = node.type === 'video';
  const Icon = isText ? Type : isImage ? ImageIcon : Video;
  const running = node.status === 'running';
  const failed = node.status === 'failed';
  const cost = isImage ? 5 : isVideo ? 10 + 2 * (node.duration || 5) : 0;

  // Ảnh tham chiếu nối vào nút video (bỏ qua đầu vào đã tắt): dùng để phân tích.
  const imageInputs = isVideo
    ? (inputs || []).filter((n) => n.type === 'image' && n.mediaUrl && !(node.disabledInputs || []).includes(n.id))
    : [];

  // Đọc ảnh tham chiếu rồi viết prompt video tiếng Việt (theo kỹ năng viết prompt).
  const analyzeImages = async () => {
    if (!imageInputs.length || analyzing) return;
    setAnalyzing(true);
    try {
      const out = await api.analyzeImage({
        images: imageInputs.map((n, i) => ({ url: n.mediaUrl, label: n.text?.trim() || `Ảnh ${i + 1}` })),
        motion: node.text || '',
      });
      if (out.descriptions) setAnalysis(out.descriptions);
      if (out.videoPrompt) {
        onUpdate({ text: out.videoPrompt });
        toast('Đã viết prompt từ ảnh — bạn có thể sửa trước khi tạo', 'ok');
      } else {
        toast('Đã phân tích ảnh, nhưng chưa viết được prompt — hãy tự viết từ phần mô tả', 'info');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAnalyzing(false);
    }
  };

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
      className={clsx(
        'absolute z-30 border p-3 shadow-[0_20px_50px_-12px_rgba(0,0,0,.9)] backdrop-blur-xl',
        // Mép chạm nút thì bo nhỏ để trông liền một khối với nút
        placement === 'below' ? 'rounded-b-2xl rounded-t-lg' : 'rounded-b-lg rounded-t-2xl'
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Đầu: tên nút + trạng thái + đóng */}
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-ink-800">
          <Icon size={13} className="text-brand-400" />
        </span>
        <input
          value={node.label || ''}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder={isText ? 'Văn bản' : isImage ? 'Hình ảnh' : 'Video'}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-white outline-none placeholder:text-mist-400"
        />
        <span className={clsx(
          'h-2 w-2 shrink-0 rounded-full',
          running ? 'bg-amber-400 pulse-dot' : failed ? 'bg-rose-400' : node.mediaUrl ? 'bg-brand-400' : 'bg-mist-400'
        )}
        />
        <button onClick={onClose} className="shrink-0 rounded-md p-1 text-mist-400 hover:bg-white/5 hover:text-white">
          <X size={13} />
        </button>
      </div>

      {/* Câu lệnh */}
      <textarea
        value={node.text || ''}
        onChange={(e) => onUpdate({ text: e.target.value })}
        rows={2}
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

      {/* Thông số */}
      {!isText && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
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
          <span className="ml-auto font-mono text-[10.5px] text-mist-400">
            {running ? `Đang tạo ${node.progress || 0}%` : failed ? 'Thất bại' : node.mediaUrl ? 'Đã tạo xong' : `${cost} điểm`}
          </span>
        </div>
      )}

      {/* Đầu vào (chỉ nút ảnh/video): ảnh tham chiếu nối vào.
          Mỗi đầu vào có nút bật/tắt riêng (lưu trên nút này, hoàn tác được);
          đầu vào bị tắt thì lúc tạo sẽ bỏ qua. */}
      {!isText && inputs.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-mist-400">Vào ({inputs.length}):</span>
          {inputs.map((n) => {
            const off = (node.disabledInputs || []).includes(n.id);
            return (
              <span key={n.id} className={clsx('group relative inline-flex items-center', off && 'opacity-40')}>
                {n.type === 'group' ? (
                  <span className="grid h-7 w-9 place-items-center rounded-md bg-ink-800 ring-1 ring-white/10" title={n.label || 'Nhóm'}>
                    <Layers size={11} className="text-brand-400" />
                  </span>
                ) : n.type === 'image' && n.mediaUrl ? (
                  <img src={n.mediaUrl} alt="" className="h-7 w-9 rounded-md object-cover ring-1 ring-white/10" />
                ) : (
                  <span className="grid h-7 w-9 place-items-center rounded-md bg-ink-800 ring-1 ring-white/10">
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
            );
          })}
        </div>
      )}
      {!isText && inputs.length === 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-mist-400">
          Chưa có đầu vào — kéo chấm tròn từ nút văn bản/ảnh vào nút này để thêm tham chiếu.
        </p>
      )}

      {/* Phân tích ảnh (chỉ nút video có ảnh tham chiếu nối vào):
          đọc ảnh rồi viết prompt video tiếng Việt theo kỹ năng viết prompt. */}
      {isVideo && imageInputs.length > 0 && (
        <div className="mt-2">
          <button
            onClick={analyzeImages}
            disabled={analyzing}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-brand-400/30 text-[12px] text-brand-300 transition hover:bg-brand-400/10 disabled:opacity-40"
          >
            {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {analyzing ? 'Đang đọc ảnh…' : 'Phân tích ảnh'}
          </button>
          {analysis && (
            <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/[0.07] bg-[#0d111c] p-2.5 text-[11.5px] leading-relaxed text-mist-300">
              {analysis}
            </p>
          )}
        </div>
      )}

      {/* Dùng acc VIP (chỉ nút video): bật thì lúc tạo sẽ dùng tài khoản Muse VIP của admin. */}
      {isVideo && (
        <label className={clsx(
          'mt-2 flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-[12px] transition',
          isVip ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-white/[0.06] bg-[#0d111c] opacity-60'
        )}>
          <input
            type="checkbox"
            checked={!!node.vip}
            disabled={!isVip}
            onChange={(e) => onUpdate({ vip: e.target.checked })}
            className="h-4 w-4 accent-amber-400"
          />
          <Crown size={13} className={isVip ? 'text-amber-300' : 'text-mist-400'} />
          <span className="text-mist-200">Dùng acc VIP</span>
          {!isVip && <span className="ml-auto text-[10.5px] text-mist-400">Cần có VIP</span>}
        </label>
      )}

      {/* Chân: tạo / tải lên / xóa */}
      <div className="mt-2.5 flex items-center gap-2">
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
            className="mint-btn flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold disabled:opacity-50"
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
  );
}
