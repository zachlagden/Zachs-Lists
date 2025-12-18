import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminApi } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import type { Job, OutputFile } from '../types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

export default function AdminJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchJob = async () => {
      if (!jobId) return;
      try {
        const data = await adminApi.getJob(jobId);
        setJob(data);
      } catch (err) {
        console.error('Failed to fetch job:', err);
        setError('Failed to load job details');
      } finally {
        setLoading(false);
      }
    };
    fetchJob();
  }, [jobId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="space-y-4">
        <Link to="/admin" className="text-pihole-accent hover:underline text-sm">
          &larr; Back to Admin
        </Link>
        <div className="card">
          <p className="text-red-400">{error || 'Job not found'}</p>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    queued: 'bg-yellow-500/20 text-yellow-400',
    processing: 'bg-blue-500/20 text-blue-400',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
  };

  const typeColors: Record<string, string> = {
    manual: 'bg-purple-500/20 text-purple-400',
    scheduled: 'bg-blue-500/20 text-blue-400',
    admin: 'bg-orange-500/20 text-orange-400',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin" className="text-pihole-accent hover:underline text-sm">
            &larr; Back to Admin
          </Link>
          <h1 className="text-2xl font-bold text-pihole-text mt-2">Job Details</h1>
          <p className="text-pihole-text-muted text-sm font-mono">{job.job_id}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${typeColors[job.type] || 'bg-gray-500/20 text-gray-400'}`}>
            {job.type}
          </span>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[job.status]}`}>
            {job.status}
          </span>
        </div>
      </div>

      {/* Job Info */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-semibold text-pihole-text mb-4">Job Information</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-pihole-text-muted">User</dt>
              <dd className="text-pihole-text">
                {job.username === '__default__' ? (
                  <span className="text-blue-400">Default Lists</span>
                ) : (
                  <Link to={`/admin/users/${job.user_id}`} className="text-pihole-accent hover:underline">
                    {job.username}
                  </Link>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-pihole-text-muted">Created</dt>
              <dd className="text-pihole-text">{new Date(job.created_at).toLocaleString()}</dd>
            </div>
            {job.started_at && (
              <div className="flex justify-between">
                <dt className="text-pihole-text-muted">Started</dt>
                <dd className="text-pihole-text">{new Date(job.started_at).toLocaleString()}</dd>
              </div>
            )}
            {job.completed_at && (
              <div className="flex justify-between">
                <dt className="text-pihole-text-muted">Completed</dt>
                <dd className="text-pihole-text">{new Date(job.completed_at).toLocaleString()}</dd>
              </div>
            )}
            {job.started_at && job.completed_at && (
              <div className="flex justify-between">
                <dt className="text-pihole-text-muted">Duration</dt>
                <dd className="text-pihole-text">{formatDuration(job.started_at, job.completed_at)}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="card">
          <h2 className="font-semibold text-pihole-text mb-4">Progress</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-pihole-text-muted">Current Step</dt>
              <dd className="text-pihole-text capitalize">{job.progress.current_step}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-pihole-text-muted">Sources</dt>
              <dd className="text-pihole-text">
                {job.progress.processed_sources} / {job.progress.total_sources}
              </dd>
            </div>
            {job.progress.current_source && (
              <div className="flex justify-between">
                <dt className="text-pihole-text-muted">Current Source</dt>
                <dd className="text-pihole-text text-xs truncate max-w-[200px]" title={job.progress.current_source}>
                  {job.progress.current_source}
                </dd>
              </div>
            )}
          </dl>
          {job.progress.total_sources > 0 && (
            <div className="mt-4">
              <div className="h-2 bg-pihole-darkest rounded-full overflow-hidden">
                <div
                  className="h-full bg-pihole-accent transition-all"
                  style={{ width: `${(job.progress.processed_sources / job.progress.total_sources) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {job.result && (
        <div className="card">
          <h2 className="font-semibold text-pihole-text mb-4">Results</h2>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-pihole-darkest rounded-lg p-4">
              <div className="text-sm text-pihole-text-muted">Sources Processed</div>
              <div className="text-xl font-bold text-pihole-text">{job.result.sources_processed}</div>
            </div>
            <div className="bg-pihole-darkest rounded-lg p-4">
              <div className="text-sm text-pihole-text-muted">Sources Failed</div>
              <div className={`text-xl font-bold ${job.result.sources_failed > 0 ? 'text-red-400' : 'text-pihole-text'}`}>
                {job.result.sources_failed}
              </div>
            </div>
            <div className="bg-pihole-darkest rounded-lg p-4">
              <div className="text-sm text-pihole-text-muted">Total Domains</div>
              <div className="text-xl font-bold text-pihole-text">{job.result.total_domains.toLocaleString()}</div>
            </div>
            <div className="bg-pihole-darkest rounded-lg p-4">
              <div className="text-sm text-pihole-text-muted">Unique Domains</div>
              <div className="text-xl font-bold text-green-400">{job.result.unique_domains.toLocaleString()}</div>
            </div>
            <div className="bg-pihole-darkest rounded-lg p-4">
              <div className="text-sm text-pihole-text-muted">Whitelisted Removed</div>
              <div className="text-xl font-bold text-pihole-text">{job.result.whitelisted_removed.toLocaleString()}</div>
            </div>
          </div>

          {/* Output Files */}
          {job.result.output_files && job.result.output_files.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-pihole-text-muted mb-3">Output Files</h3>
              <div className="space-y-2">
                {job.result.output_files.map((file: OutputFile, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 bg-pihole-darkest rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-pihole-text font-medium">{file.name}</span>
                      <span className="px-2 py-0.5 bg-pihole-border rounded text-xs text-pihole-text-muted">
                        {file.format}
                      </span>
                    </div>
                    <div className="text-sm text-pihole-text-muted">
                      {formatBytes(file.size_bytes)} &bull; {file.domain_count?.toLocaleString()} domains
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Categories */}
          {job.result.categories && Object.keys(job.result.categories).length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-pihole-text-muted mb-3">Categories</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(job.result.categories).map(([category, count]) => (
                  <div key={category} className="flex items-center justify-between p-2 bg-pihole-darkest rounded">
                    <span className="text-sm text-pihole-text capitalize">{category}</span>
                    <span className="text-sm text-pihole-text-muted">{(count as number).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Errors */}
          {job.result.errors && job.result.errors.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-red-400 mb-3">Errors ({job.result.errors.length})</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {job.result.errors.map((err, idx) => (
                  <div key={idx} className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300 font-mono">
                    {err}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
