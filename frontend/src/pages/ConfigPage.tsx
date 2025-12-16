import { useEffect, useState } from 'react';
import { useUserDataStore } from '../store';
import { userApi } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';

type TabType = 'blocklists' | 'whitelist';

export default function ConfigPage() {
  const { config, whitelist, setConfig, setWhitelist, setRemainingUpdates } = useUserDataStore();
  const [activeTab, setActiveTab] = useState<TabType>('blocklists');
  const [localConfig, setLocalConfig] = useState(config);
  const [localWhitelist, setLocalWhitelist] = useState(whitelist);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copyingTemplate, setCopyingTemplate] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

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

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      if (activeTab === 'blocklists') {
        await userApi.updateConfig(localConfig);
        setConfig(localConfig);
      } else {
        await userApi.updateWhitelist(localWhitelist);
        setWhitelist(localWhitelist);
      }
      setMessage({ type: 'success', text: 'Configuration saved successfully' });
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save:', error);
      setMessage({ type: 'error', text: 'Failed to save configuration' });
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
  };

  const handleTriggerBuild = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const result = await userApi.triggerBuild();
      setRemainingUpdates(result.remaining_updates);
      setMessage({ type: 'success', text: 'Build triggered! Check the Jobs page for progress.' });
    } catch (error) {
      console.error('Failed to trigger build:', error);
      setMessage({ type: 'error', text: 'Failed to trigger build' });
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
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-pihole-text">Blocklist Sources</h2>
                <p className="text-sm text-pihole-text-muted mt-1">
                  Enter URLs of blocklists to include, one per line. Lines starting with # are comments.
                </p>
              </div>
            </div>
            <textarea
              value={localConfig}
              onChange={(e) => setLocalConfig(e.target.value)}
              className="w-full h-96 bg-pihole-darkest border border-pihole-border rounded-lg p-4 font-mono text-sm text-pihole-text focus:outline-none focus:border-pihole-accent resize-none"
              placeholder="# Enter blocklist URLs here&#10;https://example.com/blocklist.txt&#10;https://another.com/hosts.txt"
              spellCheck={false}
            />
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
            <textarea
              value={localWhitelist}
              onChange={(e) => setLocalWhitelist(e.target.value)}
              className="w-full h-96 bg-pihole-darkest border border-pihole-border rounded-lg p-4 font-mono text-sm text-pihole-text focus:outline-none focus:border-pihole-accent resize-none"
              placeholder="# Exact domain match&#10;example.com&#10;&#10;# Wildcard (matches subdomains)&#10;*.example.com&#10;&#10;# Regex pattern&#10;/^ads?\d*\./"
              spellCheck={false}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between mt-6 pt-6 border-t border-pihole-border">
          <div className="text-sm text-pihole-text-muted">
            {hasChanges && 'You have unsaved changes'}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              disabled={!hasChanges || saving}
              className="btn btn-ghost"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="btn btn-primary"
            >
              {saving ? <LoadingSpinner size="sm" /> : 'Save Changes'}
            </button>
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
              <li>• One URL per line</li>
              <li>• Lines starting with # are comments</li>
              <li>• Supports hosts files, plain domains, and AdBlock format</li>
              <li>• HTTP and HTTPS URLs only</li>
            </ul>
          </div>
          <div>
            <h4 className="text-pihole-text font-medium mb-2">Whitelist Patterns</h4>
            <ul className="space-y-1 text-pihole-text-muted">
              <li>• <code className="text-pihole-accent">example.com</code> - Exact match</li>
              <li>• <code className="text-pihole-accent">*.example.com</code> - Wildcard (subdomains)</li>
              <li>• <code className="text-pihole-accent">/^ads?\d*\./</code> - Regex pattern</li>
              <li>• Lines starting with # are comments</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
