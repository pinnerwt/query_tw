import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatLocal } from '../lib/datetime';
import { AnnouncementCard } from '../components/AnnouncementCard';
import type { Announcement, AnnouncementSeverity } from '../types';

type DictItem = { id: number; canonical: string; aliases: string[] };
type Extraction = {
  post_id: string;
  url: string;
  author_handle: string;
  fetched_at: string;
  posted_at: string;
  job_count: number;
  spam_score?: number;
  extraction_failed: boolean;
};
type Report = { date: string; payload: any };

const AUTH_KEY = 'cuizhao.admin.auth.v1';

function getAuth(): string | null {
  return sessionStorage.getItem(AUTH_KEY);
}
function setAuth(v: string | null) {
  if (v) sessionStorage.setItem(AUTH_KEY, v);
  else sessionStorage.removeItem(AUTH_KEY);
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = getAuth();
  const r = await fetch(`/admin/api${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(auth ? { Authorization: `Basic ${auth}` } : {}),
      'Content-Type': 'application/json',
    },
  });
  if (r.status === 401) {
    setAuth(null);
    throw new Error('UNAUTHORIZED');
  }
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  if (r.status === 204) return undefined as T;
  return r.json();
}

export function Admin() {
  const [authed, setAuthed] = useState(!!getAuth());
  const [tab, setTab] = useState<'skills' | 'roles' | 'extractions' | 'reports' | 'announcements'>('skills');

  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin</h1>
        <button
          className="btn-ghost text-xs"
          onClick={() => {
            setAuth(null);
            setAuthed(false);
          }}
        >
          登出
        </button>
      </div>
      <nav className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
        {(
          [
            ['skills', 'Skills 待審'],
            ['roles', 'Roles 待審'],
            ['extractions', 'Extractions'],
            ['reports', '每日報告'],
            ['announcements', '公告'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm ${tab === k ? 'border-b-2 border-slate-900 dark:border-slate-100 font-semibold' : 'text-slate-500'}`}
          >
            {l}
          </button>
        ))}
      </nav>
      {tab === 'skills' && <PendingDict resource="skills" />}
      {tab === 'roles' && <PendingDict resource="roles" />}
      {tab === 'extractions' && <Extractions />}
      {tab === 'reports' && <Reports />}
      {tab === 'announcements' && <AnnouncementsAdmin />}
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  return (
    <form
      className="mx-auto max-w-sm space-y-3 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const enc = btoa(`${user}:${pass}`);
        setAuth(enc);
        try {
          await adminFetch('/whoami');
          onLogin();
        } catch {
          setErr('帳號或密碼錯誤');
          setAuth(null);
        }
      }}
    >
      <h1 className="text-2xl font-bold">Admin login</h1>
      <input className="input" placeholder="user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
      <input className="input" type="password" placeholder="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
      {err && <p className="text-sm text-red-700">{err}</p>}
      <button className="btn-primary w-full" type="submit">登入</button>
      <p className="text-xs text-slate-500">由 ADMIN_BASIC_AUTH 設定，預設 admin:changeme。</p>
    </form>
  );
}

function PendingDict({ resource }: { resource: 'skills' | 'roles' }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const queryKey = ['admin', resource, 'pending'] as const;
  const { data, error } = useQuery({
    queryKey,
    queryFn: () => adminFetch<{ items: DictItem[] }>(`/${resource}/pending`),
  });
  const items = data?.items;

  const ids = useMemo(() => Array.from(selected), [selected]);
  const act = async (action: 'approve' | 'reject') => {
    if (ids.length === 0) return;
    if (action === 'reject' && !confirm(`確定刪除 ${ids.length} 個 ${resource}？`)) return;
    await adminFetch(`/${resource}/${action}`, { method: 'POST', body: JSON.stringify({ ids }) });
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey });
  };

  if (error) return <p className="text-sm text-red-700">{(error as Error).message}</p>;
  if (!items) return <p className="text-sm text-slate-500">載入中…</p>;
  if (items.length === 0) return <p className="text-sm text-slate-500">沒有待審的 {resource}。</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span>已選 {selected.size}/{items.length}</span>
        <button className="btn-primary" disabled={!selected.size} onClick={() => act('approve')}>核准</button>
        <button className="btn-ghost text-red-700" disabled={!selected.size} onClick={() => act('reject')}>拒絕並刪除</button>
        <button
          className="btn-ghost ml-auto"
          onClick={() => setSelected(new Set(items.map((i) => i.id)))}
        >
          全選
        </button>
        <button className="btn-ghost" onClick={() => setSelected(new Set())}>清除選取</button>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {items.map((d) => (
          <li key={d.id} className="flex items-center gap-2 py-2 text-sm">
            <input
              type="checkbox"
              checked={selected.has(d.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(d.id);
                else next.delete(d.id);
                setSelected(next);
              }}
            />
            <span className="font-medium">{d.canonical}</span>
            {d.aliases.length > 0 && (
              <span className="text-xs text-slate-500">aliases: {d.aliases.join(', ')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Extractions() {
  const [items, setItems] = useState<Extraction[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [raw, setRaw] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch<{ items: Extraction[] }>('/extractions')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, []);

  const inspect = async (id: string) => {
    setOpen(id);
    setRaw(null);
    try {
      const r = await adminFetch<any>(`/posts/${id}/raw`);
      setRaw(r);
    } catch (e) {
      setRaw({ error: (e as Error).message });
    }
  };

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!items) return <p className="text-sm text-slate-500">載入中…</p>;
  if (items.length === 0) return <p className="text-sm text-slate-500">尚無 extraction。</p>;

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1">時間</th>
            <th>作者</th>
            <th>jobs</th>
            <th>spam</th>
            <th>狀態</th>
            <th></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {items.map((p) => (
            <tr key={p.post_id}>
              <td className="py-1 text-xs">{formatLocal(p.fetched_at)}</td>
              <td className="text-xs">{p.author_handle}</td>
              <td>{p.job_count}</td>
              <td className="text-xs">{p.spam_score?.toFixed(2) ?? '–'}</td>
              <td className="text-xs">{p.extraction_failed ? '失敗' : 'ok'}</td>
              <td className="text-right">
                <button className="btn-ghost text-xs" onClick={() => inspect(p.post_id)}>查看</button>
                <a className="btn-ghost text-xs" href={p.url} target="_blank" rel="noreferrer">原文</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono">{open}</span>
            <button className="btn-ghost text-xs" onClick={() => setOpen(null)}>關閉</button>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap">{raw ? JSON.stringify(raw, null, 2) : '載入中…'}</pre>
        </div>
      )}
    </div>
  );
}

function Reports() {
  const [items, setItems] = useState<Report[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    adminFetch<{ items: Report[] }>('/reports')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, []);
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!items) return <p className="text-sm text-slate-500">載入中…</p>;
  if (items.length === 0) return <p className="text-sm text-slate-500">尚無每日報告（cron 尚未跑過）。</p>;
  return (
    <ul className="space-y-3">
      {items.map((r) => (
        <li key={r.date} className="rounded-md border border-slate-200 p-3 text-xs dark:border-slate-800">
          <div className="font-semibold">{r.date}</div>
          <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(r.payload, null, 2)}</pre>
        </li>
      ))}
    </ul>
  );
}

function AnnouncementsAdmin() {
  const queryClient = useQueryClient();
  const queryKey = ['admin', 'announcements'] as const;
  const [severity, setSeverity] = useState<AnnouncementSeverity>('info');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data, error: queryError } = useQuery({
    queryKey,
    queryFn: () => adminFetch<{ items: Announcement[] }>('/announcements'),
  });
  const items = data?.items ?? null;
  const loadError = queryError ? (queryError as Error).message : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await adminFetch('/announcements', {
        method: 'POST',
        body: JSON.stringify({ severity, body }),
      });
      setBody('');
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('確定刪除這則公告？')) return;
    try {
      await adminFetch(`/announcements/${id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-sm">severity</label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as AnnouncementSeverity)}
            className="rounded border px-2 py-1 text-sm dark:bg-slate-800"
          >
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
        </div>
        <textarea
          className="block w-full rounded border p-2 text-sm dark:bg-slate-800"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="支援 markdown — **粗體**、[連結](https://…)"
        />
        {body.trim() && (
          <>
            <div className="text-xs text-slate-500">預覽：</div>
            <AnnouncementCard
              a={{
                id: -1,
                severity,
                body,
                created_at: new Date().toISOString(),
              }}
              dismissible={false}
            />
          </>
        )}
        {(error || loadError) && <p className="text-sm text-red-700">{error || loadError}</p>}
        <button type="submit" className="btn-primary" disabled={submitting || !body.trim()}>
          {submitting ? '送出中…' : '發布'}
        </button>
      </form>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">已發布</h2>
        {items === null && <p className="text-sm text-slate-500">載入中…</p>}
        {items?.length === 0 && <p className="text-sm text-slate-500">尚無公告。</p>}
        {items?.map((a) => (
          <div key={a.id} className="flex items-start gap-2">
            <div className="flex-1">
              <AnnouncementCard a={a} dismissible={false} />
            </div>
            <button
              className="btn-ghost text-red-700"
              onClick={() => remove(a.id)}
            >
              刪除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
