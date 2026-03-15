const iconMap: Record<string, string> = {
  "text-brand-400": "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  "text-approved": "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  "text-pending": "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z",
  "text-blocked": "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z",
};

const bgMap: Record<string, string> = {
  "text-brand-400": "from-brand-500/8 to-transparent",
  "text-approved": "from-approved/8 to-transparent",
  "text-pending": "from-pending/8 to-transparent",
  "text-blocked": "from-blocked/8 to-transparent",
};

export function StatCard({
  label,
  value,
  sub,
  color = "text-gray-900",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  const icon = iconMap[color];
  const bg = bgMap[color] ?? "from-transparent to-transparent";

  return (
    <div className={`bg-gradient-to-br ${bg} bg-white border border-gray-200 rounded-xl p-5 transition-all duration-200 hover:scale-[1.02] hover:border-gray-100 hover:shadow-lg hover:shadow-black/20 group`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">{label}</p>
          <p className={`text-2xl font-display font-bold mt-1.5 ${color}`}>{value}</p>
          {sub && <p className="text-[11px] text-gray-500 mt-1">{sub}</p>}
        </div>
        {icon && (
          <div className={`p-2 rounded-lg bg-gray-100/50 ${color} opacity-40 group-hover:opacity-60 transition-opacity`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
