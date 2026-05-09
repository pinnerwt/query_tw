import { useConfigStore } from '../state/configStore';
import { getStoredTheme, setStoredTheme } from '../theme';
import { QrExport } from '../components/config/QrExport';
import { QrImport } from '../components/config/QrImport';
import { useState } from 'react';

export function Settings() {
  const reset = useConfigStore((s) => s.reset);
  const c = useConfigStore((s) => s.config);
  const [theme, setTheme] = useState(getStoredTheme());

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">設定</h1>
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">主題</h2>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              className={theme === t ? 'btn-primary' : 'btn-ghost'}
              onClick={() => {
                setStoredTheme(t);
                setTheme(t);
              }}
            >
              {t === 'light' ? '淺色' : t === 'dark' ? '深色' : '跟隨系統'}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">
          匯出 Profiles (QR)
        </h2>
        <p className="mb-2 text-xs text-slate-500">
          將你的 {c.profiles.length} 個 profile 與 {c.favorites.length} 個收藏轉成 QR Code。
        </p>
        <QrExport />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">
          掃描匯入 Profiles (QR)
        </h2>
        <QrImport />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">資料</h2>
        <button
          className="btn-ghost text-red-700"
          onClick={() => {
            if (confirm('將清除所有本地資料（profiles、收藏）。確定？')) {
              reset();
              alert('已重設');
            }
          }}
        >
          清除全部本地資料
        </button>
      </section>
    </div>
  );
}
