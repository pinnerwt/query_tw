import { useEffect, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useJobsInfinite } from '../api/jobs';
import { useActiveProfile } from '../state/configStore';
import { Sidebar } from '../components/sidebar/Sidebar';
import { JobCard } from '../components/jobs/JobCard';
import { encodeFilters } from '../lib/filtersWire';
import { useSearchParams } from 'react-router-dom';
import { useAnnouncements } from '../api/announcements';
import { useDismissedStore } from '../state/dismissedStore';
import { AnnouncementCard } from '../components/AnnouncementCard';
import { AdCard, AD_EVERY, AD_ENABLED } from '../components/AdCard';
import type { JobView } from '../types';

export function Browse() {
  const profile = useActiveProfile();
  const filters = profile.filters;
  const [params, setParams] = useSearchParams();

  // Sync filters → URL ?f=
  useEffect(() => {
    const enc = encodeFilters(filters);
    const cur = params.get('f') || '';
    if (cur !== enc) {
      const np = new URLSearchParams(params);
      if (enc) np.set('f', enc);
      else np.delete('f');
      setParams(np, { replace: true });
    }
  }, [filters]);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });

  const { data, fetchNextPage, hasNextPage, isFetching, error } = useJobsInfinite(filters);
  const jobs = data?.pages.flatMap((p) => p.jobs) || [];

  const { data: annData } = useAnnouncements();
  const dismissedIds = useDismissedStore((s) => s.ids);
  const announcements = (annData?.items ?? []).filter((a) => !dismissedIds.includes(a.id));

  type FeedItem = { type: 'job'; job: JobView } | { type: 'ad'; key: string };
  const feed: FeedItem[] = AD_ENABLED
    ? jobs.flatMap((j, i): FeedItem[] => {
        const items: FeedItem[] = [{ type: 'job', job: j }];
        if ((i + 1) % AD_EVERY === 0) items.push({ type: 'ad', key: `ad-${i}` });
        return items;
      })
    : jobs.map((j): FeedItem => ({ type: 'job', job: j }));

  return (
    <div className="mx-auto flex max-w-6xl">
      <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />
      <div className="min-h-[calc(100vh-3.5rem)] flex-1">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white/60 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <button
            className="btn-ghost"
            onClick={() => setSidebarOpen((v) => !v)}
            data-testid="toggle-sidebar"
            aria-expanded={sidebarOpen}
            aria-label="切換篩選列"
          >
            <span className="mr-1">☰</span>
            篩選
          </button>
          <div className="text-xs text-slate-500" data-testid="result-count">
            {data ? `${jobs.length} 筆結果${hasNextPage ? '+' : ''}` : '載入中…'}
          </div>
        </div>

        {error && (
          <div className="m-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
            載入失敗：{(error as Error).message}
          </div>
        )}

        <div className="h-[calc(100vh-7rem)]">
          {jobs.length === 0 && announcements.length === 0 && !isFetching ? (
            <div className="p-8 text-center text-sm text-slate-500" data-testid="empty">
              沒有符合條件的職缺
            </div>
          ) : (
            <Virtuoso
              data={feed}
              data-testid="job-list"
              endReached={() => hasNextPage && fetchNextPage()}
              increaseViewportBy={{ top: 0, bottom: 600 }}
              itemContent={(_, item) => (
                <div className="px-3 py-2">
                  {item.type === 'job' ? <JobCard job={item.job} /> : <AdCard />}
                </div>
              )}
              components={{
                Header: () =>
                  announcements.length > 0 ? (
                    <div className="space-y-2 px-3 pt-3">
                      {announcements.map((a) => (
                        <AnnouncementCard key={a.id} a={a} />
                      ))}
                    </div>
                  ) : null,
                Footer: () =>
                  isFetching ? (
                    <div className="p-4 text-center text-xs text-slate-500">載入更多…</div>
                  ) : null,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
