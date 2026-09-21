import { useEffect } from "react";
import { useT } from "../locale.tsx";

export interface ToastAction { label: string; href: string }
interface Props { message: string | null; action?: ToastAction | null; onClose: () => void }

/** An error toast; with an `action` link it stays twice as long so the link can be reached. */
export function Toast({ message, action = null, onClose }: Props) {
  const { t } = useT();
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onClose, action ? 10000 : 5000);
    return () => clearTimeout(timer);
  }, [message, action, onClose]);
  if (!message) return null;
  return (
    <div className="toast err" role="alert">
      <span>✗ {message}</span>
      {action && <a className="toast-action" href={action.href}>{action.label}</a>}
      <button className="toast-close" onClick={onClose} aria-label={t("common.dismiss")}>×</button>
    </div>
  );
}
