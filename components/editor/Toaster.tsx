import { cn } from "@/lib/utils";
import type { Toast } from "@/lib/hooks/useToasts";

export function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed left-1/2 top-16 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4"
      role="region"
      aria-label="Notifications"
    >
      <div className="sr-only" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <p key={toast.id}>{toast.message}</p>
        ))}
      </div>
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => onDismiss(toast.id)}
          className={cn(
            "pointer-events-auto flex w-full items-center gap-2 rounded-lg px-3.5 py-2.5 text-left text-xs font-medium shadow-lg ring-1 backdrop-blur-xl transition-transform hover:scale-[1.01]",
            toast.tone === "error"
              ? "bg-red-50/95 text-red-700 ring-red-200"
              : toast.tone === "success"
                ? "bg-emerald-50/95 text-emerald-700 ring-emerald-200"
                : "bg-white/95 text-black/70 ring-black/5",
          )}
        >
          <ToastIcon tone={toast.tone} />
          <span className="flex-1">{toast.message}</span>
        </button>
      ))}
    </div>
  );
}

function ToastIcon({ tone }: { tone: Toast["tone"] }) {
  if (tone === "error") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
        <path
          fillRule="evenodd"
          d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm0-3.5a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Zm0-7a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4.5Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (tone === "success") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
        <path
          fillRule="evenodd"
          d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.03-9.28a.75.75 0 0 0-1.06-1.06L6.75 7.88 5.28 6.4a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.75-3.75Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
      <path
        fillRule="evenodd"
        d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8.75 4.75a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5ZM8 11.9a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
