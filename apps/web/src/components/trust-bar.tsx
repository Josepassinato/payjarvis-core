export function TrustBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 80 ? "bg-approved" : pct >= 50 ? "bg-pending" : "bg-blocked";

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2.5 bg-surface-hover rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-mono text-gray-300 w-10 text-right">{pct}</span>
    </div>
  );
}
