import { cn } from '../../lib/cn';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { useToastStore, type Toast } from './toasts';

const TONE_TEXT: Record<Toast['tone'], string> = {
  info: 'text-info',
  ok: 'text-ok',
  warn: 'text-warn',
  fail: 'text-fail',
};

const TONE_ICON = { info: 'info', ok: 'check', warn: 'warn', fail: 'fail' } as const;

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-auto flex items-start gap-2.5 rounded-card border border-border-strong bg-surface py-2.5 pr-2 pl-3.5 text-[13px] shadow-overlay">
      <Icon name={TONE_ICON[toast.tone]} className={cn('mt-0.5', TONE_TEXT[toast.tone])} />
      <p className="min-w-0 flex-1 break-words">{toast.message}</p>
      <IconButton
        label="Dismiss message"
        icon="close"
        size="sm"
        onClick={() => onDismiss(toast.id)}
        className="-my-1"
      />
    </div>
  );
}

export function ToastRegion() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  const urgent = toasts.filter((toast) => toast.tone === 'fail' || toast.tone === 'warn');
  const polite = toasts.filter((toast) => toast.tone === 'info' || toast.tone === 'ok');
  return (
    <div className="pointer-events-none fixed top-[68px] right-4 z-40 grid w-[min(360px,calc(100vw-32px))] gap-2 narrow:top-[72px]">
      <div role="alert" className="grid gap-2">
        {urgent.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
      <div role="status" className="grid gap-2">
        {polite.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}
