import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Heart, Play, ArrowUpRight, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';

/* 逆向自目标站首页的 AI 要闻（静态内容位，可在后台配置） */
const BRIEFING = [
  { tag: 'Mạch chip', text: 'Cơ Nguyên Luật Động phát hành NeoHorse-1.5-Flash Preview, mô hình Agent RSI bước vào vòng lặp thứ hai' },
  { tag: 'Mạch chip', text: 'CEO NVIDIA Jensen Huang lên tiếng xin lỗi, phía chính thức đã mở cuộc điều tra nội bộ khẩn cấp' },
  { tag: 'Nghiên cứu ngành', text: 'Phân tích ngành cho thấy AI trên thiết bị đầu cuối bước vào giai đoạn mới, từ ứng dụng đơn lẻ chuyển sang trải nghiệm tác nhân thông minh' },
  { tag: 'Tencent', text: 'Hunyuan của Tencent lọt vào nhóm mô hình mã nguồn mở hàng đầu, thực nghiệm Hy4 kết hợp WorkBuddy cho khả năng triển khai Agent đa phương thức vượt trội' },
  { tag: 'Alibaba', text: 'Alibaba phát hành Qwen Office 2.0, ra mắt Team Agent đầu tiên hỗ trợ nhiều người cộng tác cùng Agent' },
  { tag: 'Mercedes-Benz và BMW', text: 'Mercedes-Benz và BMW chính thức tuyên bố dừng phát triển lái tự động cấp L3, cho rằng trải nghiệm sử dụng không bằng hệ thống L2 hiện tại' },
  { tag: 'Ngành mã nguồn mở', text: 'AI có thể tái tạo hoàn chỉnh một công ty mã nguồn mở 80.000 Star, đảm nhiệm toàn bộ quy trình từ viết code, giao việc đến kiểm tra lỗi' },
  { tag: 'Cơ Nguyên Luật Động', text: 'Cơ Nguyên Luật Động phát hành NeoHorse-1.5-Flash Preview, mô hình Agent RSI bước vào vòng lặp thứ hai' },
];

export default function Home() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [works, setWorks] = useState([]);
  const [hero, setHero] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.jobs({ status: 'completed', pageSize: 9 })
      .then((out) => {
        setWorks(out.jobs || []);
        setHero((out.jobs || []).find((j) => j.mediaUrl) || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const today = new Date();
  const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div className="mx-auto max-w-[1320px] px-6 pb-16 pt-4">
      {/* ---------------- 上半：AI 要闻 + 实时渲染 ---------------- */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* AI 要闻 */}
        <section className="rounded-2xl border border-[#1a2030] bg-[#0c1017]/70 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-wide text-white">
              Tin tức AI
            </h2>
            <span className="font-mono text-[11px] tracking-wider text-mist-400">{dateStr}</span>
          </div>

          <div className="divide-y divide-[#161b26]">
            {BRIEFING.map((item, i) => (
              <div key={i} className="group flex items-center gap-3 py-[9px]">
                <span className="shrink-0 rounded-full border border-[#232a38] px-2 py-[3px] text-[10px] text-mist-300">
                  {item.tag}
                </span>
                <p className="truncate text-[12.5px] leading-relaxed text-mist-200 transition group-hover:text-white">
                  {item.text}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-center gap-2 border-t border-[#151a25] pt-3">
            <span className="h-1 w-1 rounded-full bg-brand-400 pulse-dot" />
            <span className="font-mono text-[9.5px] tracking-[0.28em] text-mist-400">
              LIVE · AI DAILY BRIEFING
            </span>
          </div>
        </section>

        {/* 实时渲染 */}
        <section className="glow-frame relative overflow-hidden rounded-2xl border border-brand-500/20 bg-[#070b12]">
          <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-black/50 px-2.5 py-1 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400 pulse-dot" />
            <span className="text-[10.5px] text-mist-200">Kết xuất trực tiếp</span>
            <span className="font-mono text-[10px] tracking-wider text-brand-300">GPU ONLINE</span>
          </div>

          <div className="relative aspect-[16/10] w-full">
            {hero?.mediaUrl ? (
              /\.(mp4|webm|mov)/i.test(hero.mediaUrl) ? (
                <video
                  src={hero.mediaUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : (
                <img src={hero.mediaUrl} alt="" className="h-full w-full object-cover" />
              )
            ) : (
              <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(120%_100%_at_50%_0%,#0f3a33_0%,#08131a_55%,#05080e_100%)]">
                {/* 无作品时的霓虹屏占位 */}
                <div className="absolute inset-x-[8%] top-[12%] h-[62%] rounded-[26px] border border-brand-400/40 shadow-[0_0_60px_-10px_rgba(79,227,193,.55),inset_0_0_40px_rgba(79,227,193,.12)]">
                  <div className="absolute inset-x-0 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent via-brand-300/90 to-transparent" />
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="text-center">
                      <p className="font-display text-[13px] tracking-[0.3em] text-brand-300/80">CINEMA</p>
                      <p className="mt-1 font-mono text-[10px] tracking-[0.24em] text-mist-400">
                        Một câu lệnh vút cao · LED bốn mùa toàn ảnh
                      </p>
                    </div>
                  </div>
                </div>
                {/* 人形剪影 */}
                <div className="absolute bottom-0 left-1/2 h-[46%] w-[16%] -translate-x-1/2 rounded-t-[40%] bg-black/80" />
              </div>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent" />

            <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
              <p className="font-mono text-[10px] tracking-[0.16em] text-white/55">
                SHOT 01 · Một câu lệnh vút cao · LED bốn mùa toàn ảnh
              </p>
              <div className="flex items-center gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={clsx(
                      'h-[3px] rounded-full transition-all',
                      i === 0 ? 'w-6 bg-brand-400' : 'w-4 bg-white/25'
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 backdrop-blur">
              <span className="text-[10px] text-brand-300">◆</span>
              <span className="text-[10.5px] text-white/80">CINEMA 4K · Tự động xoay bốn mùa</span>
            </div>
          </div>
        </section>
      </div>

      {/* ---------------- 作品广场 ---------------- */}
      <section className="mt-12">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-[30px] font-bold leading-none tracking-tight text-white">
            Quảng trường tác phẩm
          </h2>
          <div className="flex items-center gap-4">
            <span className="text-[12px] text-mist-400">
              Tổng <span className="font-mono text-mist-200">{works.length}</span> tác phẩm · Bấm ♥ để thích
            </span>
            <button
              onClick={() => nav('/create')}
              className="flex items-center gap-1.5 rounded-full border border-[#232a38] bg-ink-850 px-4 py-2 text-[12.5px] text-mist-200 transition hover:border-brand-500/50 hover:text-white"
            >
              <Upload size={13} /> Đăng tác phẩm
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="shimmer aspect-[4/5] rounded-2xl" />
            ))}
          </div>
        ) : works.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-[#1a2030] bg-[#0c1017]/50 py-20">
            <div className="text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-ink-800 text-brand-400">
                <Sparkles size={20} />
              </div>
              <p className="text-[14px] font-medium text-mist-200">Quảng trường vẫn trống</p>
              <p className="mt-1 text-[12.5px] text-mist-400">Tạo tác phẩm đầu tiên, nó sẽ xuất hiện tại đây</p>
              <button
                onClick={() => nav('/create')}
                className="mt-4 rounded-full brand-gradient px-5 py-2 text-[13px] font-medium text-white shadow-lg shadow-brand-600/25 transition hover:brightness-110"
              >
                Bắt đầu sáng tạo
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {works.map((w) => (
              <WorkTile key={w.id} job={w} onClick={() => nav('/works')} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function WorkTile({ job, onClick }) {
  const isVideo = /\.(mp4|webm|mov)/i.test(job.mediaUrl || '');
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-[#1a2030] bg-ink-800 text-left transition hover:border-[#2a3446]"
    >
      <div className="aspect-[4/5] w-full overflow-hidden bg-ink-900">
        {job.mediaUrl ? (
          isVideo ? (
            <video
              src={job.mediaUrl}
              muted
              loop
              playsInline
              onMouseEnter={(e) => e.currentTarget.play()}
              onMouseLeave={(e) => e.currentTarget.pause()}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <img
              src={job.mediaUrl}
              alt=""
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          )
        ) : (
          <div className="grid h-full place-items-center text-[12px] text-mist-400">Không có bản xem trước</div>
        )}

        {isVideo && (
          <span className="absolute left-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white backdrop-blur">
            <Play size={10} fill="currentColor" />
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-2 p-3">
        <p className="line-clamp-2 flex-1 text-[12.5px] leading-snug text-mist-300">{job.prompt}</p>
        <Heart size={13} className="mt-0.5 shrink-0 text-mist-400 transition group-hover:text-brand-400" />
      </div>
    </button>
  );
}
