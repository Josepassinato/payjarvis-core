const variants: Record<string, string> = {
  telegram: "bg-blue-100 text-blue-700",
  whatsapp: "bg-green-100 text-green-700",
  web: "bg-gray-100 text-gray-700",
  premium: "bg-purple-100 text-purple-700",
  free: "bg-gray-100 text-gray-600",
  active: "bg-green-100 text-green-700",
  inactive: "bg-red-100 text-red-600",
  draft: "bg-gray-100 text-gray-600",
  sending: "bg-yellow-100 text-yellow-700",
  sent: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-600",
  scheduled: "bg-blue-100 text-blue-700",
  delivered: "bg-green-100 text-green-700",
  APPROVED: "bg-green-100 text-green-700",
  BLOCKED: "bg-red-100 text-red-600",
  PENDING_HUMAN: "bg-yellow-100 text-yellow-700",
};

export default function Badge({ text }: { text: string }) {
  const cls = variants[text] || "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {text}
    </span>
  );
}
