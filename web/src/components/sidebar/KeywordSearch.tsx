export function KeywordSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">關鍵字</h3>
      <input
        type="search"
        className="input"
        placeholder="搜尋職缺、技能…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="keyword-input"
      />
    </section>
  );
}
