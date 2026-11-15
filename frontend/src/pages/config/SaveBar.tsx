import { useEffect } from 'react';
import { Button } from '../../components/ui/Button';
import { StatusPill } from '../../components/ui/StatusPill';

const SPACE_KEPT_CLEAR = '160px';

export interface SaveBarProps {
  summary: string;
  busy: 'save' | 'build' | null;
  blocked: boolean;
  canBuild: boolean;
  onDiscard: () => void;
  onSave: () => void;
  onSaveAndBuild: () => void;
}

export function SaveBar({
  summary,
  busy,
  blocked,
  canBuild,
  onDiscard,
  onSave,
  onSaveAndBuild,
}: SaveBarProps) {
  const working = busy !== null;

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = SPACE_KEPT_CLEAR;
    return () => {
      root.style.scrollPaddingBottom = previous;
    };
  }, []);
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-4 z-[4] mt-4 flex items-center gap-2.5 rounded-card border border-border-strong bg-surface py-2.5 pr-3 pl-4 shadow-overlay narrow:bottom-2 narrow:flex-wrap narrow:p-2.5"
    >
      <StatusPill tone="warn" icon="dash" className="narrow:basis-full narrow:justify-center">
        Unsaved
      </StatusPill>
      <p className="min-w-0 flex-1 text-[13px] text-text-secondary narrow:basis-full narrow:text-center">
        {summary}
      </p>
      <Button
        variant="ghost"
        disabled={working}
        onClick={onDiscard}
        className="narrow:flex-1 narrow:px-2"
      >
        Discard
      </Button>
      <Button
        loading={busy === 'save'}
        disabled={working || blocked}
        onClick={onSave}
        className="narrow:flex-1 narrow:px-2"
      >
        Save
      </Button>
      <Button
        variant="primary"
        icon="bolt"
        loading={busy === 'build'}
        disabled={working || blocked || !canBuild}
        onClick={onSaveAndBuild}
        className="narrow:flex-1 narrow:px-2"
      >
        Save and build
      </Button>
    </div>
  );
}
