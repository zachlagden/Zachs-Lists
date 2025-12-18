import { useEffect, useState } from 'react';
import { useAuthStore } from '../store';
import { analyticsApi } from '../api/client';
import {
  CinematicHero,
  ProblemSection,
  SolutionJourney,
  TechCredibility,
  SupportSection,
  CTASection,
  Footer,
} from '../components/home';

interface PublicStats {
  total_domains: number;
  total_requests: number;
  total_requests_today?: number;
  total_requests_week?: number;
  total_bandwidth_bytes?: number;
  total_users?: number;
  user_count?: number;
  last_updated?: string;
  requests_over_time?: { date: string; count: number }[];
  geo_distribution?: Record<string, number>;
}

export default function HomePage() {
  const { isAuthenticated } = useAuthStore();
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const statsData = await analyticsApi.getPublicStats().catch(() => null);
        setStats(statsData);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-void">
      {/* 1. Cinematic Hero - Full viewport with threat visualization */}
      <CinematicHero
        isAuthenticated={isAuthenticated}
        totalDomains={stats?.total_domains || 0}
      />

      {/* 2. Problem Section - The chaos of the unprotected internet */}
      <ProblemSection />

      {/* 3. Solution Journey - Three steps to protection */}
      <SolutionJourney />

      {/* 4. Tech Credibility - Rust branding and stack */}
      <TechCredibility />

      {/* 5. Final CTA - Convert visitors */}
      <CTASection isAuthenticated={isAuthenticated} />

      {/* 6. Support Section - Help keep this free */}
      <SupportSection />

      {/* 7. Footer */}
      <Footer />
    </div>
  );
}
