import { useRegisterSW } from 'virtual:pwa-register/react';

export function RefreshPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      if (r) {
        (window as unknown as { __swReg?: ServiceWorkerRegistration }).__swReg = r;
      }
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      data-testid="refresh-prompt"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-800"
    >
      <span className="text-sm">有新版本可用</span>
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => setNeedRefresh(false)}>稍後</button>
        <button className="btn-primary" onClick={() => updateServiceWorker(true)}>立即更新</button>
      </div>
    </div>
  );
}
