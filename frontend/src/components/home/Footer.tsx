import { Link } from 'react-router-dom';
import { Github, Heart } from 'lucide-react';
import RotatingText from './RotatingText';
import { SITE_DOMAIN } from '../../config/site';

const footerLinks = {
  product: [
    { label: 'Browse Lists', href: '/browse' },
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Sign In', href: '/login' },
  ],
  resources: [
    { label: 'GitHub', href: 'https://github.com/zachlagden', external: true },
    { label: 'Sponsor', href: 'https://github.com/sponsors/zachlagden', external: true },
  ],
};

const footerCommunityWords = ['Pi-hole', 'privacy', 'ad-blocking', 'security'];

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-pihole-darker border-t border-pihole-border">
      <div className="container mx-auto px-6 py-12 lg:py-16">
        <div className="grid md:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="md:col-span-2">
            <Link to="/" className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-pihole-accent rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">ZL</span>
              </div>
              <span className="font-bold text-xl text-pihole-text">Zach's Lists</span>
            </Link>
            <p className="text-pihole-text-muted text-sm max-w-sm leading-relaxed">
              Curated blocklists that update themselves. Keeping your network clean, one domain at a time.
            </p>

            {/* Social Links */}
            <div className="flex items-center gap-4 mt-6">
              <a
                href="https://github.com/zachlagden"
                target="_blank"
                rel="noopener noreferrer"
                className="text-pihole-text-muted hover:text-pihole-text transition-colors"
                aria-label="GitHub"
              >
                <Github className="w-5 h-5" />
              </a>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="font-semibold text-pihole-text mb-4 text-sm uppercase tracking-wider">
              Product
            </h3>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-pihole-text-muted hover:text-pihole-text transition-colors text-sm"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources Links */}
          <div>
            <h3 className="font-semibold text-pihole-text mb-4 text-sm uppercase tracking-wider">
              Resources
            </h3>
            <ul className="space-y-3">
              {footerLinks.resources.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-pihole-text-muted hover:text-pihole-text transition-colors text-sm inline-flex items-center gap-1"
                    >
                      {link.label === 'Sponsor' && <Heart className="w-3 h-3 text-pihole-accent" />}
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      to={link.href}
                      className="text-pihole-text-muted hover:text-pihole-text transition-colors text-sm"
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
        <div className="mt-12 pt-8 border-t border-pihole-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-pihole-text-muted text-sm">
            &copy; {currentYear} {SITE_DOMAIN}. All rights reserved.
          </p>
          <p className="text-pihole-text-muted text-sm flex items-center gap-1">
            Made with <Heart className="w-4 h-4 text-pihole-accent" /> for the{' '}
            <RotatingText words={footerCommunityWords} className="text-pihole-text" /> community
          </p>
        </div>
      </div>
    </footer>
  );
}
