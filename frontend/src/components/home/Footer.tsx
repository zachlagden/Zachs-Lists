import { Link } from 'react-router-dom';
import { Github, Heart, Shield } from 'lucide-react';
import { useAuthStore } from '../../store';

const resourceLinks = [
  { label: 'GitHub', href: 'https://github.com/zachlagden/Zachs-Lists', external: true },
  { label: 'Sponsor', href: 'https://github.com/sponsors/zachlagden', external: true },
];

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const { isAuthenticated } = useAuthStore();

  const productLinks = [
    { label: 'Browse Lists', href: '/browse' },
    isAuthenticated
      ? { label: 'Dashboard', href: '/dashboard' }
      : { label: 'Sign In', href: '/login' },
  ];

  return (
    <footer className="bg-void-deep border-t border-steel-light/30">
      <div className="container mx-auto px-6 py-12 lg:py-16">
        <div className="grid md:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="md:col-span-2">
            <Link to="/" className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-gradient-to-br from-electric-pink to-rust rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">ZL</span>
              </div>
              <span className="font-bold text-xl text-chrome-light">Zach's Lists</span>
            </Link>
            <p className="text-chrome text-sm max-w-sm leading-relaxed mb-4">
              Curated blocklists that update themselves. Keeping your network clean, one domain at a time.
            </p>

            {/* Rust Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rust/10 border border-rust/30 mb-6">
              <img src="/assets/rust-logo.png" alt="Rust" className="w-4 h-4" />
              <span className="text-xs font-medium text-rust-light">Powered by Rust</span>
            </div>

            {/* Social Links */}
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/zachlagden/Zachs-Lists"
                target="_blank"
                rel="noopener noreferrer"
                className="text-chrome hover:text-chrome-light transition-colors"
                aria-label="GitHub"
              >
                <Github className="w-5 h-5" />
              </a>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="font-display text-sm text-chrome-light mb-4 uppercase tracking-wider">
              Product
            </h3>
            <ul className="space-y-3">
              {productLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-chrome hover:text-chrome-light transition-colors text-sm"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources Links */}
          <div>
            <h3 className="font-display text-sm text-chrome-light mb-4 uppercase tracking-wider">
              Resources
            </h3>
            <ul className="space-y-3">
              {resourceLinks.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-chrome hover:text-chrome-light transition-colors text-sm inline-flex items-center gap-1.5"
                    >
                      {link.label === 'Sponsor' && <Heart className="w-3 h-3 text-electric-pink" />}
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      to={link.href}
                      className="text-chrome hover:text-chrome-light transition-colors text-sm"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-steel-light/30 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-chrome text-sm">
            &copy; {currentYear} Zachariah Michael Lagden. All rights reserved.
          </p>
          <p className="text-chrome text-sm flex items-center gap-2">
            Made with <Heart className="w-4 h-4 text-electric-pink fill-electric-pink" /> for the{' '}
            <Shield className="w-4 h-4 text-rust" /> privacy community
          </p>
        </div>
      </div>
    </footer>
  );
}
