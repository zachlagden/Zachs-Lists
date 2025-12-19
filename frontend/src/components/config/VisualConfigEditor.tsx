import { useState, useMemo } from 'react';
import { ConfigLine, CATEGORIES, parseConfig, serializeConfig, groupByCategory, CategoryValue } from './types';
import LibraryModal from './LibraryModal';
import AddUrlForm from './AddUrlForm';

interface VisualConfigEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export default function VisualConfigEditor({
  value,
  onChange,
  className = '',
}: VisualConfigEditorProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryValue>('comprehensive');
  const [showLibrary, setShowLibrary] = useState(false);
  const [showAddUrl, setShowAddUrl] = useState(false);

  // Parse config into structured data
  const parsedLines = useMemo(() => parseConfig(value), [value]);
  const groupedLines = useMemo(() => groupByCategory(parsedLines), [parsedLines]);

  // Get comments (preserved at top)
  const comments = useMemo(() => parsedLines.filter((l) => l.isComment), [parsedLines]);

  // Count sources per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      counts[cat.value] = groupedLines[cat.value]?.length || 0;
    }
    return counts;
  }, [groupedLines]);

  // Add a new source
  const handleAddSource = (url: string, name: string, category: string) => {
    const newLine: ConfigLine = { url, name, category };
    const newLines = [...parsedLines.filter((l) => !l.isComment), newLine];

    // Rebuild config with comments at top
    const configParts: string[] = [];
    for (const comment of comments) {
      configParts.push(comment.raw || '');
    }
    for (const line of newLines) {
      configParts.push(`${line.url}|${line.name}|${line.category}`);
    }

    onChange(configParts.join('\n'));
    setShowAddUrl(false);
    setShowLibrary(false);
  };

  // Add multiple sources from library
  const handleAddFromLibrary = (sources: Array<{ url: string; name: string; category: string }>) => {
    const existingUrls = new Set(parsedLines.map((l) => l.url));
    const newSources = sources.filter((s) => !existingUrls.has(s.url));

    if (newSources.length === 0) return;

    const allLines = [...parsedLines.filter((l) => !l.isComment), ...newSources];

    // Rebuild config with comments at top
    const configParts: string[] = [];
    for (const comment of comments) {
      configParts.push(comment.raw || '');
    }
    for (const line of allLines) {
      configParts.push(`${line.url}|${line.name}|${line.category}`);
    }

    onChange(configParts.join('\n'));
    setShowLibrary(false);
  };

  // Remove a source
  const handleRemoveSource = (url: string) => {
    const newLines = parsedLines.filter((l) => l.url !== url);
    onChange(serializeConfig(newLines));
  };

  // Current category sources
  const currentSources = groupedLines[activeCategory] || [];

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-pihole-border pb-3">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setActiveCategory(cat.value)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-2 ${
              activeCategory === cat.value
                ? 'bg-pihole-accent text-white'
                : 'bg-pihole-dark text-pihole-text-muted hover:text-pihole-text hover:bg-pihole-darker'
            }`}
          >
            {cat.label}
            {categoryCounts[cat.value] > 0 && (
              <span
                className={`px-1.5 py-0.5 text-xs rounded-full ${
                  activeCategory === cat.value
                    ? 'bg-white/20'
                    : 'bg-pihole-border'
                }`}
              >
                {categoryCounts[cat.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Category Description */}
      <div className="text-sm text-pihole-text-muted">
        {CATEGORIES.find((c) => c.value === activeCategory)?.description}
        {activeCategory === 'nsfw' && (
          <span className="ml-2 text-yellow-500">
            Note: NSFW domains are not included in the combined all_domains list.
          </span>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setShowLibrary(true);
          }}
          className="btn btn-primary text-sm"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Add from Library
        </button>
        <button
          onClick={() => setShowAddUrl(true)}
          className="btn btn-ghost text-sm"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Custom URL
        </button>
      </div>

      {/* Source List */}
      <div className="space-y-2">
        {currentSources.length === 0 ? (
          <div className="text-center py-8 text-pihole-text-muted">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p>No sources in {CATEGORIES.find((c) => c.value === activeCategory)?.label}</p>
            <p className="text-sm mt-1">Add sources from the library or enter a custom URL</p>
          </div>
        ) : (
          currentSources.map((source) => (
            <div
              key={source.url}
              className="flex items-center justify-between p-3 bg-pihole-dark rounded-lg group"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-pihole-text truncate">
                  {source.name}
                </div>
                <div className="text-sm text-pihole-text-muted truncate">
                  {source.url}
                </div>
              </div>
              <button
                onClick={() => handleRemoveSource(source.url)}
                className="ml-3 p-1.5 text-pihole-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove source"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Summary */}
      <div className="text-sm text-pihole-text-muted pt-4 border-t border-pihole-border">
        Total sources: {parsedLines.filter((l) => !l.isComment).length}
      </div>

      {/* Library Modal */}
      {showLibrary && (
        <LibraryModal
          onClose={() => setShowLibrary(false)}
          onAdd={handleAddFromLibrary}
          existingUrls={new Set(parsedLines.map((l) => l.url))}
          defaultCategory={activeCategory}
        />
      )}

      {/* Add URL Form */}
      {showAddUrl && (
        <AddUrlForm
          onClose={() => setShowAddUrl(false)}
          onAdd={handleAddSource}
          existingUrls={new Set(parsedLines.map((l) => l.url))}
          existingNames={new Set(parsedLines.map((l) => l.name))}
          defaultCategory={activeCategory}
        />
      )}
    </div>
  );
}
