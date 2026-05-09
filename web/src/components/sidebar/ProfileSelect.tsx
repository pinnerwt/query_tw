import { useState } from 'react';
import { useConfigStore } from '../../state/configStore';

export function ProfileSelect() {
  const c = useConfigStore((s) => s.config);
  const setActive = useConfigStore((s) => s.setActiveProfile);
  const addProfile = useConfigStore((s) => s.addProfile);
  const renameProfile = useConfigStore((s) => s.renameProfile);
  const deleteProfile = useConfigStore((s) => s.deleteProfile);
  const [editing, setEditing] = useState(false);
  const active = c.profiles.find((p) => p.id === c.active_profile_id)!;

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Profiles</h3>
      <div className="flex gap-1">
        {editing ? (
          <input
            className="input"
            autoFocus
            defaultValue={active.name}
            onBlur={(e) => {
              renameProfile(active.id, e.target.value || active.name);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <select
            className="input"
            value={c.active_profile_id}
            onChange={(e) => setActive(e.target.value)}
            data-testid="profile-select"
          >
            {c.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="mt-2 flex gap-1 text-xs">
        <button className="btn-ghost flex-1" onClick={() => addProfile('New profile')}>
          新增
        </button>
        <button className="btn-ghost flex-1" onClick={() => setEditing(true)}>
          重新命名
        </button>
        <button
          className="btn-ghost flex-1 disabled:opacity-50"
          disabled={c.profiles.length <= 1}
          onClick={() => {
            if (confirm(`Delete profile "${active.name}"?`)) deleteProfile(active.id);
          }}
        >
          刪除
        </button>
      </div>
    </section>
  );
}
