const styles: Record<string, string> = {
  APPROVED: "bg-approved/10 text-approved border-approved/20",
  BLOCKED: "bg-blocked/10 text-blocked border-blocked/20",
  PENDING_HUMAN: "bg-pending/10 text-pending border-pending/20",
  PENDING: "bg-pending/10 text-pending border-pending/20",
};

const labels: Record<string, string> = {
  APPROVED: "Aprovado",
  BLOCKED: "Bloqueado",
  PENDING_HUMAN: "Pendente",
  PENDING: "Pendente",
};

export function DecisionBadge({ decision }: { decision: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
        styles[decision] ?? "bg-gray-800 text-gray-400 border-gray-700"
      }`}
    >
      {labels[decision] ?? decision}
    </span>
  );
}
