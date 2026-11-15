import { useLocation } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/States';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useAuthStore } from '../store';

export default function NotFoundPage() {
  useDocumentMeta('Page not found');
  const { pathname } = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return (
    <div className="mx-auto max-w-[1160px] px-6 py-12">
      <Card className="max-w-[560px]">
        <EmptyState
          title="Page not found"
          headingLevel="h1"
          action={
            <>
              {isAuthenticated ? (
                <Button to="/dashboard" variant="primary">
                  Go to the dashboard
                </Button>
              ) : null}
              <Button to="/">Go to the home page</Button>
            </>
          }
        >
          Nothing lives at{' '}
          <span className="mono break-all" translate="no">
            {pathname}
          </span>
          . The address may be mistyped, or the page may have moved.
        </EmptyState>
      </Card>
    </div>
  );
}
