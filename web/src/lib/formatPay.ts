import type { Pay } from '../types';

const periodLabel: Record<string, string> = {
  monthly: '月',
  hourly: '時',
  daily: '日',
  per_case: '案',
};

export function formatPay(p: Pay): string {
  if (!p) return '面議';
  const period = periodLabel[p.period || 'monthly'] || '月';
  if (p.min && p.max) {
    return `${prettyAmount(p.min)}–${prettyAmount(p.max)} / ${period}`;
  }
  if (p.min) return `≥ ${prettyAmount(p.min)} / ${period}`;
  if (p.max) return `≤ ${prettyAmount(p.max)} / ${period}`;
  return p.raw || '面議';
}

function prettyAmount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}萬`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}
