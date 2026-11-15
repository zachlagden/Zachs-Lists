import { useNavigation } from 'react-router-dom';
import { Icon } from '../ui/Icon';

export function PagePending({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div
      role="status"
      className={
        fullScreen
          ? 'grid min-h-screen place-items-center text-text-secondary'
          : 'grid min-h-[40vh] place-items-center text-text-secondary'
      }
    >
      <span className="inline-flex items-center gap-2 text-[13px]">
        <Icon name="loop" spin />
        Loading…
      </span>
    </div>
  );
}

export function NavigationProgress() {
  const navigation = useNavigation();
  if (navigation.state === 'idle') return null;
  return (
    <div role="status" className="sticky top-0 z-[6] h-0">
      <span className="sr-only">Loading page…</span>
      <div aria-hidden="true" className="h-0.5 animate-skeleton bg-accent" />
    </div>
  );
}
