import { Link } from 'react-router-dom';
import { useConfigStore } from '../../state/configStore';
import { useSeenStore } from '../../state/seenStore';
import type { JobView } from '../../types';
import { formatPay } from '../../lib/formatPay';
import { fromNow } from '../../lib/datetime';

export function JobCard({ job }: { job: JobView }) {
  const isFav = useConfigStore((s) => s.config.favorites.includes(job.id));
  const toggleFav = useConfigStore((s) => s.toggleFavorite);
  const seen = useSeenStore((s) => s.seen.includes(job.id));

  const skills = job.requirements.skills.slice(0, 3);
  return (
    <article
      data-testid="job-card"
      className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${
        seen ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link to={`/job/${job.id}`} className="block">
            <h3 className="truncate text-base font-semibold">
              {job.title}
              {seen && <span className="ml-2 chip">已看</span>}
            </h3>
          </Link>
          <p className="mt-0.5 text-xs text-slate-500">
            {job.company || job.author.name || job.author.handle} ·{' '}
            {[job.location.city, job.location.district].filter(Boolean).join(' ')}
            {job.location.remote && ' · 遠端'}
          </p>
        </div>
        <button
          aria-label={isFav ? '取消收藏' : '收藏'}
          onClick={() => toggleFav(job.id)}
          className={`text-xl transition ${isFav ? 'text-yellow-500' : 'text-slate-300 hover:text-yellow-500'}`}
          data-testid="fav-button"
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
          {formatPay(job.pay)}
        </span>
        {skills.map((s) => (
          <span key={s.name} className="chip">
            {s.name}
            {s.years_min ? ` ≥${s.years_min}年` : ''}
          </span>
        ))}
        <span className="ml-auto text-slate-400">{fromNow(job.posted_at)}</span>
      </div>
    </article>
  );
}
