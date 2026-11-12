import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const IMAGE_MODELS = [
  { name: 'muse-image', id: 'muse-image', tiers: [{ label: 'Chuẩn', price: 5 }] },
];

export default function Pricing() {
  const [meta, setMeta] = useState(null);
  const [tab, setTab] = useState('video');

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);

  const p = meta?.price || { videoBase: 10, videoPerSecond: 2, image: 5 };
  const durations = meta?.durations || [5, 6, 8, 10];

  const videoRows = durations.map((d) => ({
    model: 'Muse Video',
    id: 'muse-video',
    tier: `${d} giây`,
    price: p.videoBase + p.videoPerSecond * d,
  }));

  const rows = tab === 'video' ? videoRows : IMAGE_MODELS.flatMap((m) =>
    m.tiers.map((t) => ({ model: 'Muse Image', id: m.id, tier: t.label, price: t.price }))
  );

  return (
    <div className="mx-auto max-w-[1180px] px-8 pb-20 pt-6">
      <h1 className="text-[26px] font-semibold tracking-tight text-white">Bảng giá</h1>
      <p className="mt-1.5 text-[12.5px] text-mist-400">Chỉ hiển thị các mô hình đã ra mắt và đang bật, quy đổi 1 tệ = 10 điểm.</p>

      <div className="mt-6 flex items-center gap-3">
        <h2 className="text-[15px] font-semibold text-mist-100">
          {tab === 'video' ? 'Video' : 'Ảnh'}
        </h2>
        <span className="text-[11.5px] text-mist-400">{rows.length} mức giá</span>
        <div className="ml-2 flex gap-1 rounded-full border border-[#1e2432] p-0.5">
          {[['video', 'Video'], ['image', 'Ảnh']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={
                'rounded-full px-3 py-1 text-[11.5px] transition ' +
                (tab === k ? 'bg-[#182030] text-white' : 'text-mist-400 hover:text-mist-200')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[11.5px] text-mist-400">
        Giá theo giờ cao điểm/thấp điểm: giờ làm việc theo giờ Bắc Kinh 09:00–12:00, 14:00–18:00 là giờ cao điểm, các khung giờ còn lại và cuối tuần là giờ thấp điểm.
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-[#1a2030]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#1a2030] text-[11px] text-mist-400">
              <th className="px-4 py-2.5 font-normal">Mô hình</th>
              <th className="px-4 py-2.5 font-normal">Mức giá</th>
              <th className="px-4 py-2.5 text-right font-normal">Giá</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141922]">
            {rows.map((r, i) => (
              <tr key={i} className="transition hover:bg-[#0e131c]">
                <td className="px-4 py-3">
                  <span className="text-[12.5px] text-mist-200">{r.model}</span>
                  <span className="ml-2 font-mono text-[11px] text-mist-400">{r.id}</span>
                </td>
                <td className="px-4 py-3 text-[12px] text-mist-300">{r.tier}</td>
                <td className="px-4 py-3 text-right font-mono text-[12.5px] text-mist-100">
                  {r.price} điểm
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-mist-400">
        Video tiêu hao = giá cơ bản {p.videoBase} + mỗi giây {p.videoPerSecond} điểm × thời lượng; tác vụ thất bại sẽ tự động hoàn điểm.
        Giá thực tế theo cấu hình hệ thống.
      </p>
    </div>
  );
}
