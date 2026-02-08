import { useEffect, useState, useCallback } from 'react';
import { useJobsStore, useAuthStore } from '../store';
import { userApi } from '../api/client';
import { useJobSocket } from '../hooks/useSocket';
import LoadingSpinner from '../components/LoadingSpinner';
import { JobList, JobDetailView } from '../components/jobs';
import type { Job, SourceProgress, WhitelistProgress, FormatProgress } from '../types';

export default function JobsPage() {
  const { user } = useAuthStore();
  const { jobs, setJobs, addJob, updateJob, setHasUnreadFailures, clearJobProgress } =
    useJobsStore();
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const data = await userApi.getJobs(50);
      setJobs(data.jobs || []);

      // Check for unread failures
      const hasFailures = (data.jobs || []).some(
        (job: Job) => job.status === 'failed' && !job.read,
      );
      setHasUnreadFailures(hasFailures);

      // Auto-select first active job or most recent
      if (data.jobs && data.jobs.length > 0 && !selectedJob) {
        const activeJob = data.jobs.find(
          (j: Job) => j.status === 'queued' || j.status === 'processing',
        );
        setSelectedJob(activeJob || data.jobs[0]);
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setLoading(false);
    }
  }, [setJobs, setHasUnreadFailures, selectedJob]);

  // Handle real-time job events
  const handleJobCreated = useCallback(
    (job: Job) => {
      addJob(job);
      // Auto-select newly created jobs
      setSelectedJob(job);
    },
    [addJob],
  );

  const handleJobProgress = useCallback(
    (job: Job) => {
      // Update job in store
      updateJob(job);
      // Update selected job if it matches
      setSelectedJob((prev) => (prev?.job_id === job.job_id ? job : prev));
    },
    [updateJob],
  );

  const handleJobCompleted = useCallback(
    (job: Job) => {
      updateJob(job);
      setSelectedJob((prev) => (prev?.job_id === job.job_id ? job : prev));
      if (job.status === 'failed') {
        setHasUnreadFailures(true);
      }
      // Clear granular progress state after a delay
      setTimeout(() => {
        clearJobProgress(job.job_id);
      }, 5000);
    },
    [updateJob, setHasUnreadFailures, clearJobProgress],
  );

  const handleJobSkipped = useCallback((data: { job_id: string; reason: string }) => {
    setSelectedJob((prev) =>
      prev?.job_id === data.job_id
        ? {
            ...prev,
            status: 'skipped',
            result: { ...prev.result, skip_reason: data.reason } as Job['result'],
          }
        : prev,
    );
  }, []);

  // Subscribe to real-time updates
  useJobSocket({
    userId: user?.id,
    onJobCreated: handleJobCreated,
    onJobProgress: handleJobProgress,
    onJobCompleted: handleJobCompleted,
    onJobSkipped: handleJobSkipped,
  });

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Mark jobs as read
  useEffect(() => {
    const markRead = async () => {
      try {
        await userApi.markJobsRead();
        setHasUnreadFailures(false);
      } catch (error) {
        console.error('Failed to mark jobs as read:', error);
      }
    };
    markRead();
  }, [setHasUnreadFailures]);

  const handleSelectJob = (job: Job) => {
    setSelectedJob(job);
  };

  // Get progress data from the selected job's progress field
  // Progress is now embedded in the job object
  const progressData = selectedJob?.progress;
  const selectedJobSources: SourceProgress[] = progressData?.sources || [];
  const selectedJobWhitelist: WhitelistProgress | null = progressData?.whitelist || null;
  const selectedJobFormats: Record<string, FormatProgress> = {};

  // Convert formats array to record
  if (progressData?.generation?.formats) {
    for (const fmt of progressData.generation.formats) {
      selectedJobFormats[fmt.format] = fmt;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-pihole-text">Jobs</h1>
        <p className="text-pihole-text-muted">View your build history and real-time job progress</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Job List Sidebar */}
        <div className="md:col-span-1">
          <div className="card max-h-[calc(100vh-200px)] overflow-hidden flex flex-col">
            <h2 className="font-semibold text-pihole-text mb-4 flex-shrink-0">
              Recent Jobs
              {jobs.some((j) => j.status === 'processing' || j.status === 'queued') && (
                <span className="ml-2 inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              )}
            </h2>
            <div className="overflow-y-auto flex-1 -mr-2 pr-2">
              <JobList
                jobs={jobs}
                selectedJobId={selectedJob?.job_id || null}
                onSelectJob={handleSelectJob}
              />
            </div>
          </div>
        </div>

        {/* Job Details */}
        <div className="md:col-span-2">
          {selectedJob ? (
            <JobDetailView
              job={selectedJob}
              sources={selectedJobSources}
              whitelist={selectedJobWhitelist}
              formats={selectedJobFormats}
            />
          ) : (
            <div className="card text-center py-12">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-pihole-border"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <div className="text-pihole-text-muted">Select a job to view details</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
