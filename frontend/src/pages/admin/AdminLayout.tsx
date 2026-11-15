import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { adminLimitRequestsQuery } from '../../api/admin';
import { PagePending } from '../../components/shell/Pending';
import { AdminSectionNav } from './shared/AdminSectionNav';
import { useAdminJobsLiveSync } from './shared/useAdminJobsLiveSync';

export default function AdminLayout() {
  const requests = useQuery(adminLimitRequestsQuery());
  useAdminJobsLiveSync();
  return (
    <>
      <AdminSectionNav pendingRequests={requests.data?.pending_count ?? 0} />
      <Suspense fallback={<PagePending />}>
        <Outlet />
      </Suspense>
    </>
  );
}
