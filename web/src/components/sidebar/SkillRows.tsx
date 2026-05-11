import { useConfigStore, useActiveProfile } from '../../state/configStore';
import { useSkills, useRoles } from '../../api/jobs';
import type { SkillRow } from '../../types';

export function SkillRows() {
  const profile = useActiveProfile();
  const update = useConfigStore((s) => s.updateActiveFilters);
  const { data } = useSkills();
  const options = data?.skills.map((s) => s.canonical) || [];
  const rows = profile.filters.skills || [];

  const set = (rows: SkillRow[]) => update((f) => ({ ...f, skills: rows }));
  const listId = 'sidebar-skills-options';

  return (
    <section data-testid="skill-rows">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-slate-500">技能</h3>
        <button
          className="text-xs text-blue-600 hover:underline"
          onClick={() => set([...rows, { name: '', years_min: 0 }])}
        >
          + 新增
        </button>
      </div>
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <div className="space-y-1">
        {rows.map((r, idx) => (
          <Row
            key={idx}
            row={r}
            listId={listId}
            placeholder="例如 React"
            onChange={(next) => set(rows.map((r2, i) => (i === idx ? next : r2)))}
            onRemove={() => set(rows.filter((_, i) => i !== idx))}
          />
        ))}
      </div>
    </section>
  );
}

export function ExperienceRows() {
  const profile = useActiveProfile();
  const update = useConfigStore((s) => s.updateActiveFilters);
  const { data } = useRoles();
  const options = data?.roles.map((r) => r.canonical) || [];
  const rows = profile.filters.experience || [];

  const set = (rows: SkillRow[]) => update((f) => ({ ...f, experience: rows }));
  const listId = 'sidebar-roles-options';

  return (
    <section data-testid="experience-rows">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-slate-500">經歷</h3>
        <button
          className="text-xs text-blue-600 hover:underline"
          onClick={() => set([...rows, { name: '', years_min: 0 }])}
        >
          + 新增
        </button>
      </div>
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <div className="space-y-1">
        {rows.map((r, idx) => (
          <Row
            key={idx}
            row={r}
            listId={listId}
            placeholder="例如 前端工程師"
            onChange={(next) => set(rows.map((r2, i) => (i === idx ? next : r2)))}
            onRemove={() => set(rows.filter((_, i) => i !== idx))}
          />
        ))}
      </div>
    </section>
  );
}

function Row({
  row,
  listId,
  placeholder,
  onChange,
  onRemove,
}: {
  row: SkillRow;
  listId: string;
  placeholder: string;
  onChange: (r: SkillRow) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        list={listId}
        className="input flex-1"
        value={row.name}
        placeholder={placeholder}
        onChange={(e) => onChange({ ...row, name: e.target.value })}
      />
      <span className="text-xs">≤</span>
      <input
        type="number"
        min={0}
        max={20}
        className="input w-14"
        value={row.years_min}
        onChange={(e) => onChange({ ...row, years_min: Number(e.target.value) || 0 })}
      />
      <span className="text-xs">年</span>
      <button className="px-1 text-slate-400 hover:text-red-500" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}
