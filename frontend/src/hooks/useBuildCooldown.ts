import { useCallback, useEffect, useState } from 'react';
import type { ApiError } from '../api/errors';
import { cooldownEndsAt } from '../lib/builds';

export interface BuildCooldown {
  endsAt: number | null;
  noteRefusal: (error: ApiError) => void;
}

export function useBuildCooldown(): BuildCooldown {
  const [endsAt, setEndsAt] = useState<number | null>(null);

  useEffect(() => {
    if (endsAt === null) return;
    const timer = setTimeout(() => setEndsAt(null), Math.max(0, endsAt - Date.now()));
    return () => clearTimeout(timer);
  }, [endsAt]);

  const noteRefusal = useCallback((error: ApiError) => {
    const known = cooldownEndsAt(error, Date.now());
    if (known !== null) setEndsAt(known);
  }, []);

  return { endsAt, noteRefusal };
}
