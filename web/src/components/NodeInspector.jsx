import { useRef, useState } from 'react';
import {
  X, Type, Image as ImageIcon, Video, Sparkles, Loader2, Trash2, Upload, ArrowDownToLine, Unlink,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useToast } from './ui.jsx';

const IMAGE_SIZES = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const VIDEO_SIZES = ['16:9', '9:16', '1:1'];
const DURATIONS = [5, 8, 10];

/* Bảng cấu hình của một nút trên Canvas: bấm vào nút là hiện, sửa xong tự lưu.
   - Nút văn bản: chỉ có câu lệnh — nội dung này truyền vào các nút ảnh/video nối từ nó.
   - Nút ảnh: câu lệnh + tỉ lệ + nút "Tạo ảnh" (tạo ngay trong nút này) hoặc tải ảnh lên.
   - Nút video: câu lệnh + thời lượng + tỉ lệ + nút "Tạo video"; lấy tất cả ảnh/văn bản
     của các nút nối VÀO nó làm tham chiếu (nhiều nút ảnh cùng nối vào 1 nút video được). */
export default function NodeInspector({
  node, inputs, outputs, busy, onClose, onUpdate, onGenerate, onUpload, onDelete, onRemoveLink,
}) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  if (!node) return null;

  const isText = node.type === 'text';
  const isImage = node.type === 'image';
  const isVideo = node.type === 'video';
  const Icon = isText ? Type : isImage ? ImageIcon : Video;
  const typeLabel = isText ? 'Nút văn bản' : isImage ? 'Nút hình ảnh' : 'Nút video';
  const running = node.status === 'running';
  const failed = node.status === 'failed';
  const cost = isImage ? 5 : isVideo ? 10 + 2 * (node.duration || 5) : 0;

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
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-[#1e2432] bg-ink-900/95 backdrop-blur-xl fade-in">
        {/* Đầu */}
        <div className="flex items-center gap-2 border-b border-[#1e2432] px-4 py-3.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-ink-800">
            <Icon size={15} className="text-brand-400" />
          </span>
          <input
            value={node.label || ''}
            onChange={(e) => onUpdate({ label: e.target.value })}
            placeholder={typeLabel}
            className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-white outline-none placeholder:text-mist-400"
          />
          <span className={clsx(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10.5px]',
            running ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
              : failed ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
              : node.mediaUrl ? 'border-brand-400/30 bg-brand-500/10 text-brand-300'
              : 'border-white/10 bg-white/[0.03] text-mist-300'
          )}
          >
            {running ? `Đang tạo ${node.progress || 0}%` : failed ? 'Thất bại' : node.mediaUrl ? 'Đã tạo xong' : isText ? 'Đầu vào' : 'Trống'}
          </span>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-mist-400 hover:bg-ink-700 hover:text-white">
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Xem trước */}
          {!isText && (
            <div className="mb-4 overflow-hidden rounded-xl bg-black/40">
              {node.mediaUrl ? (
                isVideo ? (
                  <video src={node.mediaUrl} controls loop className="max-h-[240px] w-full" />
                ) : (
                  <img src={node.mediaUrl} alt="" className="max-h-[240px] w-full object-contain" />
                )
              ) : (
                <div className="grid h-[120px] place-items-center text-[12px] text-mist-400">
                  {running ? (
                    <span className="flex items-center gap-1.5 text-brand-300">
                      <Loader2 size={14} className="animate-spin" /> Đang tạo {node.progress || 0}%
                    </span>
                  ) : failed ? (
                    <span className="text-rose-400">{node.error || 'Tạo thất bại'}</span>
                  ) : (
                    'Chưa có nội dung — bấm Tạo ở phía dưới'
                  )}
                </div>
              )}
            </div>
          )}

          {/* Câu lệnh */}
          <label className="mb-1 block text-[11.5px] font-medium text-mist-200">
            {isText ? 'Câu lệnh (prompt)' : isImage ? 'Câu lệnh tạo ảnh' : 'Câu lệnh tạo video'}
          </label>
          <textarea
            value={node.text || ''}
            onChange={(e) => onUpdate({ text: e.target.value })}
            rows={isText ? 5 : 4}
            placeholder={isText
              ? 'Ví dụ: một con mèo lông cam ngồi trên bậu cửa sổ lúc hoàng hôn…'
              : isImage
                ? 'Mô tả hình ảnh muốn tạo… (để trống sẽ dùng câu lệnh của nút văn bản nối vào)'
                : 'Mô tả video muốn tạo… (để trống sẽ dùng câu lệnh của nút văn bản nối vào)'}
            className="block w-full resize-none rounded-xl border border-white/[0.07] bg-[#0d111c] px-3.5 py-3 text-[13px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-mist-400">
            {isText
              ? 'Nội dung này sẽ truyền vào các nút ảnh / video được nối từ nút này.'
              : isImage
                ? 'Ảnh tạo ra sẽ nằm ngay trong nút này, nối tiếp vào nút video để làm ảnh tham chiếu.'
                : 'Video sẽ dùng tất cả ảnh của các nút nối vào đây làm ảnh tham chiếu.'}
          </p>

          {/* Thông số */}
          {!isText && (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              {isVideo && (
                <div>
                  <span className="mb-1 block text-[11.5px] text-mist-300">Thời lượng</span>
                  <div className="seg">
                    {DURATIONS.map((d) => (
                      <button key={d} onClick={() => onUpdate({ duration: d })} className={clsx((node.duration || 5) === d && 'on')}>
                        {d}s
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <span className="mb-1 block text-[11.5px] text-mist-300">Tỉ lệ</span>
                <div className="seg">
                  {(isImage ? IMAGE_SIZES : VIDEO_SIZES).map((sz) => (
                    <button key={sz} onClick={() => onUpdate({ size: sz })} className={clsx((node.size || (isImage ? '1:1' : '16:9')) === sz && 'on')}>
                      {sz}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Đầu vào */}
          {!isText && (
            <div className="mt-5">
              <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium text-mist-200">
                <ArrowDownToLine size={13} className="text-brand-400" /> Đầu vào nối vào nút này ({inputs.length})
              </p>
              {inputs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-mist-400">
                  Chưa có đầu vào. Kéo chấm tròn từ một nút văn bản hoặc nút ảnh vào nút này để thêm
                  {isVideo ? ' ảnh tham chiếu và câu lệnh.' : ' câu lệnh.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {inputs.map((n) => (
                    <div key={n.id} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2">
                      {n.type === 'image' && n.mediaUrl ? (
                        <img src={n.mediaUrl} alt="" className="h-9 w-12 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="grid h-9 w-12 shrink-0 place-items-center rounded-lg bg-ink-800">
                          {n.type === 'text' ? <Type size={14} className="text-brand-400" /> : <Video size={14} className="text-brand-400" />}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-mist-100">{n.label || (n.type === 'text' ? 'Văn bản' : n.type === 'image' ? 'Hình ảnh' : 'Video')}</p>
                        <p className="truncate text-[11px] text-mist-400">
                          {n.type === 'text' ? (n.text || 'Chưa có nội dung') : n.mediaUrl ? 'Đã có ảnh' : 'Chưa có ảnh'}
                        </p>
                      </div>
                      <button
                        onClick={() => onRemoveLink(n.id)}
                        title="Gỡ kết nối này"
                        className="shrink-0 rounded-lg p-1.5 text-mist-400 hover:bg-white/5 hover:text-rose-400"
                      >
                        <Unlink size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Kết nối ra */}
          {outputs.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[11.5px] font-medium text-mist-200">Kết nối tới ({outputs.length})</p>
              <div className="space-y-2">
                {outputs.map((n) => (
                  <div key={n.id} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                    <span className="text-[12px] text-mist-200">
                      {n.type === 'text' ? 'Văn bản' : n.type === 'image' ? 'Hình ảnh' : 'Video'} · {n.label || ''}
                    </span>
                    <button
                      onClick={() => onRemoveLink(n.id)}
                      title="Gỡ kết nối này"
                      className="ml-auto rounded-lg p-1 text-mist-400 hover:text-rose-400"
                    >
                      <Unlink size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chân: tạo / tải lên / xóa */}
        <div className="border-t border-[#1e2432] p-3">
          {!isText && (
            <div className="flex gap-2">
              {isImage && (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || running}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.08] text-[13px] text-mist-200 transition hover:border-white/20 hover:text-white disabled:opacity-50"
                >
                  {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Tải ảnh lên
                </button>
              )}
              <button
                onClick={onGenerate}
                disabled={busy || running}
                className="mint-btn flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-[14px] font-semibold disabled:opacity-50"
              >
                {busy || running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {isImage ? 'Tạo ảnh' : 'Tạo video'} · {cost} điểm
              </button>
            </div>
          )}
          <button
            onClick={onDelete}
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-rose-500/30 text-[12.5px] text-rose-300 transition hover:bg-rose-500/10"
          >
            <Trash2 size={13} /> Xóa nút này
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickFile(e.target.files)} />
        </div>
      </aside>
    </>
  );
}
