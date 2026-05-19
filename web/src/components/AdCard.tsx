import { useEffect, useRef } from 'react';
import { CardShell } from './CardShell';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const CLIENT = (import.meta as any).env?.VITE_ADSENSE_CLIENT as string | undefined;
const SLOT = (import.meta as any).env?.VITE_ADSENSE_SLOT as string | undefined;
const TEST = (import.meta as any).env?.VITE_ADSENSE_TEST === '1';

export function AdCard() {
  const pushed = useRef(false);
  useEffect(() => {
    if (!CLIENT || !SLOT || pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {
      /* noop */
    }
  }, []);

  if (!CLIENT || !SLOT) return null;

  return (
    <CardShell testId="ad-card">
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={CLIENT}
        data-ad-slot={SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
        {...(TEST ? { 'data-adtest': 'on' } : {})}
      />
    </CardShell>
  );
}

const adEveryRaw = (import.meta as any).env?.VITE_AD_EVERY as string | undefined;
export const AD_EVERY = Number(adEveryRaw ?? 15) || 15;
export const AD_ENABLED = Boolean(CLIENT && SLOT);
