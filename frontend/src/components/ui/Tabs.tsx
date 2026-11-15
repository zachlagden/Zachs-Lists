import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import {
  SEGMENT_BUTTON,
  SEGMENT_BUTTON_SELECTED,
  SEGMENT_BUTTON_UNSELECTED,
  SEGMENT_FRAME,
} from './segmentClasses';
import { nextTabIndex } from './tabKeys';

export interface TabItem<Value extends string> {
  value: Value;
  label: string;
  content: ReactNode;
}

export interface TabsProps<Value extends string> {
  label: string;
  tabs: ReadonlyArray<TabItem<Value>>;
  value: Value;
  onChange: (value: Value) => void;
  className?: string;
}

export function Tabs<Value extends string>({
  label,
  tabs,
  value,
  onChange,
  className,
}: TabsProps<Value>) {
  const baseId = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === value),
  );
  const selected = tabs[selectedIndex];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = nextTabIndex(event.key, selectedIndex, tabs.length);
    if (target === null) return;
    event.preventDefault();
    onChange(tabs[target].value);
    buttons.current[target]?.focus();
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className={cn(SEGMENT_FRAME, 'max-w-full overflow-x-auto')}
      >
        {tabs.map((tab, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={tab.value}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.value}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${tab.value}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onChange(tab.value)}
              className={cn(
                SEGMENT_BUTTON,
                'flex-none',
                isSelected ? SEGMENT_BUTTON_SELECTED : SEGMENT_BUTTON_UNSELECTED,
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {selected ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${selected.value}`}
          aria-labelledby={`${baseId}-tab-${selected.value}`}
          tabIndex={0}
          className="pt-4"
        >
          {selected.content}
        </div>
      ) : null}
    </div>
  );
}
