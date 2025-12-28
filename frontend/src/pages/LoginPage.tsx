import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store';
import { authApi } from '../api/client';
import PublicNav from '../components/PublicNav';
import { Footer } from '../components/home';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, isLoading } = useAuthStore();

  const error = searchParams.get('error');

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleGitHubLogin = () => {
    window.location.href = authApi.getGitHubLoginUrl();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-steel-light border-t-rust" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-void flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 bg-grid-pattern opacity-20 pointer-events-none" />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-radial-rust opacity-20 pointer-events-none" />

      {/* Navigation */}
      <PublicNav />

      {/* Main */}
      <main className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-md">
          <div className="glass-card p-8">
            <div className="text-center mb-8">
              <h1 className="font-display text-3xl text-chrome-light mb-2">LOGIN</h1>
              <p className="text-chrome">
                Sign in to manage your blocklists
              </p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-6 text-sm">
                {error === 'access_denied' && 'You denied access to your GitHub account.'}
                {error === 'no_email' && 'Unable to retrieve email from GitHub. Please ensure your email is public or verify your email.'}
                {error === 'disabled' && 'Your account has been disabled. Please contact support.'}
                {!['access_denied', 'no_email', 'disabled'].includes(error) && 'An error occurred during authentication.'}
              </div>
            )}

            <button
              onClick={handleGitHubLogin}
              className="w-full btn bg-[#24292f] hover:bg-[#32383f] text-white flex items-center justify-center gap-3 py-3"
            >
              <GitHubIcon className="w-5 h-5" />
              Login with GitHub
            </button>

            <p className="text-chrome text-sm text-center mt-6">
              By signing in, you agree to our terms of service.
            </p>
          </div>

          <div className="mt-6 text-center">
            <p className="text-chrome text-sm">
              Don't have a GitHub account?{' '}
              <a
                href="https://github.com/join"
                target="_blank"
                rel="noopener noreferrer"
                className="text-rust hover:text-rust-light"
              >
                Create one
              </a>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
