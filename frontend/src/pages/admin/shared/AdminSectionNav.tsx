import { Link, useLocation } from 'react-router-dom';
import {
  SEGMENT_BUTTON,
  SEGMENT_BUTTON_SELECTED,
  SEGMENT_BUTTON_UNSELECTED,
  SEGMENT_FRAME,
} from '../../../components/ui/segmentClasses';
import { cn } from '../../../lib/cn';
import { formatInteger } from '../../../lib/format';
import { ADMIN_SECTIONS, activeSection } from './sections';

export function AdminSectionNav({ pendingRequests }: { pendingRequests: number }) {
  const { pathname } = useLocation();
  const active = activeSection(pathname);
  return (
    <nav aria-label="Admin sections" className="mb-5 max-w-full overflow-x-auto">
      <ul className={cn(SEGMENT_FRAME, 'm-0 list-none')}>
        {ADMIN_SECTIONS.map((section) => {
          const selected = section.path === active.path;
          const waiting = section.path === '/admin/limits' && pendingRequests > 0;
          return (
            <li key={section.path} className="flex-none">
              <Link
                to={section.path}
                aria-current={selected ? 'page' : undefined}
                className={cn(
                  SEGMENT_BUTTON,
                  'inline-flex items-center gap-1.5 whitespace-nowrap no-underline',
                  selected ? SEGMENT_BUTTON_SELECTED : SEGMENT_BUTTON_UNSELECTED,
                )}
              >
                {section.label}
                {waiting ? (
                  <span className="num rounded-full bg-warn-soft px-1.5 text-xs text-warn">
                    {formatInteger(pendingRequests)}
                    <span className="sr-only"> waiting for a decision</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
