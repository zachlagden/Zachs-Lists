import { Link, useLocation } from 'react-router-dom';
import { Github } from 'lucide-react';
import { useAuthStore } from '../store';

interface PublicNavProps {
  className?: string;
}

export default function PublicNav({ className = '' }: PublicNavProps) {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();
  const isOnBrowsePage = location.pathname === '/browse';

  return (
    <nav className={`relative z-20 container mx-auto px-6 py-5 ${className}`}>
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 bg-gradient-to-br from-electric-pink to-rust rounded-lg flex items-center justify-center group-hover:shadow-rust-glow transition-shadow duration-300">
            <span className="text-white font-bold text-sm">ZL</span>
          </div>
          <span className="font-bold text-xl text-chrome-light">Zach's Lists</span>
        </Link>
        <div className="flex items-center gap-6">
          {!isOnBrowsePage && (
            <Link
              to="/browse"
              className="text-chrome hover:text-chrome-light transition-colors text-sm font-medium hidden sm:block"
            >
              Browse Lists
            </Link>
          )}
          {isAuthenticated ? (
            <Link to="/dashboard" className="btn btn-primary">
              Dashboard
            </Link>
          ) : (
            <Link to="/login" className="btn btn-primary">
              <Github className="w-4 h-4" />
              Sign In
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
