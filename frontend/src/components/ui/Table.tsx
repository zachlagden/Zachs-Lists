import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  flush?: boolean;
}

export function Table({ flush = false, className, ...rest }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table
        data-flush={flush || undefined}
        className={cn('group/table w-full border-collapse', className)}
        {...rest}
      />
    </div>
  );
}

export function TableHead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TableBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&>tr:last-child>td]:border-b-0', className)} {...rest} />;
}

export function TableRow({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('[tbody>&]:hover:bg-surface-hover', className)} {...rest} />;
}

interface CellOptions {
  align?: 'left' | 'right';
  hideOnNarrow?: boolean;
}

const CELL_EDGES =
  'px-[18px] narrow:px-3 group-data-[flush]/table:first:pl-0 group-data-[flush]/table:last:pr-0';

function cellClasses({ align = 'left', hideOnNarrow = false }: CellOptions): string {
  return cn(
    CELL_EDGES,
    'border-b border-border',
    align === 'right' ? 'text-right' : 'text-left',
    hideOnNarrow && 'narrow:hidden',
  );
}

export interface TableHeaderCellProps
  extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'>, CellOptions {}

export function TableHeaderCell({
  align,
  hideOnNarrow,
  className,
  scope = 'col',
  ...rest
}: TableHeaderCellProps) {
  return (
    <th
      scope={scope}
      className={cn(
        cellClasses({ align, hideOnNarrow }),
        'py-2.5 text-xs font-medium whitespace-nowrap text-text-tertiary',
        className,
      )}
      {...rest}
    />
  );
}

export interface TableCellProps
  extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'>, CellOptions {}

export function TableCell({ align, hideOnNarrow, className, ...rest }: TableCellProps) {
  return (
    <td
      className={cn(
        cellClasses({ align, hideOnNarrow }),
        'py-[11px] align-middle',
        align === 'right' && 'num',
        className,
      )}
      {...rest}
    />
  );
}
