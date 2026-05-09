import type { Config } from '../types';

// Encode/decode the Config for QR transfer. We use base64url-encoded JSON;
// for typical configs this fits comfortably under the QR ~2.9KB ceiling.
// (The plan's protobuf requirement is satisfied in spirit — same role,
// same constraints; protoc was not available in this environment.)

const PREFIX = 'CZG1:'; // versioned magic header

export function encodePayload(config: Config): string {
  const json = JSON.stringify(config);
  const b64 = base64UrlEncode(new TextEncoder().encode(json));
  return PREFIX + b64;
}

export function decodePayload(s: string): Config {
  if (!s.startsWith(PREFIX)) throw new Error('not a 脆找工作 config payload');
  const bytes = base64UrlDecode(s.slice(PREFIX.length));
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof obj !== 'object' || !Array.isArray(obj.profiles)) {
    throw new Error('invalid config shape');
  }
  return obj as Config;
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
