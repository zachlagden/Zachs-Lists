import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';

export function Brand({ to, className }: { to: string; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2.5 text-[15px] font-semibold no-underline narrow:min-h-11',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-lg bg-accent-diagonal font-mono text-[11px] font-semibold text-on-accent"
      >
        ZL
      </span>
      <span translate="no">Zach's Lists</span>
    </Link>
  );
}
