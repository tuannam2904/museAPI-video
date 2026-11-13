import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button } from './ui.jsx';

/**
 * Hộp thoại xác nhận dùng chung, thay cho confirm() gốc của trình duyệt.
 *
 * Lý do: Chrome có ô "Prevent this page from creating additional dialogs" —
 * người dùng tick một lần là mọi confirm() sau đó đều bị chặn ngầm (trả về
 * false ngay, không hiện gì), khiến nút Xóa không còn tác dụng. Hộp thoại
 * này tự vẽ trong app nên Chrome không chặn được.
 *
 * Cách dùng (giống confirm() nhưng bất đồng bộ):
 *   const confirmDialog = useConfirmDialog();
 *   if (!(await confirmDialog('Xóa tác phẩm này?', { dontAskKey: 'works-delete' }))) return;
 *
 * - dontAskKey: khi có, hiển thị ô "Không hỏi lại". Nếu localStorage đã có
 *   key này thì trả về true ngay mà không hiện hộp thoại. Chỉ lưu key khi
 *   người dùng tick ô rồi bấm xác nhận; bấm Hủy thì không lưu.
 * - Không truyền dontAskKey (vd: xác nhận đã nhận tiền) thì luôn hỏi.
 * - confirmLabel: nhãn nút xác nhận, mặc định "Xóa".
 */
const SKIP_PREFIX = 'xm_confirm_skip:';

const ConfirmCtx = createContext(null);

export function ConfirmDialogProvider({ children }) {
  const [state, setState] = useState(null);
  const [dontAsk, setDontAsk] = useState(false);
  const stateRef = useRef(null);
  const resolverRef = useRef(null);

  const setReq = (s) => {
    stateRef.current = s;
    setState(s);
  };

  const confirmDialog = useCallback((message, opts = {}) => {
    const dontAskKey = opts.dontAskKey || null;
    if (dontAskKey) {
      try {
        if (localStorage.getItem(SKIP_PREFIX + dontAskKey)) return Promise.resolve(true);
      } catch { /* localStorage không dùng được thì cứ hiện hộp thoại */ }
    }
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDontAsk(false);
      setReq({
        message,
        confirmLabel: opts.confirmLabel || 'Xóa',
        cancelLabel: opts.cancelLabel || 'Hủy',
        danger: opts.danger !== false,
        dontAskKey,
      });
    });
  }, []);

  const settle = useCallback((value, saveDontAsk) => {
    const s = stateRef.current;
    if (value && saveDontAsk && s?.dontAskKey) {
      try { localStorage.setItem(SKIP_PREFIX + s.dontAskKey, '1'); } catch { /* bỏ qua */ }
    }
    stateRef.current = null;
    setState(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (resolve) resolve(value);
  }, []);

  useEffect(() => {
    if (!state) return;
    const onKey = (e) => { if (e.key === 'Escape') settle(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, settle]);

  return (
    <ConfirmCtx.Provider value={confirmDialog}>
      {children}
      {state && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => settle(false)} />
          <div className="card relative w-full max-w-sm fade-in shadow-2xl">
            <div className="px-5 pb-4 pt-5">
              <p className="text-[15px] leading-relaxed text-mist-100">{state.message}</p>
              {state.dontAskKey && (
                <label className="mt-4 flex cursor-pointer select-none items-center gap-2 text-[13px] text-mist-300">
                  <input
                    type="checkbox"
                    checked={dontAsk}
                    onChange={(e) => setDontAsk(e.target.checked)}
                    className="h-4 w-4 accent-brand-500"
                  />
                  Không hỏi lại
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
              <Button variant="ghost" size="sm" onClick={() => settle(false)}>
                {state.cancelLabel}
              </Button>
              <Button variant={state.danger ? 'danger' : 'primary'} size="sm" onClick={() => settle(true, dontAsk)}>
                {state.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export const useConfirmDialog = () => useContext(ConfirmCtx);
