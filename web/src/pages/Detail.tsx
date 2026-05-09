import { Link, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useJob } from '../api/jobs';
import { formatLocal } from '../lib/datetime';
import { useConfigStore } from '../state/configStore';
import { useSeenStore } from '../state/seenStore';
import { formatPay } from '../lib/formatPay';

export function Detail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useJob(id);
  const isFav = useConfigStore((s) => (id ? s.config.favorites.includes(id) : false));
  const toggleFav = useConfigStore((s) => s.toggleFavorite);
  const markSeen = useSeenStore((s) => s.markSeen);

  useEffect(() => {
    if (id) markSeen(id);
  }, [id, markSeen]);

  if (isLoading)
    return <div className="mx-auto max-w-3xl p-6 text-sm text-slate-500">載入中…</div>;
  if (error)
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-red-700">
        載入失敗：{(error as Error).message}
      </div>
    );
  if (!data) return null;

  const j = data;
  return (
    <article className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Link to="/" className="btn-ghost text-xs">
        ← 返回列表
      </Link>
      <header>
        <h1 className="text-2xl font-bold">{j.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {j.company || j.author.name || j.author.handle} ·{' '}
          {[j.location.city, j.location.district].filter(Boolean).join(' ')}
          {j.location.remote && ' · 遠端'}
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
          {formatPay(j.pay)}
        </span>
        <span className="chip">{jobTypeLabel(j.job_type)}</span>
        <span className="chip">{formatLocal(j.posted_at)}</span>
        <button
          onClick={() => id && toggleFav(id)}
          className={`btn-ghost text-sm ${isFav ? 'text-yellow-600' : ''}`}
        >
          {isFav ? '★ 已收藏' : '☆ 收藏'}
        </button>
        <a
          href={j.source_url}
          target="_blank"
          rel="noreferrer"
          className="btn-primary ml-auto text-sm"
        >
          在 Threads 開啟
        </a>
      </div>
      {j.requirements.skills.length > 0 && (
        <Section title="技能要求">
          <ul className="flex flex-wrap gap-1.5">
            {j.requirements.skills.map((s) => (
              <li key={s.name} className="chip">
                {s.name}
                {s.years_min ? ` ≥${s.years_min}年` : ''}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {j.requirements.experience.length > 0 && (
        <Section title="經歷要求">
          <ul className="flex flex-wrap gap-1.5">
            {j.requirements.experience.map((r) => (
              <li key={r.role} className="chip">
                {r.role}
                {r.years_min ? ` ≥${r.years_min}年` : ''}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {j.requirements.languages.length > 0 && (
        <Section title="語言">
          <ul className="flex flex-wrap gap-1.5">
            {j.requirements.languages.map((l) => (
              <li key={l.name} className="chip">
                {l.name}
                {l.level ? ` ${l.level}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {j.tags.length > 0 && (
        <Section title="標籤">
          <ul className="flex flex-wrap gap-1.5">
            {j.tags.map((t) => (
              <li key={t} className="chip">
                {t}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {j.raw_excerpt && (
        <Section title="原文摘要">
          <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
            {j.raw_excerpt}
          </p>
        </Section>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function jobTypeLabel(t: string): string {
  switch (t) {
    case 'full_time':
      return '正職';
    case 'part_time':
      return '兼職';
    case 'freelance':
      return '接案';
    case 'intern':
      return '實習';
    case 'contract':
      return '約聘';
  }
  return t;
}
