import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useConfigStore } from '../../state/configStore';
import { encodePayload } from '../../lib/qrPayload';

export function QrExport() {
  const config = useConfigStore((s) => s.config);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const payload = useMemo(() => encodePayload(config), [config]);
  const size = payload.length;
  const tooLarge = size > 2900;
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (tooLarge) return;
    const cv = canvasRef.current;
    if (!cv) return;
    let cancelled = false;
    QRCode.toCanvas(cv, payload, { errorCorrectionLevel: 'H', margin: 1, width: 256 })
      .then(() => {
        if (!cancelled) setRenderError(null);
      })
      .catch((e) => {
        if (!cancelled) setRenderError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [payload, tooLarge]);

  const error = tooLarge ? '資料過大，無法產生 QR；請改用檔案匯出' : renderError;

  const downloadFile = () => {
    const blob = new Blob([payload], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cuizhao-config.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-2">
      {error ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      ) : (
        <canvas ref={canvasRef} data-testid="qr-canvas" className="rounded-md bg-white p-2" />
      )}
      <p className={`text-xs ${size >= 2500 ? 'text-amber-600' : 'text-slate-500'}`}>
        資料大小：{size} 位元組{size >= 2500 ? '（接近上限）' : ''}
      </p>
      <button className="btn-ghost text-xs" onClick={downloadFile}>
        匯出為檔案
      </button>
    </div>
  );
}
