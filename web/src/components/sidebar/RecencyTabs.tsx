type Period = '24h' | '7d' | '30d';

export function RecencyTabs({
  value,
  onChange,
}: {
  value?: Period;
  onChange: (p: Period | undefined) => void;
}) {
  const opts: { v: Period; label: string }[] = [
    { v: '24h', label: '24 小時' },
    { v: '7d', label: '7 天' },
    { v: '30d', label: '30 天' },
  ];
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">時間範圍</h3>
      <div className="grid grid-cols-4 gap-1">
        <button
          onClick={() => onChange(undefined)}
          className={`rounded-md border px-2 py-1 text-xs ${
            !value
              ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
              : 'border-slate-300 dark:border-slate-700'
          }`}
        >
          全部
        </button>
        {opts.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            data-testid={`recency-${o.v}`}
            className={`rounded-md border px-2 py-1 text-xs ${
              value === o.v
                ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                : 'border-slate-300 dark:border-slate-700'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
