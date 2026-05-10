import type { Filters } from '../types';

// Encode filters as base64url-encoded JSON for URL params and API requests.
// Mirrors the Go filters.Decode contract on the backend.
export function encodeFilters(f: Filters): string {
  const json = JSON.stringify(stripDefaults(f));
  return base64UrlEncode(new TextEncoder().encode(json));
}

export function decodeFilters(s: string): Filters | null {
  if (!s) return null;
  try {
    const bytes = base64UrlDecode(s);
    return JSON.parse(new TextDecoder().decode(bytes)) as Filters;
  } catch {
    return null;
  }
}

function stripDefaults(f: Filters): Filters {
  const out: any = { hide_spam: f.hide_spam };
  if (f.cities?.length) out.cities = f.cities;
  if (f.categories?.length) out.categories = f.categories;
  if (f.remote_ok) out.remote_ok = true;
  if (f.pay_min) out.pay_min = f.pay_min;
  if (f.pay_max) out.pay_max = f.pay_max;
  if (f.pay_period) out.pay_period = f.pay_period;
  if (f.period) out.period = f.period;
  if (f.job_types?.length) out.job_types = f.job_types;
  if (f.keyword) out.keyword = f.keyword;
  if (f.skills?.length) out.skills = f.skills;
  if (f.experience?.length) out.experience = f.experience;
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
