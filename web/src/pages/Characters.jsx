import { useEffect, useRef, useState } from 'react';
import { Users, Plus, Trash2, ImagePlus, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Empty, Field, Input, Textarea, useToast } from '../components/ui.jsx';
import { useConfirmDialog } from '../components/ConfirmDialog.jsx';

const CHAR_STORE_KEY = 'xm_characters';

const loadCharacters = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAR_STORE_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
};

export default function Characters() {
  const toast = useToast();
  const confirmDialog = useConfirmDialog();
  const [characters, setCharacters] = useState(loadCharacters);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(CHAR_STORE_KEY, JSON.stringify(characters));
  }, [characters]);

  // Đồng bộ nếu trang Video hàng loạt thay đổi nhân vật ở tab khác.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === CHAR_STORE_KEY) setCharacters(loadCharacters());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const onPickPhotos = async (files) => {
    if (!files?.length) return;
    if (photos.length + files.length > 3) return toast('Tối đa 3 ảnh mặt cho một nhân vật', 'error');
    setUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      setPhotos((r) => [...r, ...out.files].slice(0, 3));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const canSave = name.trim() !== '' && photos.length > 0;

  const saveCharacter = () => {
    if (!canSave) return;
    const c = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      note: note.trim(),
      photos,
      createdAt: Date.now(),
    };
    setCharacters((list) => [...list, c]);
    setName('');
    setNote('');
    setPhotos([]);
    toast('Đã lưu nhân vật', 'ok');
  };

  const deleteCharacter = async (c) => {
    if (!(await confirmDialog(`Xóa nhân vật "${c.name}"?`, { dontAskKey: 'characters-delete' }))) return;
    setCharacters((list) => list.filter((x) => x.id !== c.id));
    toast('Đã xóa nhân vật', 'ok');
  };

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-7 lg:px-9">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-[22px] font-semibold text-mist-100">
          <Users size={22} className="text-brand-300" /> Nhân vật
        </h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-mist-400">
          Lưu nhân vật với ảnh mặt để giữ đúng khuôn mặt trong nhiều video. Khi tên nhân vật
          xuất hiện trong prompt, ảnh mặt của nhân vật sẽ tự động được đính kèm làm tài liệu
          tham chiếu khi tạo ảnh và video.
        </p>
      </header>

      {/* Form tạo nhân vật */}
      <section className="card mb-6 p-5">
        <h2 className="mb-4 flex items-center gap-2 text-[15px] font-medium text-mist-100">
          <Plus size={16} className="text-brand-300" /> Thêm nhân vật mới
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <Field label="Tên nhân vật" hint="Tên này dùng để nhận ra nhân vật trong prompt">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: Mai, Anh Tuấn…"
              />
            </Field>
            <Field label="Mô tả (không bắt buộc)">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Mô tả ngoại hình, trang phục, tính cách…"
              />
            </Field>
          </div>
          <Field label="Ảnh mặt (1–3 ảnh)" hint="Ảnh rõ mặt, chính diện càng tốt">
            <div className="flex flex-wrap items-center gap-2">
              {photos.map((p) => (
                <div key={p.url} className="relative">
                  <img src={p.url} alt="" className="h-20 w-20 rounded-xl border border-white/10 object-cover" />
                  <button
                    onClick={() => setPhotos((l) => l.filter((x) => x.url !== p.url))}
                    title="Gỡ ảnh này"
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#161c2c] text-mist-300 ring-1 ring-white/15 transition hover:text-rose-400"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {photos.length < 3 && (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-white/[0.15] bg-[#0d111c] text-mist-300 transition hover:border-brand-400/50 hover:text-brand-300 disabled:opacity-50"
                >
                  <span className="flex flex-col items-center gap-1 text-[11px]">
                    <ImagePlus size={18} />
                    {uploading ? 'Đang tải…' : 'Thêm ảnh'}
                  </span>
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => onPickPhotos(e.target.files)}
            />
          </Field>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button onClick={saveCharacter} disabled={!canSave}>
            Lưu nhân vật
          </Button>
          {!canSave && (
            <p className="text-[12.5px] text-mist-400">
              Cần nhập tên và tải lên ít nhất 1 ảnh mặt.
            </p>
          )}
        </div>
      </section>

      {/* Danh sách nhân vật */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-medium text-mist-100">
            Đã lưu ({characters.length})
          </h2>
          <p className="text-[12.5px] text-mist-400">
            Nhân vật ở đây dùng chung với trang «Video hàng loạt» — tên nhân vật trong prompt
            sẽ tự động gắn ảnh mặt.
          </p>
        </div>

        {characters.length === 0 ? (
          <Empty
            icon={Users}
            title="Chưa có nhân vật nào"
            desc="Thêm tên và ảnh mặt ở form trên để dùng lại nhân vật cho nhiều video."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {characters.map((c) => (
              <article key={c.id} className="card card-hover flex flex-col p-4">
                <div className="mb-3 flex gap-2">
                  {c.photos.map((p) => (
                    <img
                      key={p.url}
                      src={p.url}
                      alt={c.name}
                      className="h-16 w-16 rounded-xl border border-white/10 object-cover"
                    />
                  ))}
                </div>
                <h3 className="text-[15px] font-medium text-mist-100">{c.name}</h3>
                {c.note && (
                  <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-mist-400">{c.note}</p>
                )}
                <div className="mt-auto flex items-center justify-between pt-3">
                  <span className="text-[12px] text-mist-400">{c.photos.length} ảnh mặt</span>
                  <button
                    onClick={() => deleteCharacter(c)}
                    title="Xóa nhân vật"
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-mist-400 transition hover:bg-white/5 hover:text-rose-400"
                  >
                    <Trash2 size={14} /> Xóa
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
