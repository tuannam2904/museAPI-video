import { useState } from 'react';
import { X, RotateCcw, Sliders, Dices, Save } from 'lucide-react';
import { clsx } from 'clsx';
import { useToast } from './ui.jsx';

const DEFAULTS = {
  stylize: 100,
  chaos: 0,
  weird: 0,
  iw: 1,
  cw: 0,
  sw: 0,
  seed: '',
  quality: 1,
};

export const PARAM_SPECS = [
  { key: 'stylize', label: 'Phong cách hóa Stylize', min: 0, max: 1000, step: 10, flag: '--st', hint: 'Giá trị càng cao càng «nghệ thuật», càng thấp càng sát câu lệnh' },
  { key: 'chaos', label: 'Độ hỗn loạn Chaos', min: 0, max: 100, step: 1, flag: '--chaos', hint: 'Càng cao bố cục càng phân tán' },
  { key: 'weird', label: 'Độ kỳ lạ Weird', min: 0, max: 3000, step: 50, flag: '--weird', hint: 'Đưa vào xu hướng thẩm mỹ khác thường' },
  { key: 'iw', label: 'Trọng số ảnh đệm IW', min: 0, max: 3, step: 0.1, flag: '--iw', hint: 'Mức ảnh hưởng của ảnh tham khảo lên kết quả' },
  { key: 'cw', label: 'Trọng số nhân vật CW', min: 0, max: 100, step: 1, flag: '--cw', hint: 'Độ nhất quán của nhân vật' },
  { key: 'sw', label: 'Trọng số phong cách SW', min: 0, max: 100, step: 1, flag: '--sw', hint: 'Độ ảnh hưởng của phong cách tham khảo' },
  { key: 'quality', label: 'Chất lượng Quality', min: 0.25, max: 2, step: 0.25, flag: '--q', hint: 'Mức chất lượng kết xuất' },
];

export function buildExtra(params) {
  const parts = [];
  for (const spec of PARAM_SPECS) {
    const v = params[spec.key];
    if (v === '' || v == null) continue;
    if (Number(v) === DEFAULTS[spec.key]) continue; // 与默认一致就不带
    parts.push(`${spec.flag} ${v}`);
  }
  if (params.seed !== '' && params.seed != null) parts.push(`--seed ${String(params.seed).replace(/\D/g, '')}`);
  return parts.length ? parts.join(' ') : null;
}

export default function ParamsPanel({ open, onClose, params, onChange }) {
  const toast = useToast();
  const [draft, setDraft] = useState(params || DEFAULTS);

  if (!open) return null;

  const set = (key) => (e) => {
    const raw = e.target.value;
    setDraft((d) => ({ ...d, [key]: raw === '' ? '' : Number(raw) }));
  };

  const reset = () => {
    setDraft({ ...DEFAULTS });
    toast('Đã khôi phục thông số mặc định', 'ok');
  };

  const randomSeed = () => {
    setDraft((d) => ({ ...d, seed: String(Math.floor(Math.random() * 4294967295)) }));
  };

  const apply = () => {
    onChange(draft);
    toast('Đã áp dụng thông số', 'ok');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-[#1e2432] bg-ink-850 shadow-2xl fade-in">
        <div className="flex items-center justify-between border-b border-[#1e2432] px-5 py-3.5">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-white">
            <Sliders size={15} className="text-brand-400" /> Điều chỉnh thông số
          </h3>
          <div className="flex items-center gap-1">
            <button onClick={reset} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-mist-400 hover:bg-ink-700 hover:text-white">
              <RotateCcw size={11} /> Khôi phục mặc định
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-700 hover:text-white">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
          {PARAM_SPECS.map((spec) => (
            <div key={spec.key}>
              <div className="mb-1 flex items-baseline justify-between">
                <label className="text-[12px] text-mist-200">{spec.label}</label>
                <span className="font-mono text-[11px] text-brand-300">
                  {draft[spec.key] === '' ? 'Mặc định' : draft[spec.key]}
                </span>
              </div>
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={draft[spec.key] === '' ? DEFAULTS[spec.key] : draft[spec.key]}
                onChange={set(spec.key)}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#232a38] accent-brand-500"
              />
              <p className="mt-1 text-[10px] text-ink-500">{spec.hint}</p>
            </div>
          ))}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] text-mist-200">Seed</label>
              <button onClick={randomSeed} className="flex items-center gap-1 text-[10.5px] text-brand-400 hover:text-brand-300">
                <Dices size={10} /> Ngẫu nhiên
              </button>
            </div>
            <input
              value={draft.seed}
              onChange={(e) => setDraft((d) => ({ ...d, seed: e.target.value.replace(/\D/g, '') }))}
              placeholder="Để trống để ngẫu nhiên"
              className="h-9 w-full rounded-lg border border-[#1e2432] bg-ink-900 px-3 font-mono text-[12px] text-mist-100 outline-none focus:border-brand-500/50"
            />
          </div>

          <div className="rounded-lg border border-[#1e2432] bg-ink-900/60 px-3 py-2">
            <p className="text-[10px] text-mist-400">
              Sẽ được gửi lên upstream dưới dạng thông số bổ sung:
              <span className="ml-1 font-mono text-brand-300">{buildExtra(draft) || '(Không có)'}</span>
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#1e2432] px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-[#232a38] px-4 py-1.5 text-[12px] text-mist-300">
            Hủy
          </button>
          <button onClick={apply} className="flex items-center gap-1.5 rounded-lg brand-gradient px-4 py-1.5 text-[12px] font-medium text-white">
            <Save size={12} /> Áp dụng
          </button>
        </div>
      </div>
    </div>
  );
}

export { DEFAULTS as PARAM_DEFAULTS };
