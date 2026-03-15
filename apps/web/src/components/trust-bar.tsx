export function TrustBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const gradient =
    pct >= 80
      ? "bg-gradient-to-r from-approved/80 to-approved"
      : pct >= 50
      ? "bg-gradient-to-r from-pending/80 to-pending"
      : "bg-gradient-to-r from-blocked/80 to-blocked";
  const textColor =
    pct >= 80 ? "text-approved" : pct >= 50 ? "text-pending" : "text-blocked";

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${gradient}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-sm font-mono font-semibold w-10 text-right ${textColor}`}>{pct}</span>
    </div>
  );
}
