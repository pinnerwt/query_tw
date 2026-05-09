export function PayRange({
  min,
  period,
  onChange,
}: {
  min: number;
  period: 'monthly' | 'hourly' | 'daily' | 'per_case';
  onChange: (min: number, period: 'monthly' | 'hourly' | 'daily' | 'per_case') => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">薪資下限</h3>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={1000}
          className="input"
          value={min || ''}
          onChange={(e) => onChange(Number(e.target.value) || 0, period)}
          placeholder="0"
          data-testid="pay-min"
        />
        <select
          className="input w-28"
          value={period}
          onChange={(e) => onChange(min, e.target.value as any)}
        >
          <option value="monthly">月薪</option>
          <option value="hourly">時薪</option>
          <option value="daily">日薪</option>
          <option value="per_case">案件</option>
        </select>
      </div>
    </section>
  );
}
