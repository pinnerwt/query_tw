import { useCities } from '../../api/jobs';

export function CitiesPicker({
  value,
  remoteOk,
  onChange,
}: {
  value: string[];
  remoteOk: boolean;
  onChange: (cities: string[], remote_ok: boolean) => void;
}) {
  const { data } = useCities();
  const cities = data?.cities || [];
  const toggle = (c: string) => {
    const next = value.includes(c) ? value.filter((x) => x !== c) : [...value, c];
    onChange(next, remoteOk);
  };
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">城市</h3>
      <div className="flex flex-wrap gap-1">
        {cities.map((c) => {
          const selected = value.includes(c);
          return (
            <button
              key={c}
              data-testid={`city-${c}`}
              onClick={() => toggle(c)}
              className={`rounded-md border px-2 py-1 text-xs ${
                selected
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                  : 'border-slate-300 dark:border-slate-700'
              }`}
            >
              {c}
            </button>
          );
        })}
      </div>
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={remoteOk}
          onChange={(e) => onChange(value, e.target.checked)}
          data-testid="remote-toggle"
        />
        包含遠端職缺
      </label>
    </section>
  );
}
