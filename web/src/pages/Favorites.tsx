import { useQueries } from '@tanstack/react-query';
import { useConfigStore } from '../state/configStore';
import { api } from '../api/client';
import type { JobView } from '../types';
import { JobCard } from '../components/jobs/JobCard';

export function Favorites() {
  const favorites = useConfigStore((s) => s.config.favorites);

  const queries = useQueries({
    queries: favorites.map((id) => ({
      queryKey: ['job', id],
      queryFn: () => api<JobView>(`/api/jobs/${id}`),
    })),
  });

  const loaded = queries.filter((q) => q.data).map((q) => q.data as JobView);
  const missing = queries.filter((q) => q.isError).length;
  const loading = queries.some((q) => q.isLoading);

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">收藏</h1>
      {favorites.length === 0 ? (
        <p data-testid="favorites-empty" className="text-sm text-slate-500">
          尚未收藏任何職缺。在列表或詳情頁點擊 ☆ 即可加入收藏。
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {favorites.length} 個收藏{loading ? '，載入中…' : ''}
            {missing ? `（${missing} 個無法載入，可能已下架）` : ''}
          </p>
          <ul className="space-y-2">
            {loaded.map((j) => (
              <li key={j.id}>
                <JobCard job={j} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
