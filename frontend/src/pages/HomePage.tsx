import { useEffect, useState } from 'react';
import { useAuthStore } from '../store';
import { analyticsApi, listsApi } from '../api/client';
import {
  HeroSection,
  ValuePropsSection,
  StatsSection,
  ListsShowcase,
  CTASection,
  Footer,
} from '../components/home';

interface PublicStats {
  total_domains: number;
  total_requests_today: number;
  total_requests_week: number;
  total_users: number;
  last_updated: string;
  requests_over_time: { date: string; count: number }[];
  geo_distribution: Record<string, number>;
}

interface DefaultList {
  name: string;
  domain_count: number;
  last_updated: string;
  description?: string;
}

export default function HomePage() {
  const { isAuthenticated } = useAuthStore();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [lists, setLists] = useState<DefaultList[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsData, listsData] = await Promise.all([
          analyticsApi.getPublicStats().catch(() => null),
          listsApi.getDefaultLists().catch(() => []),
        ]);
        setStats(statsData);
        setLists(listsData);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-pihole-darkest">
      <HeroSection isAuthenticated={isAuthenticated} />

      <ValuePropsSection />

      <StatsSection
        totalDomains={stats?.total_domains || 0}
        totalUsers={stats?.total_users || 0}
        totalRequests={stats?.total_requests_week || 0}
      />

      <ListsShowcase lists={lists} loading={loading} />

      <CTASection isAuthenticated={isAuthenticated} />

      <Footer />
    </div>
  );
}
