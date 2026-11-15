import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { mergeFetchedList } from '../realtime/jobMerge';
import type {
  AdminLimitReviewPage,
  AdminStats,
  AdminUser,
  Announcement,
  DefaultConfig,
  DefaultSyncRun,
  DefaultSyncStatus,
  FeaturedList,
  Job,
  JobStatus,
  LimitRequest,
  UserLimits,
} from '../types';
import { del, get, post, put } from './http';

export const ADMIN_USERS_PAGE_SIZE = 25;
export const ADMIN_JOBS_LIMIT = 100;
export const ADMIN_LIMIT_REVIEWS_PAGE_SIZE = 25;
export const ADMIN_STATS_FRESH_MS = 30_000;
export const ADMIN_ANNOUNCEMENTS_LIMIT = 50;
export const ADMIN_CHART_DAYS = 30;

export interface AdminIpLogEntry {
  ip_hash: string | null;
  first_seen: string | null;
  last_seen: string | null;
  access_count: number;
}

export interface AdminUserDetail extends AdminUser {
  is_banned: boolean;
  banned_until: string | null;
  ban_reason: string | null;
  ip_log: AdminIpLogEntry[];
  default_limits: UserLimits;
  limit_maximums: UserLimits;
}

export interface AdminUserFilters {
  page?: number;
  perPage?: number;
  search?: string;
  showAdmins?: boolean;
  showRegular?: boolean;
  showEnabled?: boolean;
  showDisabled?: boolean;
  bannedOnly?: boolean;
}

export interface AdminUsersPage {
  users: AdminUserDetail[];
  page: number;
  per_page: number;
  total: number;
  pages: number;
}

export interface AdminUserUpdate {
  is_enabled?: boolean;
  limits?: Partial<UserLimits>;
}

export type BanDuration = '1d' | '7d' | '30d' | 'permanent';

export interface AdminActionResult {
  success: boolean;
  message: string;
}

export interface BanResult extends AdminActionResult {
  banned_until: string;
}

export interface AdminUserIps {
  username: string;
  ip_count: number;
  ip_log: AdminIpLogEntry[];
}

export interface AdminBuildStarted {
  job_id: string;
  status: JobStatus;
}

export interface AdminJobsResponse {
  jobs: Job[];
}

export interface AdminSystemStats extends AdminStats {
  workers: {
    alive: number;
  };
}

export interface JobsPerDayPoint {
  date: string;
  total: number;
  completed: number;
  failed: number;
}

export interface JobsPerDayResponse {
  jobs_per_day: JobsPerDayPoint[];
}

export interface UserGrowthPoint {
  date: string;
  new_users: number;
  total_users: number;
}

export interface UserGrowthResponse {
  user_growth: UserGrowthPoint[];
}

export interface DefaultConfigUpdate {
  config?: string;
  whitelist?: string;
}

export interface AdminFeaturedResponse {
  featured: FeaturedList[];
}

export interface FeaturedListSubmission {
  username: string;
  listName: string;
  description?: string;
}

export interface FeaturedListAdded {
  success: boolean;
  id: string;
  featured: FeaturedList;
}

export type LimitRequestStatus = LimitRequest['status'];

export interface AdminLimitRequestsResponse {
  requests: LimitRequest[];
  pending_count: number;
}

export interface LimitRequestApproval {
  customLimit?: number;
  response?: string;
}

export interface LimitRequestReviewed {
  success: boolean;
  request: LimitRequest;
}

export type LibraryCategory =
  | 'comprehensive'
  | 'malicious'
  | 'advertising'
  | 'tracking'
  | 'suspicious'
  | 'nsfw';

export interface LibraryEntry {
  id: string;
  url: string;
  name: string;
  category: LibraryCategory;
  description: string;
  recommended: boolean;
  aggressiveness: number;
  domain_count: number;
  added_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AdminLibraryResponse {
  library: LibraryEntry[];
  categories: LibraryCategory[];
}

export interface LibraryEntrySubmission {
  url: string;
  name: string;
  category: LibraryCategory;
  description?: string;
  recommended?: boolean;
  aggressiveness?: number;
  domain_count?: number;
}

export type LibraryEntryUpdate = Partial<LibraryEntrySubmission>;

export interface LibraryEntrySaved {
  success: boolean;
  entry: LibraryEntry;
}

export type AnnouncementType = Announcement['type'];

export interface AdminAnnouncementsResponse {
  announcements: Announcement[];
}

export interface AnnouncementSubmission {
  title: string;
  message: string;
  type?: AnnouncementType;
  expires_at?: string | null;
}

export interface AnnouncementUpdate {
  title?: string;
  message?: string;
  type?: AnnouncementType;
  is_active?: boolean;
  expires_at?: string | null;
}

export interface AnnouncementSaved {
  success: boolean;
  announcement: Announcement;
}

export const adminKeys = {
  all: ['admin'] as const,
  users: () => [...adminKeys.all, 'users'] as const,
  userList: (filters: AdminUserFilters) => [...adminKeys.users(), 'list', filters] as const,
  user: (userId: string) => [...adminKeys.users(), 'detail', userId] as const,
  userIps: (userId: string) => [...adminKeys.users(), 'ips', userId] as const,
  jobs: () => [...adminKeys.all, 'jobs'] as const,
  jobList: (limit: number) => [...adminKeys.jobs(), 'list', limit] as const,
  job: (jobId: string) => [...adminKeys.jobs(), 'detail', jobId] as const,
  stats: () => [...adminKeys.all, 'stats'] as const,
  jobsPerDay: (days: number) => [...adminKeys.all, 'jobs-per-day', days] as const,
  userGrowth: (days: number) => [...adminKeys.all, 'user-growth', days] as const,
  defaultConfig: () => [...adminKeys.all, 'default-config'] as const,
  defaultSync: () => [...adminKeys.all, 'default-sync'] as const,
  featured: () => [...adminKeys.all, 'featured'] as const,
  limitRequests: () => [...adminKeys.all, 'limit-requests'] as const,
  limitRequestList: (status: LimitRequestStatus | null) =>
    [...adminKeys.limitRequests(), 'list', status] as const,
  limitReviews: () => [...adminKeys.all, 'limit-reviews'] as const,
  limitReviewPage: (page: number, perPage: number) =>
    [...adminKeys.limitReviews(), 'page', page, perPage] as const,
  library: () => [...adminKeys.all, 'library'] as const,
  libraryList: (category: string | null) => [...adminKeys.library(), 'list', category] as const,
  libraryEntry: (entryId: string) => [...adminKeys.library(), 'detail', entryId] as const,
  announcements: () => [...adminKeys.all, 'announcements'] as const,
  announcementList: (limit: number) => [...adminKeys.announcements(), 'list', limit] as const,
};

export function fetchAdminUsers(filters: AdminUserFilters = {}): Promise<AdminUsersPage> {
  return get<AdminUsersPage>('/api/admin/users', {
    page: filters.page ?? 1,
    per_page: filters.perPage ?? ADMIN_USERS_PAGE_SIZE,
    search: filters.search || undefined,
    show_admins: filters.showAdmins ?? true,
    show_regular: filters.showRegular ?? true,
    show_enabled: filters.showEnabled ?? true,
    show_disabled: filters.showDisabled ?? true,
    banned_only: filters.bannedOnly ? true : undefined,
  });
}

export function fetchAdminUser(userId: string): Promise<AdminUserDetail> {
  return get<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(userId)}`);
}

export function updateAdminUser(userId: string, update: AdminUserUpdate): Promise<AdminUserDetail> {
  return put<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(userId)}`, update);
}

export function deleteAdminUser(userId: string): Promise<AdminActionResult> {
  return del<AdminActionResult>(`/api/admin/users/${encodeURIComponent(userId)}`);
}

export function banUser(
  userId: string,
  duration: BanDuration,
  reason?: string,
): Promise<BanResult> {
  return post<BanResult>(`/api/admin/users/${encodeURIComponent(userId)}/ban`, {
    duration,
    reason,
  });
}

export function unbanUser(userId: string): Promise<AdminActionResult> {
  return post<AdminActionResult>(`/api/admin/users/${encodeURIComponent(userId)}/unban`);
}

export function setUserAdmin(userId: string, isAdmin: boolean): Promise<AdminUserDetail> {
  return put<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(userId)}/admin`, {
    is_admin: isAdmin,
  });
}

export function fetchAdminUserIps(userId: string): Promise<AdminUserIps> {
  return get<AdminUserIps>(`/api/admin/users/${encodeURIComponent(userId)}/ips`);
}

export function triggerUserRebuild(userId: string): Promise<AdminBuildStarted> {
  return post<AdminBuildStarted>(`/api/admin/rebuild/${encodeURIComponent(userId)}`);
}

export function triggerDefaultRebuild(): Promise<AdminBuildStarted> {
  return post<AdminBuildStarted>('/api/admin/rebuild/default');
}

export function fetchAdminJobs(limit: number = ADMIN_JOBS_LIMIT): Promise<AdminJobsResponse> {
  return get<AdminJobsResponse>('/api/admin/jobs', { limit });
}

export function fetchAdminJob(jobId: string): Promise<Job> {
  return get<Job>(`/api/admin/jobs/${encodeURIComponent(jobId)}`);
}

export function fetchAdminStats(): Promise<AdminSystemStats> {
  return get<AdminSystemStats>('/api/admin/stats');
}

export function fetchJobsPerDay(days: number = ADMIN_CHART_DAYS): Promise<JobsPerDayResponse> {
  return get<JobsPerDayResponse>('/api/admin/stats/jobs-per-day', { days });
}

export function fetchUserGrowth(days: number = ADMIN_CHART_DAYS): Promise<UserGrowthResponse> {
  return get<UserGrowthResponse>('/api/admin/stats/user-growth', { days });
}

export function fetchDefaultConfig(): Promise<DefaultConfig> {
  return get<DefaultConfig>('/api/admin/default/config');
}

export function updateDefaultConfig(update: DefaultConfigUpdate): Promise<{ success: boolean }> {
  return put<{ success: boolean }>('/api/admin/default/config', update);
}

export function fetchDefaultSync(): Promise<DefaultSyncStatus> {
  return get<DefaultSyncStatus>('/api/admin/default/sync');
}

export function runDefaultSync(force: boolean = false): Promise<DefaultSyncRun> {
  return post<DefaultSyncRun>('/api/admin/default/sync', { force });
}

export function fetchAdminFeaturedLists(): Promise<AdminFeaturedResponse> {
  return get<AdminFeaturedResponse>('/api/admin/featured');
}

export function addFeaturedList(submission: FeaturedListSubmission): Promise<FeaturedListAdded> {
  return post<FeaturedListAdded>('/api/admin/featured', {
    username: submission.username,
    list_name: submission.listName,
    description: submission.description ?? '',
  });
}

export function removeFeaturedList(featuredId: string): Promise<{ success: boolean }> {
  return del<{ success: boolean }>(`/api/admin/featured/${encodeURIComponent(featuredId)}`);
}

export function fetchAdminLimitRequests(
  status?: LimitRequestStatus,
): Promise<AdminLimitRequestsResponse> {
  return get<AdminLimitRequestsResponse>('/api/admin/limit-requests', { status });
}

export function approveLimitRequest(
  requestId: string,
  approval: LimitRequestApproval = {},
): Promise<LimitRequestReviewed> {
  return post<LimitRequestReviewed>(
    `/api/admin/limit-requests/${encodeURIComponent(requestId)}/approve`,
    { custom_limit: approval.customLimit, response: approval.response },
  );
}

export function denyLimitRequest(
  requestId: string,
  response?: string,
): Promise<LimitRequestReviewed> {
  return post<LimitRequestReviewed>(
    `/api/admin/limit-requests/${encodeURIComponent(requestId)}/deny`,
    { response },
  );
}

export function fetchLimitReviews(
  page: number = 1,
  perPage: number = ADMIN_LIMIT_REVIEWS_PAGE_SIZE,
): Promise<AdminLimitReviewPage> {
  return get<AdminLimitReviewPage>('/api/admin/limit-reviews', { page, per_page: perPage });
}

export function resolveLimitReview(userId: string, reason: string): Promise<{ success: boolean }> {
  return post<{ success: boolean }>(
    `/api/admin/limit-reviews/${encodeURIComponent(userId)}/resolve`,
    { reason },
  );
}

export function fetchLibrary(category?: string): Promise<AdminLibraryResponse> {
  return get<AdminLibraryResponse>('/api/admin/library', { category });
}

export function fetchLibraryEntry(entryId: string): Promise<LibraryEntry> {
  return get<LibraryEntry>(`/api/admin/library/${encodeURIComponent(entryId)}`);
}

export function addLibraryEntry(submission: LibraryEntrySubmission): Promise<LibraryEntrySaved> {
  return post<LibraryEntrySaved>('/api/admin/library', submission);
}

export function updateLibraryEntry(
  entryId: string,
  update: LibraryEntryUpdate,
): Promise<LibraryEntrySaved> {
  return put<LibraryEntrySaved>(`/api/admin/library/${encodeURIComponent(entryId)}`, update);
}

export function deleteLibraryEntry(entryId: string): Promise<{ success: boolean }> {
  return del<{ success: boolean }>(`/api/admin/library/${encodeURIComponent(entryId)}`);
}

export function fetchAdminAnnouncements(
  limit: number = ADMIN_ANNOUNCEMENTS_LIMIT,
): Promise<AdminAnnouncementsResponse> {
  return get<AdminAnnouncementsResponse>('/api/admin/announcements', { limit });
}

export function createAnnouncement(submission: AnnouncementSubmission): Promise<AnnouncementSaved> {
  return post<AnnouncementSaved>('/api/admin/announcements', submission);
}

export function updateAnnouncement(
  announcementId: string,
  update: AnnouncementUpdate,
): Promise<AnnouncementSaved> {
  return put<AnnouncementSaved>(
    `/api/admin/announcements/${encodeURIComponent(announcementId)}`,
    update,
  );
}

export function deleteAnnouncement(announcementId: string): Promise<{ success: boolean }> {
  return del<{ success: boolean }>(
    `/api/admin/announcements/${encodeURIComponent(announcementId)}`,
  );
}

export const adminUsersQuery = (filters: AdminUserFilters = {}) =>
  queryOptions({
    queryKey: adminKeys.userList(filters),
    queryFn: () => fetchAdminUsers(filters),
    placeholderData: keepPreviousData,
  });

export const adminUserQuery = (userId: string) =>
  queryOptions({ queryKey: adminKeys.user(userId), queryFn: () => fetchAdminUser(userId) });

export const adminUserIpsQuery = (userId: string) =>
  queryOptions({ queryKey: adminKeys.userIps(userId), queryFn: () => fetchAdminUserIps(userId) });

export const adminJobsQuery = () =>
  queryOptions({
    queryKey: adminKeys.jobList(ADMIN_JOBS_LIMIT),
    queryFn: async ({ client }): Promise<AdminJobsResponse> => {
      const fetched = await fetchAdminJobs(ADMIN_JOBS_LIMIT);
      const stored = client.getQueryData<AdminJobsResponse>(adminKeys.jobList(ADMIN_JOBS_LIMIT));
      if (!stored) return fetched;
      return { jobs: mergeFetchedList(stored.jobs, fetched.jobs).slice(0, ADMIN_JOBS_LIMIT) };
    },
  });

export const adminJobQuery = (jobId: string) =>
  queryOptions({ queryKey: adminKeys.job(jobId), queryFn: () => fetchAdminJob(jobId) });

export const adminStatsQuery = () =>
  queryOptions({
    queryKey: adminKeys.stats(),
    queryFn: fetchAdminStats,
    staleTime: ADMIN_STATS_FRESH_MS,
  });

export const jobsPerDayQuery = (days: number = ADMIN_CHART_DAYS) =>
  queryOptions({ queryKey: adminKeys.jobsPerDay(days), queryFn: () => fetchJobsPerDay(days) });

export const userGrowthQuery = (days: number = ADMIN_CHART_DAYS) =>
  queryOptions({ queryKey: adminKeys.userGrowth(days), queryFn: () => fetchUserGrowth(days) });

export const defaultConfigQuery = () =>
  queryOptions({ queryKey: adminKeys.defaultConfig(), queryFn: fetchDefaultConfig });

export const defaultSyncQuery = () =>
  queryOptions({ queryKey: adminKeys.defaultSync(), queryFn: fetchDefaultSync });

export const adminFeaturedListsQuery = () =>
  queryOptions({ queryKey: adminKeys.featured(), queryFn: fetchAdminFeaturedLists });

export const adminLimitRequestsQuery = (status?: LimitRequestStatus) =>
  queryOptions({
    queryKey: adminKeys.limitRequestList(status ?? null),
    queryFn: () => fetchAdminLimitRequests(status),
  });

export const limitReviewsQuery = (
  page: number = 1,
  perPage: number = ADMIN_LIMIT_REVIEWS_PAGE_SIZE,
) =>
  queryOptions({
    queryKey: adminKeys.limitReviewPage(page, perPage),
    queryFn: () => fetchLimitReviews(page, perPage),
    placeholderData: keepPreviousData,
  });

export const libraryQuery = (category?: string) =>
  queryOptions({
    queryKey: adminKeys.libraryList(category ?? null),
    queryFn: () => fetchLibrary(category),
  });

export const libraryEntryQuery = (entryId: string) =>
  queryOptions({
    queryKey: adminKeys.libraryEntry(entryId),
    queryFn: () => fetchLibraryEntry(entryId),
  });

export const adminAnnouncementsQuery = (limit: number = ADMIN_ANNOUNCEMENTS_LIMIT) =>
  queryOptions({
    queryKey: adminKeys.announcementList(limit),
    queryFn: () => fetchAdminAnnouncements(limit),
  });
