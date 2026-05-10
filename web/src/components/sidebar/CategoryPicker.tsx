import { useCategories } from '../../api/jobs';

export function CategoryPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { data } = useCategories();
  const cats = data?.categories || [];
  const toggle = (c: string) => {
    onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  };
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">職類</h3>
      <div className="flex flex-wrap gap-1">
        {cats.map((c) => {
          const selected = value.includes(c.canonical);
          return (
            <button
              key={c.id}
              data-testid={`category-${c.canonical}`}
              onClick={() => toggle(c.canonical)}
              className={`rounded-md border px-2 py-1 text-xs ${
                selected
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                  : 'border-slate-300 dark:border-slate-700'
              }`}
            >
              {c.canonical}
            </button>
          );
        })}
      </div>
    </section>
  );
}
