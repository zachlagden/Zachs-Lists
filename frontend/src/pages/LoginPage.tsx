import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { gitHubSignInUrl } from '../api/auth';
import { PagePending } from '../components/shell/Pending';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { rememberReturnPath } from '../routes/returnPath';
import { useAuthStore } from '../store';
import { loginErrorMessage } from '../utils/loginErrors';

interface LoginLocationState {
  from?: string;
}

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const sessionEnded = useAuthStore((state) => state.sessionEnded);
  const error = searchParams.get('error');
  const attemptedPath = (location.state as LoginLocationState | null)?.from;

  if (isLoading) return <PagePending />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <div className="mx-auto grid max-w-[1160px] justify-items-center px-6 py-16 narrow:py-10">
      <Card className="w-full max-w-[420px]">
        <CardBody className="grid gap-4 p-[22px]">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em]">Sign in</h1>
            <p className="mt-1 text-text-secondary">
              Use your GitHub account to build and manage your blocklist.
            </p>
          </div>
          {sessionEnded ? (
            <Alert tone="warn" title="Your session ended">
              Sign in again to go back to the page you were on. Changes you had not saved were not
              sent.
            </Alert>
          ) : null}
          {error ? (
            <Alert tone="fail">{loginErrorMessage(error, searchParams.get('until'))}</Alert>
          ) : null}
          <Button
            href={gitHubSignInUrl()}
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => rememberReturnPath(attemptedPath)}
          >
            Sign in with GitHub
          </Button>
          <p className="text-[13px] text-text-tertiary">
            No GitHub account?{' '}
            <a
              href="https://github.com/join"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-text hover:underline"
            >
              Create one on GitHub
            </a>
            .
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
