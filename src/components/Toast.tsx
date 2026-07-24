import { useEffect, useRef } from 'react';
import { AlertTriangle, Check } from 'lucide-react';

export type ToastState = {
  id: number;
  message: string;
  tone?: 'success' | 'error';
} | null;

type Props = {
  toast: ToastState;
  onDismiss: () => void;
  durationMs?: number;
};

/** Errors stay up longer — they carry a filename and a reason to read. */
const ERROR_DURATION_MS = 6000;

export function Toast({ toast, onDismiss, durationMs = 2200 }: Props) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const isError = toast?.tone === 'error';

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(
      () => onDismissRef.current(),
      isError ? ERROR_DURATION_MS : durationMs,
    );
    return () => window.clearTimeout(id);
  }, [toast, durationMs, isError]);

  if (!toast) return null;

  return (
    <div
      className={`toast${isError ? ' toast-error' : ''}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      onClick={() => onDismissRef.current()}
    >
      <span className="toast-icon" aria-hidden>
        {isError ? (
          <AlertTriangle size={14} strokeWidth={2.5} />
        ) : (
          <Check size={14} strokeWidth={2.5} />
        )}
      </span>
      <span className="toast-message">{toast.message}</span>
    </div>
  );
}
