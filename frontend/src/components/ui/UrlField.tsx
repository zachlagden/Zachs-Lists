import { cn } from '../../lib/cn';
import { CopyButton } from './CopyButton';

export interface UrlFieldProps {
  url: string;
  label: string;
  className?: string;
}

export function UrlField({ url, label, className }: UrlFieldProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2.5 rounded-control border border-border bg-sunken py-2.5 pr-2.5 pl-3.5 font-mono text-[13px]',
        className,
      )}
    >
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 flex-1 truncate" title={url} translate="no">
        {url}
      </span>
      <CopyButton text={url} subject={label.toLowerCase()} className="font-sans" />
    </div>
  );
}
