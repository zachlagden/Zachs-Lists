import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/Layout';
import { EmptyState, ErrorState } from '../../components/ui/States';

export interface BuildProblemProps {
  notFound: boolean;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  backTo: string;
  backLabel: string;
}

export function BuildProblem({
  notFound,
  error,
  onRetry,
  retrying,
  backTo,
  backLabel,
}: BuildProblemProps) {
  return (
    <>
      <PageHeader title={notFound ? 'Build not found' : 'Build'} />
      <Card>
        {notFound ? (
          <EmptyState
            title="This build does not exist"
            headingLevel="h2"
            icon="search"
            action={
              <Button to={backTo} icon="arrow-left">
                {backLabel}
              </Button>
            }
          >
            The address may be wrong, the build may belong to another account, or it may have been
            removed. Finished builds are deleted after 30 days.
          </EmptyState>
        ) : (
          <ErrorState
            title="The build could not be loaded"
            headingLevel="h2"
            error={error}
            onRetry={onRetry}
            retrying={retrying}
          />
        )}
      </Card>
    </>
  );
}
