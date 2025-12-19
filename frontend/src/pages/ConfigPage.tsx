import { useEffect, useState, useCallback } from 'react';
import { useUserDataStore, useAuthStore } from '../store';
import { userApi } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { AdvancedConfigEditor, VisualConfigEditor, WhitelistEditor, ValidationResult as ConfigValidationResult } from '../components/config';
import { useValidationSocket } from '../hooks/useSocket';

const EDITOR_MODE_KEY = 'blocklist-editor-mode';

type TabType = 'blocklists' | 'whitelist';
type EditorMode = 'visual' | 'advanced';

interface ValidationProgress {
  current: number;
  total: number;
  url: string;
}

export default function ConfigPage() {
  const { config, whitelist, setConfig, setWhitelist, setRemainingUpdates } = useUserDataStore();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('blocklists');
  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    const saved = localStorage.getItem(EDITOR_MODE_KEY);
    return saved === 'visual' || saved === 'advanced' ? saved : 'visual';
  });
  const [localConfig, setLocalConfig] = useState(config);
  const [localWhitelist, setLocalWhitelist] = useState(whitelist);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [copyingTemplate, setCopyingTemplate] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Validation state
  const [validationProgress, setValidationProgress] = useState<ValidationProgress | null>(null);
  const [validationResult, setValidationResult] = useState<ConfigValidationResult | null>(null);
  const [validationToken, setValidationToken] = useState<string | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);

  // Socket for validation progress (progress only, result comes from API)
  useValidationSocket({
    userId: user?.id,
    onProgress: useCallback((progress: ValidationProgress) => {
      setValidationProgress(progress);
    }, []),
    onComplete: useCallback(() => {
      // Result is set from API response which includes the token
      setValidating(false);
    }, []),
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const [configData, whitelistData] = await Promise.all([
          userApi.getConfig(),
          userApi.getWhitelist(),
        ]);
        setConfig(configData.config || '');
        setWhitelist(whitelistData.whitelist || '');
        setLocalConfig(configData.config || '');
        setLocalWhitelist(whitelistData.whitelist || '');
      } catch (error) {
        console.error('Failed to fetch config:', error);
        setMessage({ type: 'error', text: 'Failed to load configuration' });
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, [setConfig, setWhitelist]);

  useEffect(() => {
    const isChanged =
      (activeTab === 'blocklists' && localConfig !== config) ||
      (activeTab === 'whitelist' && localWhitelist !== whitelist);
    setHasChanges(isChanged);
  }, [localConfig, localWhitelist, config, whitelist, activeTab]);

  // Clear validation token when config changes (user edited after validation)
  useEffect(() => {
    setValidationToken(null);
    setValidationResult(null);
  }, [localConfig]);

  const handleValidate = async () => {
    setValidating(true);
    setValidationProgress(null);
    setValidationResult(null);
    setValidationToken(null);
    setShowValidationModal(true);

    try {
      // The validation endpoint will emit socket events for progress
      const result = await userApi.validateConfig(localConfig);
      setValidationResult(result);
      // Store the validation token (ties this exact config to this validation)
      if (result.validation_token) {
        setValidationToken(result.validation_token);
      }
      setValidating(false);
    } catch (error) {
      console.error('Validation failed:', error);
      setValidating(false);
      setShowValidationModal(false);
      setMessage({ type: 'error', text: 'Validation failed. Please try again.' });
    }
  };

  const handleSave = async () => {
    // For blocklists, require validation token (enforced by backend too)
    if (activeTab === 'blocklists') {
      if (!validationToken) {
        setMessage({ type: 'error', text: 'Please validate your configuration first.' });
        return;
      }
      if (validationResult?.has_errors) {
        setMessage({ type: 'error', text: 'Cannot save: Configuration has errors. Fix them first.' });
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    setShowValidationModal(false);

    try {
      if (activeTab === 'blocklists') {
        await userApi.updateConfig(localConfig, validationToken!);
        setConfig(localConfig);
      } else {
        await userApi.updateWhitelist(localWhitelist);
        setWhitelist(localWhitelist);
      }
      setMessage({ type: 'success', text: 'Configuration saved successfully' });
      setHasChanges(false);
      setValidationResult(null);
      setValidationToken(null);
    } catch (error: any) {
      console.error('Failed to save:', error);
      const errorMsg = error.response?.data?.error || 'Failed to save configuration';
      const details = error.response?.data?.details;
      setMessage({
        type: 'error',
        text: details ? `${errorMsg}: ${details.join(', ')}` : errorMsg,
      });
      // If token-related error, clear the token so user must re-validate
      if (errorMsg.includes('validation') || errorMsg.includes('Validation')) {
        setValidationToken(null);
        setValidationResult(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCopyTemplate = async (overwrite: boolean = false) => {
    setCopyingTemplate(true);
    setMessage(null);

    try {
      await userApi.copyDefaultTemplate(overwrite);
      // Refresh config
      const [configData, whitelistData] = await Promise.all([
        userApi.getConfig(),
        userApi.getWhitelist(),
      ]);
      setConfig(configData.config || '');
      setWhitelist(whitelistData.whitelist || '');
      setLocalConfig(configData.config || '');
      setLocalWhitelist(whitelistData.whitelist || '');
      setMessage({ type: 'success', text: 'Default template copied successfully' });
    } catch (error) {
      console.error('Failed to copy template:', error);
      setMessage({ type: 'error', text: 'Failed to copy template' });
    } finally {
      setCopyingTemplate(false);
    }
  };

  const handleReset = () => {
    if (activeTab === 'blocklists') {
      setLocalConfig(config);
    } else {
      setLocalWhitelist(whitelist);
    }
    setHasChanges(false);
    setValidationResult(null);
    setValidationToken(null);
  };

  const handleTriggerBuild = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const result = await userApi.triggerBuild();
      setRemainingUpdates(result.remaining_updates);
      setMessage({ type: 'success', text: 'Build triggered! Check the Jobs page for progress.' });
    } catch (error: any) {
      console.error('Failed to trigger build:', error);
      const errorMsg = error.response?.data?.error || 'Failed to trigger build';
      setMessage({ type: 'error', text: errorMsg });
    } finally {
      setSaving(false);
    }
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pihole-text">Configuration</h1>
          <p className="text-pihole-text-muted">Manage your blocklist sources and whitelist</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleCopyTemplate(true)}
            disabled={copyingTemplate}
            className="btn btn-ghost"
          >
            {copyingTemplate ? <LoadingSpinner size="sm" /> : 'Use Default Template'}
          </button>
          <button
            onClick={handleTriggerBuild}
            disabled={saving}
            className="btn btn-primary"
          >
            Build Now
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`px-4 py-3 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : message.type === 'warning'
              ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-pihole-border">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('blocklists')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'blocklists'
                ? 'border-pihole-accent text-pihole-accent'
                : 'border-transparent text-pihole-text-muted hover:text-pihole-text'
            }`}
          >
            Blocklist Sources
          </button>
          <button
            onClick={() => setActiveTab('whitelist')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'whitelist'
                ? 'border-pihole-accent text-pihole-accent'
                : 'border-transparent text-pihole-text-muted hover:text-pihole-text'
            }`}
          >
            Whitelist
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="card">
        {activeTab === 'blocklists' ? (
          <div className="space-y-4">
            {/* Editor Mode Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-pihole-text">Blocklist Sources</h2>
                <p className="text-sm text-pihole-text-muted mt-1">
                  {editorMode === 'visual'
                    ? 'Browse and select blocklists by category'
                    : 'Format: url|name|category — one per line. Lines starting with # are comments.'}
                </p>
              </div>
              <div className="flex items-center gap-2 bg-pihole-dark rounded-lg p-1">
                <button
                  onClick={() => {
                    setEditorMode('visual');
                    localStorage.setItem(EDITOR_MODE_KEY, 'visual');
                  }}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    editorMode === 'visual'
                      ? 'bg-pihole-accent text-white'
                      : 'text-pihole-text-muted hover:text-pihole-text'
                  }`}
                >
                  Visual
                </button>
                <button
                  onClick={() => {
                    setEditorMode('advanced');
                    localStorage.setItem(EDITOR_MODE_KEY, 'advanced');
                  }}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    editorMode === 'advanced'
                      ? 'bg-pihole-accent text-white'
                      : 'text-pihole-text-muted hover:text-pihole-text'
                  }`}
                >
                  Advanced
                </button>
              </div>
            </div>

            {/* Editor Component */}
            {editorMode === 'visual' ? (
              <VisualConfigEditor
                value={localConfig}
                onChange={setLocalConfig}
              />
            ) : (
              <AdvancedConfigEditor
                value={localConfig}
                onChange={setLocalConfig}
                placeholder="# Enter blocklist sources here&#10;https://example.com/blocklist.txt|my_blocklist|advertising"
              />
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-pihole-text">Whitelist</h2>
                <p className="text-sm text-pihole-text-muted mt-1">
                  Domains to exclude from blocking. Supports exact, wildcard (*), and regex patterns.
                </p>
              </div>
            </div>
            <WhitelistEditor
              value={localWhitelist}
              onChange={setLocalWhitelist}
              placeholder="# Exact domain match&#10;example.com&#10;&#10;# Wildcard (matches subdomains)&#10;*.example.com&#10;&#10;# Regex pattern&#10;/^ads?\d*\./"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between mt-6 pt-6 border-t border-pihole-border">
          <div className="text-sm text-pihole-text-muted">
            {hasChanges && 'You have unsaved changes'}
            {validationToken && !hasChanges && (
              <span className="text-green-400"> (validated, ready to save)</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              disabled={!hasChanges || saving}
              className="btn btn-ghost"
            >
              Reset
            </button>
            {activeTab === 'blocklists' ? (
              // Blocklist: Single "Validate & Save" flow
              <button
                onClick={handleValidate}
                disabled={!hasChanges || validating || saving}
                className="btn btn-primary"
              >
                {validating ? <LoadingSpinner size="sm" /> : 'Validate & Save'}
              </button>
            ) : (
              // Whitelist: Direct save (no validation needed)
              <button
                onClick={() => handleSave()}
                disabled={!hasChanges || saving}
                className="btn btn-primary"
              >
                {saving ? <LoadingSpinner size="sm" /> : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Help Section */}
      <div className="card">
        <h3 className="font-semibold text-pihole-text mb-4">Configuration Help</h3>
        <div className="grid md:grid-cols-2 gap-6 text-sm">
          <div>
            <h4 className="text-pihole-text font-medium mb-2">Blocklist Format</h4>
            <ul className="space-y-1 text-pihole-text-muted">
              <li>Format: <code className="text-pihole-accent">url|name|category</code></li>
              <li><code className="text-pihole-accent">url</code> - HTTP/HTTPS URL to blocklist</li>
              <li><code className="text-pihole-accent">name</code> - Unique identifier (alphanumeric, dashes, underscores)</li>
              <li><code className="text-pihole-accent">category</code> - comprehensive, malicious, advertising, tracking, suspicious, nsfw</li>
              <li>Lines starting with # are comments</li>
              <li className="text-yellow-500">NSFW category domains are excluded from all_domains lists</li>
            </ul>
          </div>
          <div>
            <h4 className="text-pihole-text font-medium mb-2">Whitelist Patterns</h4>
            <ul className="space-y-1 text-pihole-text-muted">
              <li><code className="text-pihole-accent">example.com</code> - Exact match</li>
              <li><code className="text-pihole-accent">*.example.com</code> - Wildcard (subdomains)</li>
              <li><code className="text-pihole-accent">/^ads?\d*\./</code> - Regex pattern</li>
              <li>Lines starting with # are comments</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Validation Modal */}
      {showValidationModal && (
        <ValidationModal
          validating={validating}
          progress={validationProgress}
          result={validationResult}
          onClose={() => {
            setShowValidationModal(false);
            setValidating(false);
          }}
          onSave={() => handleSave()}
        />
      )}
    </div>
  );
}

// Validation Modal Component
interface ValidationModalProps {
  validating: boolean;
  progress: ValidationProgress | null;
  result: ConfigValidationResult | null;
  onClose: () => void;
  onSave: () => void;
}

function ValidationModal({
  validating,
  progress,
  result,
  onClose,
  onSave,
}: ValidationModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-pihole-card rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-pihole-border">
          <h2 className="text-lg font-semibold text-pihole-text">
            {validating ? 'Validating Configuration...' : 'Validation Results'}
          </h2>
          {!validating && (
            <button
              onClick={onClose}
              className="p-2 text-pihole-text-muted hover:text-pihole-text rounded-lg hover:bg-pihole-dark"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {validating && progress ? (
            <div className="space-y-4">
              <div className="text-center">
                <LoadingSpinner size="lg" />
                <p className="mt-4 text-pihole-text">
                  Checking URL {progress.current} of {progress.total}
                </p>
                <p className="text-sm text-pihole-text-muted mt-2 truncate max-w-full">
                  {progress.url}
                </p>
              </div>
              <div className="w-full bg-pihole-dark rounded-full h-2">
                <div
                  className="bg-pihole-accent h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          ) : validating ? (
            <div className="text-center py-8">
              <LoadingSpinner size="lg" />
              <p className="mt-4 text-pihole-text">Starting validation...</p>
            </div>
          ) : result ? (
            <div className="space-y-4">
              {/* Summary */}
              <div className={`p-4 rounded-lg ${
                result.has_errors
                  ? 'bg-red-500/10 border border-red-500/30'
                  : result.has_warnings
                  ? 'bg-yellow-500/10 border border-yellow-500/30'
                  : 'bg-green-500/10 border border-green-500/30'
              }`}>
                <div className="flex items-center gap-3">
                  {result.has_errors ? (
                    <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : result.has_warnings ? (
                    <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  <div>
                    <p className={`font-medium ${
                      result.has_errors ? 'text-red-400' : result.has_warnings ? 'text-yellow-400' : 'text-green-400'
                    }`}>
                      {result.has_errors
                        ? `${result.error_count} error${result.error_count !== 1 ? 's' : ''} found`
                        : result.has_warnings
                        ? `${result.warning_count} warning${result.warning_count !== 1 ? 's' : ''} found`
                        : 'All URLs validated successfully'}
                    </p>
                    <p className="text-sm text-pihole-text-muted">
                      {result.validated_count} URL{result.validated_count !== 1 ? 's' : ''} checked
                    </p>
                  </div>
                </div>
              </div>

              {/* Issues List */}
              {result.issues.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-pihole-text">Issues</h3>
                  {result.issues.map((issue, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-lg text-sm ${
                        issue.severity === 'error'
                          ? 'bg-red-500/10 text-red-300'
                          : 'bg-yellow-500/10 text-yellow-300'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`px-1.5 py-0.5 text-xs rounded font-medium ${
                          issue.severity === 'error' ? 'bg-red-500/30' : 'bg-yellow-500/30'
                        }`}>
                          {issue.severity === 'error' ? 'ERROR' : 'WARN'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p>{issue.message}</p>
                          {issue.url && (
                            <p className="text-xs opacity-70 truncate mt-1">{issue.url}</p>
                          )}
                          {issue.line && (
                            <p className="text-xs opacity-70 mt-1">Line {issue.line}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {!validating && result && (
          <div className="flex items-center justify-end gap-3 p-4 border-t border-pihole-border">
            {result.has_errors ? (
              // Errors found - user must fix and re-validate
              <button onClick={onClose} className="btn btn-primary">
                Fix Errors
              </button>
            ) : (
              // No errors - can save (warnings are OK)
              <>
                <button onClick={onClose} className="btn btn-ghost">
                  Cancel
                </button>
                <button onClick={onSave} className="btn btn-primary">
                  Save Configuration
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
