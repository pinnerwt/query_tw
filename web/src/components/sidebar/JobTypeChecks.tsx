const TYPES: { v: string; label: string }[] = [
  { v: 'full_time', label: '正職' },
  { v: 'part_time', label: '兼職' },
  { v: 'freelance', label: '接案' },
  { v: 'intern', label: '實習' },
  { v: 'contract', label: '約聘' },
];

export function JobTypeChecks({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">職務類型</h3>
      <div className="grid grid-cols-2 gap-1 text-sm">
        {TYPES.map((t) => {
          const checked = value.includes(t.v);
          return (
            <label key={t.v} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) =>
                  onChange(e.target.checked ? [...value, t.v] : value.filter((x) => x !== t.v))
                }
                data-testid={`jobtype-${t.v}`}
              />
              {t.label}
            </label>
          );
        })}
      </div>
    </section>
  );
}
