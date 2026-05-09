import { useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { decodePayload } from '../../lib/qrPayload';
import { useConfigStore } from '../../state/configStore';
import type { Config } from '../../types';

export function QrImport() {
  const importConfig = useConfigStore((s) => s.importConfig);
  const c = useConfigStore((s) => s.config);
  const [status, setStatus] = useState<string>('');
  const [pending, setPending] = useState<Config | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const start = async () => {
    setStatus('啟動相機中…');
    try {
      const reader = new BrowserMultiFormatReader();
      const video = videoRef.current!;
      const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
        if (result) {
          stopRef.current?.();
          handlePayload(result.getText());
        }
      });
      stopRef.current = () => controls.stop();
      setStatus('掃描中…請對準 QR Code');
    } catch (e) {
      setStatus('無法啟動相機：' + (e as Error).message);
    }
  };

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setStatus('已停止');
  };

  const handlePayload = (text: string) => {
    try {
      const parsed = decodePayload(text);
      setPending(parsed);
      setStatus(`偵測到配置：${parsed.profiles.length} 個 profile, ${parsed.favorites.length} 個收藏`);
    } catch (e) {
      setStatus('解析失敗：' + (e as Error).message);
    }
  };

  const handleManual = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => handlePayload(t.trim()));
  };

  const apply = () => {
    if (!pending) return;
    if (
      !confirm(
        `確認以匯入的 ${pending.profiles.length} 個 profile + ${pending.favorites.length} 個收藏覆蓋目前的 ${c.profiles.length} 個 profile + ${c.favorites.length} 個收藏？`
      )
    )
      return;
    importConfig(pending);
    setPending(null);
    setStatus('已匯入');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost text-sm" onClick={start}>
          開始掃描
        </button>
        <button className="btn-ghost text-sm" onClick={stop}>
          停止
        </button>
        <label className="btn-ghost cursor-pointer text-sm">
          匯入檔案
          <input type="file" accept=".txt,text/plain" hidden onChange={handleManual} />
        </label>
      </div>
      <video
        ref={videoRef}
        className="w-full max-w-sm rounded-md bg-slate-900"
        muted
        playsInline
      />
      <div className="text-xs text-slate-500">{status}</div>
      {pending && (
        <button className="btn-primary text-sm" onClick={apply}>
          套用匯入
        </button>
      )}
    </div>
  );
}
