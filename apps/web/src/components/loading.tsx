export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-blocked/5 border border-blocked/20 rounded-xl p-5 text-center">
      <p className="text-sm text-blocked">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 px-4 py-1.5 text-xs bg-surface-hover text-gray-300 rounded-lg hover:text-white">
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-12 text-center">
      <p className="text-gray-400">{message}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </div>
  );
}
