import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminKeys, triggerDefaultRebuild } from '../../../api/admin';
import { describeApiError } from '../../../api/errors';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import type { ButtonVariant } from '../../../components/ui/buttonClasses';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { showToast } from '../../../components/ui/toasts';

export function RebuildDefaultLists({ variant = 'default' }: { variant?: ButtonVariant }) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const rebuild = useMutation({
    mutationFn: triggerDefaultRebuild,
    onSuccess: () => {
      setConfirming(false);
      showToast('ok', 'The default lists build is queued. Follow it under Builds.');
      return client.invalidateQueries({ queryKey: adminKeys.jobs() });
    },
  });

  const close = () => {
    setConfirming(false);
    rebuild.reset();
  };

  return (
    <>
      <Button variant={variant} icon="bolt" onClick={() => setConfirming(true)}>
        Rebuild default lists
      </Button>
      <ConfirmDialog
        open={confirming}
        onCancel={close}
        onConfirm={() => rebuild.mutate()}
        title="Rebuild the default lists?"
        confirmLabel="Start the build"
        busy={rebuild.isPending}
      >
        <p>
          Every default source is downloaded again, ignoring the cache. The current lists stay
          published until the build finishes.
        </p>
        {rebuild.isError ? (
          <Alert tone="warn" title="The build was not started" className="mt-3">
            {describeApiError(rebuild.error, 'Try again in a moment.')}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
