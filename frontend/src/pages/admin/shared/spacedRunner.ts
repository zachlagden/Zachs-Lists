export interface SpacedRunner {
  request: () => void;
  cancel: () => void;
}

export function createSpacedRunner(run: () => void, intervalMs: number): SpacedRunner {
  let lastRun: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const runNow = () => {
    timer = null;
    lastRun = Date.now();
    run();
  };

  return {
    request: () => {
      if (timer !== null) return;
      const wait = lastRun === null ? 0 : lastRun + intervalMs - Date.now();
      if (wait <= 0) runNow();
      else timer = setTimeout(runNow, wait);
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
