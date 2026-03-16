interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

export default function StatCard({ label, value, sub, color = "#4A9EFF" }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] p-3.5 md:p-5">
      <p className="text-xs md:text-sm text-[#64748B]">{label}</p>
      <p className="text-xl md:text-2xl font-bold mt-0.5 md:mt-1" style={{ color }}>
        {value}
      </p>
      {sub && <p className="text-[10px] md:text-xs text-[#94A3B8] mt-0.5 md:mt-1">{sub}</p>}
    </div>
  );
}
