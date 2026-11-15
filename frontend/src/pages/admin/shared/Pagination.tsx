import { Button } from '../../../components/ui/Button';
import { formatInteger } from '../../../lib/format';
import { pageRange } from './urlState';

export interface PaginationProps {
  label: string;
  page: number;
  pages: number;
  perPage: number;
  total: number;
  noun: string;
  onPageChange: (page: number) => void;
}

export function Pagination({
  label,
  page,
  pages,
  perPage,
  total,
  noun,
  onPageChange,
}: PaginationProps) {
  const { first, last } = pageRange(page, perPage, total);
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center gap-2 border-t border-border px-[18px] py-2.5 text-[13px] text-text-secondary narrow:px-3"
    >
      <p className="num mr-auto" role="status">
        {total === 0
          ? `No ${noun}`
          : `${formatInteger(first)} to ${formatInteger(last)} of ${formatInteger(total)} ${noun}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          icon="arrow-left"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="num whitespace-nowrap">
          Page {formatInteger(page)} of {formatInteger(Math.max(pages, 1))}
        </span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}
