import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/States';

const CHUNK_FAILURE =
  /dynamically imported module|Importing a module script failed|Failed to fetch/i;

function describeRouteError(error: unknown): string {
  if (isRouteErrorResponse(error))
    return `The page answered with ${error.status}. Try again, or go back to the previous page.`;
  if (error instanceof Error && CHUNK_FAILURE.test(error.message)) {
    return 'Part of the app could not be downloaded. Check your connection, then try again.';
  }
  return 'Something went wrong while showing this page. Try again, and if it keeps happening, reload the site.';
}

export function RouteError({ fullScreen = false }: { fullScreen?: boolean }) {
  const error = useRouteError();
  const body = (
    <Card className="max-w-[560px]">
      <ErrorState
        title="This page could not be shown"
        headingLevel="h1"
        onRetry={() => window.location.reload()}
      >
        {describeRouteError(error)}
      </ErrorState>
    </Card>
  );
  if (!fullScreen) return body;
  return <div className="grid min-h-screen place-items-center p-4">{body}</div>;
}
