import { useEffect, useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { Button } from './Button';
import type { ButtonSize, ButtonVariant } from './buttonClasses';

type CopyOutcome = 'idle' | 'copied' | 'failed';

const OUTCOME_RESET_MS = 2000;

export interface CopyButtonProps {
  text: string;
  label?: string;
  subject?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

export function CopyButton({
  text,
  label = 'Copy',
  subject,
  variant = 'default',
  size = 'sm',
  fullWidth,
  className,
}: CopyButtonProps) {
  const [outcome, setOutcome] = useState<CopyOutcome>('idle');

  useEffect(() => {
    if (outcome === 'idle') return;
    const timer = setTimeout(() => setOutcome('idle'), OUTCOME_RESET_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  const handleCopy = async () => {
    setOutcome((await copyText(text)) ? 'copied' : 'failed');
  };

  const visible = outcome === 'copied' ? 'Copied' : outcome === 'failed' ? 'Copy failed' : label;
  const announcement =
    outcome === 'copied'
      ? 'Copied to the clipboard'
      : outcome === 'failed'
        ? 'Could not copy. Select the text and copy it by hand.'
        : '';

  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={outcome === 'copied' ? 'tick' : outcome === 'failed' ? 'warn' : 'copy'}
        fullWidth={fullWidth}
        className={className}
        onClick={handleCopy}
        aria-label={subject ? `${label} ${subject}` : undefined}
      >
        {visible}
      </Button>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
