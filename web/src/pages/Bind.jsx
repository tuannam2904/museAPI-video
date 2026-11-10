import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sparkles, CheckCircle2, AlertTriangle, Loader2, Copy, ArrowRight, Puzzle } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, useToast, Spinner } from '../components/ui.jsx';

/**
 * 绑定页：/bind/<code>
 *
 * 两种进入方式：
 *  1. 已装扩展：content.js 自动读取 muse.ai cookie 并提交，页面只需轮询状态。
 *  2. 没装扩展：页面提示安装，并保留「粘贴 Cookie」兜底入口。
 */
export default function Bind() {
  const { code } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [status, setStatus] = useState('waiting'); // waiting | done | error | expired | missing
  const [message, setMessage] = useState('');
  const [extDetected, setExtDetected] = useState(false);
  const [account, setAccount] = useState(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  // 监听扩展回传的结果
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== location.origin) return;
      const d = e.data;
      if (!d || d.source !== 'museapi-video-ext') return;
      if (d.type === 'done') {
        setStatus('done');
        setMessage(d.warning || 'Liên kết thành công');
        setAccount({ label: d.label });
      } else if (d.type === 'error') {
        setStatus('error');
        setMessage(d.message || 'Liên kết thất bại');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 轮询绑定码状态（扩展直接 POST 后，服务端状态会变化）
  useEffect(() => {
    if (!code) return undefined;

    const checkExt = () => {
      if (document.documentElement.getAttribute('data-museapi-video-ext') === '1') setExtDetected(true);
    };
    const t = setTimeout(checkExt, 600);

    const poll = async () => {
      try {
        const out = await api.bindStatus(code);
        if (out.status === 'done') {
          setStatus('done');
          setMessage(out.message || 'Liên kết thành công');
          setAccount((a) => a || { label: out.label });
          return;
        }
        if (out.status === 'expired') {
          setStatus('expired');
          setMessage('Mã liên kết đã hết hạn, hãy quay lại nền tảng để tạo lại');
          return;
        }
      } catch (e) {
        if (e.status === 404) {
          setStatus('missing');
          setMessage('Mã liên kết không tồn tại, có thể liên kết đã sao chép thiếu');
        }
      }
      timer.current = setTimeout(poll, 2000);
    };
    poll();

    return () => {
      clearTimeout(t);
      clearTimeout(timer.current);
    };
  }, [code]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Sao chép thất bại, hãy chọn thủ công', 'error');
    }
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-ink-950 px-4 py-10">
      <div className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full bg-brand-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-96 w-96 rounded-full bg-violet-600/20 blur-[120px]" />

      <div className="relative w-full max-w-[440px] fade-in">
        <div className="mb-6 flex flex-col items-center gap-2.5">
          <div className="grid h-12 w-12 place-items-center rounded-2xl brand-gradient shadow-xl shadow-brand-600/30">
            <Sparkles size={22} className="text-white" />
          </div>
          <h1 className="text-[19px] font-semibold tracking-tight text-white">Liên kết tài khoản muse.ai</h1>
          <p className="text-[12.5px] text-mist-400">Tiện ích trình duyệt sẽ tự đọc trạng thái đăng nhập, không cần F12</p>
        </div>

        <div className="card p-6">
          {/* 绑定码 */}
          <div className="mb-4 rounded-xl bg-ink-900 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-mist-400">Mã liên kết</span>
              <button
                onClick={copyCode}
                className="flex items-center gap-1 text-[11.5px] text-brand-400 hover:text-brand-300"
              >
                <Copy size={11} /> {copied ? 'Đã sao chép' : 'Sao chép'}
              </button>
            </div>
            <p className="mt-1 break-all font-mono text-[13px] text-mist-200">{code}</p>
          </div>

          {/* 状态 */}
          <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
            {status === 'waiting' && (
              <div className="flex items-start gap-3">
                <Loader2 size={17} className="mt-0.5 shrink-0 animate-spin text-brand-400" />
                <div>
                  <p className="text-[13px] font-medium text-mist-200">
                    {extDetected ? 'Đã kết nối tiện ích, đang đọc trạng thái đăng nhập muse.ai…' : 'Đang chờ tiện ích trình duyệt…'}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-mist-400">
                    {extDetected
                      ? 'Nếu cứ dừng ở đây, nhiều khả năng trình duyệt này chưa đăng nhập muse.ai. Hãy đăng nhập rồi làm mới trang.'
                      : 'Trang này cần tiện ích «MuseAPI-Video Liên kết» mới tự đọc được. Nếu chưa cài, xem hướng dẫn bên dưới.'}
                  </p>
                </div>
              </div>
            )}

            {status === 'done' && (
              <div className="flex items-start gap-3">
                <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-[13px] font-medium text-emerald-300">Liên kết thành công</p>
                  {account?.label && (
                    <p className="mt-1 text-[11.5px] text-mist-400">Tài khoản: {account.label}</p>
                  )}
                  {message && <p className="mt-1 text-[11.5px] text-mist-400">{message}</p>}
                  <Button size="sm" className="mt-3" onClick={() => nav('/accounts')}>
                    Đến quản lý tài khoản <ArrowRight size={13} />
                  </Button>
                </div>
              </div>
            )}

            {(status === 'error' || status === 'expired' || status === 'missing') && (
              <div className="flex items-start gap-3">
                <AlertTriangle size={17} className="mt-0.5 shrink-0 text-rose-400" />
                <div>
                  <p className="text-[13px] font-medium text-rose-300">
                    {status === 'expired' ? 'Mã liên kết đã hết hạn' : status === 'missing' ? 'Mã liên kết không hợp lệ' : 'Liên kết thất bại'}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-mist-400">{message}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => nav('/accounts')}>
                    Quay lại quản lý tài khoản để thử lại
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 没装扩展时的说明 */}
          {!extDetected && status === 'waiting' && (
            <div className="mt-4 rounded-xl border border-ink-700 p-3.5">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-mist-200">
                <Puzzle size={13} className="text-brand-400" /> Chưa cài tiện ích?
              </p>
              <ol className="mt-2 space-y-1 pl-4 text-[11.5px] leading-relaxed text-mist-400" style={{ listStyle: 'decimal' }}>
                <li>Tải gói tiện ích và giải nén</li>
                <li>Mở <code className="rounded bg-ink-700 px-1">chrome://extensions</code> trên Chrome, bật «Chế độ nhà phát triển» ở góc phải phía trên</li>
                <li>Bấm «Tải tiện ích đã giải nén», chọn thư mục vừa giải nén</li>
                <li>Quay lại trang này và làm mới, tiện ích sẽ tự hoàn tất liên kết</li>
              </ol>
              <a href="/download/museapi-video-extension.zip" download>
                <Button size="sm" variant="soft" className="mt-3 w-full">Tải gói tiện ích</Button>
              </a>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-500">
          Tiện ích chỉ đọc Cookie của muse.ai và gửi lên nền tảng này, không tải lên bên thứ ba nào
        </p>
      </div>
    </div>
  );
}
