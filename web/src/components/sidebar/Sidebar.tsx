import { useEffect, useState } from 'react';
import { useConfigStore, useActiveProfile } from '../../state/configStore';
import { ProfileSelect } from './ProfileSelect';
import { CitiesPicker } from './CitiesPicker';
import { PayRange } from './PayRange';
import { RecencyTabs } from './RecencyTabs';
import { JobTypeChecks } from './JobTypeChecks';
import { KeywordSearch } from './KeywordSearch';
import { HideSpamToggle } from './HideSpamToggle';
import { SkillRows, ExperienceRows } from './SkillRows';

export function Sidebar({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const profile = useActiveProfile();
  const updateActive = useConfigStore((s) => s.updateActiveFilters);
  const isMobile = useIsMobile();

  // Mobile: bottom sheet. Desktop: collapsible left rail.
  if (isMobile) {
    if (!open) return null;
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
        <aside
          data-testid="sidebar"
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">篩選條件</h2>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              關閉
            </button>
          </div>
          <FilterBody />
        </aside>
      </>
    );
  }

  // Desktop
  return (
    <aside
      data-testid="sidebar"
      className={`shrink-0 border-r border-slate-200 bg-white transition-all dark:border-slate-800 dark:bg-slate-900 ${
        open ? 'w-72' : 'w-0 overflow-hidden'
      }`}
    >
      <div className={`p-4 ${open ? '' : 'hidden'}`}>
        <FilterBody />
      </div>
    </aside>
  );
}

function FilterBody() {
  const profile = useActiveProfile();
  const updateActive = useConfigStore((s) => s.updateActiveFilters);
  return (
    <div className="space-y-5">
      <ProfileSelect />
      <KeywordSearch
        value={profile.filters.keyword || ''}
        onChange={(keyword) => updateActive((f) => ({ ...f, keyword }))}
      />
      <RecencyTabs
        value={profile.filters.period}
        onChange={(period) => updateActive((f) => ({ ...f, period }))}
      />
      <CitiesPicker
        value={profile.filters.cities || []}
        remoteOk={!!profile.filters.remote_ok}
        onChange={(cities, remote_ok) => updateActive((f) => ({ ...f, cities, remote_ok }))}
      />
      <PayRange
        min={profile.filters.pay_min || 0}
        period={profile.filters.pay_period || 'monthly'}
        onChange={(pay_min, pay_period) => updateActive((f) => ({ ...f, pay_min, pay_period }))}
      />
      <JobTypeChecks
        value={profile.filters.job_types || []}
        onChange={(job_types) => updateActive((f) => ({ ...f, job_types }))}
      />
      <SkillRows />
      <ExperienceRows />
      <HideSpamToggle
        value={profile.filters.hide_spam}
        onChange={(hide_spam) => updateActive((f) => ({ ...f, hide_spam }))}
      />
      <button
        className="btn-ghost w-full"
        onClick={() => updateActive(() => ({ hide_spam: true }))}
      >
        清除篩選
      </button>
    </div>
  );
}

function useIsMobile() {
  const [m, setM] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = () => setM(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return m;
}
