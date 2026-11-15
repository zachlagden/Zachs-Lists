import { FORMAT_NAMES } from '../../lib/listCatalogue';
import type { ListFormat } from '../../types';
import { Button } from '../ui/Button';
import { CopyButton } from '../ui/CopyButton';

export interface ListActionsProps {
  listLabel: string;
  format: ListFormat;
  available: boolean;
  address: string;
  openPath?: string;
}

export function ListActions({ listLabel, format, available, address, openPath }: ListActionsProps) {
  if (!available) {
    return (
      <span className="text-[13px] text-text-tertiary">
        Not published in the {FORMAT_NAMES[format]} format
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <CopyButton
        variant="ghost"
        text={address}
        subject={`the ${listLabel} address in the ${FORMAT_NAMES[format]} format`}
      />
      {openPath ? (
        <Button
          href={openPath}
          target="_blank"
          rel="noopener noreferrer"
          variant="ghost"
          size="sm"
          icon="external"
          aria-label={`Open the ${listLabel} list in the ${FORMAT_NAMES[format]} format in a new tab`}
        >
          Open
        </Button>
      ) : null}
    </span>
  );
}
