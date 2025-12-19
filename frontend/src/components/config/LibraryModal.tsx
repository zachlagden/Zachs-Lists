import { useState, useEffect, useMemo } from 'react';
import { userApi } from '../../api/client';
import { LibraryEntry, CATEGORIES, CategoryValue } from './types';
import LoadingSpinner from '../LoadingSpinner';

interface LibraryModalProps {
  onClose: () => void;
  onAdd: (sources: Array<{ url: string; name: string; category: string }>) => void;
  existingUrls: Set<string>;
  defaultCategory?: CategoryValue;
}

export default function LibraryModal({
  onClose,
  onAdd,
  existingUrls,
  defaultCategory,
}: LibraryModalProps) {
  const [library, setLibrary] = useState<Record<string, LibraryEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<CategoryValue>(defaultCategory || 'comprehensive');

  // Fetch library data
  useEffect(() => {
    const fetchLibrary = async () => {
      try {
        const data = await userApi.getLibrary();
        setLibrary(data.library || {});
      } catch (err) {
        console.error('Failed to fetch library:', err);
        setError('Failed to load library');
      } finally {
        setLoading(false);
      }
    };
    fetchLibrary();
  }, []);

  // Get entries for current category
  const currentEntries = useMemo(() => {
    return library[activeCategory] || [];
  }, [library, activeCategory]);

  // Toggle selection
  const toggleSelection = (entry: LibraryEntry) => {
    const newSelected = new Set(selectedUrls);
    if (newSelected.has(entry.url)) {
      newSelected.delete(entry.url);
    } else {
      newSelected.add(entry.url);
    }
    setSelectedUrls(newSelected);
  };

  // Select all in category
  const selectAllInCategory = () => {
    const newSelected = new Set(selectedUrls);
    for (const entry of currentEntries) {
      if (!existingUrls.has(entry.url)) {
        newSelected.add(entry.url);
      }
    }
    setSelectedUrls(newSelected);
  };

  // Clear selection in category
  const clearCategorySelection = () => {
    const newSelected = new Set(selectedUrls);
    for (const entry of currentEntries) {
      newSelected.delete(entry.url);
    }
    setSelectedUrls(newSelected);
  };

  // Handle add
  const handleAdd = () => {
    const sources: Array<{ url: string; name: string; category: string }> = [];

    // Find all selected entries across all categories
    for (const [category, entries] of Object.entries(library)) {
      for (const entry of entries) {
        if (selectedUrls.has(entry.url)) {
          sources.push({
            url: entry.url,
            name: entry.name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
            category,
          });
        }
      }
    }

    onAdd(sources);
  };

  // Format domain count
  const formatCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  // Render aggressiveness stars
  const renderStars = (level: number) => {
    return (
      <div className="flex gap-0.5" title={`Aggressiveness: ${level}/5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <svg
            key={i}
            className={`w-3 h-3 ${i <= level ? 'text-yellow-500' : 'text-pihole-border'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-pihole-card rounded-xl shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-pihole-border">
          <div>
            <h2 className="text-lg font-semibold text-pihole-text">Blocklist Library</h2>
            <p className="text-sm text-pihole-text-muted">
              Select blocklists to add to your configuration
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-pihole-text-muted hover:text-pihole-text rounded-lg hover:bg-pihole-dark"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-1 p-2 border-b border-pihole-border overflow-x-auto">
          {CATEGORIES.map((cat) => {
            const count = library[cat.value]?.length || 0;
            const selectedInCat = (library[cat.value] || []).filter((e) => selectedUrls.has(e.url)).length;

            return (
              <button
                key={cat.value}
                onClick={() => setActiveCategory(cat.value)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors whitespace-nowrap flex items-center gap-2 ${
                  activeCategory === cat.value
                    ? 'bg-pihole-accent text-white'
                    : 'text-pihole-text-muted hover:text-pihole-text hover:bg-pihole-dark'
                }`}
              >
                {cat.label}
                {count > 0 && (
                  <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                    activeCategory === cat.value ? 'bg-white/20' : 'bg-pihole-border'
                  }`}>
                    {selectedInCat > 0 ? `${selectedInCat}/${count}` : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner size="lg" />
            </div>
          ) : error ? (
            <div className="text-center text-red-400 py-8">{error}</div>
          ) : currentEntries.length === 0 ? (
            <div className="text-center text-pihole-text-muted py-8">
              No blocklists in this category yet.
            </div>
          ) : (
            <div className="space-y-2">
              {/* Selection controls */}
              <div className="flex items-center justify-between text-sm mb-3">
                <span className="text-pihole-text-muted">
                  {currentEntries.filter((e) => selectedUrls.has(e.url)).length} selected in{' '}
                  {CATEGORIES.find((c) => c.value === activeCategory)?.label}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={selectAllInCategory}
                    className="text-pihole-accent hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    onClick={clearCategorySelection}
                    className="text-pihole-text-muted hover:text-pihole-text"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Entry list */}
              {currentEntries.map((entry) => {
                const isAlreadyAdded = existingUrls.has(entry.url);
                const isSelected = selectedUrls.has(entry.url);

                return (
                  <div
                    key={entry.id}
                    onClick={() => !isAlreadyAdded && toggleSelection(entry)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors ${
                      isAlreadyAdded
                        ? 'bg-pihole-dark/50 opacity-60 cursor-not-allowed'
                        : isSelected
                        ? 'bg-pihole-accent/20 border border-pihole-accent'
                        : 'bg-pihole-dark hover:bg-pihole-darker border border-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <div className="pt-0.5">
                        <div
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                            isAlreadyAdded
                              ? 'border-pihole-border bg-pihole-border'
                              : isSelected
                              ? 'border-pihole-accent bg-pihole-accent'
                              : 'border-pihole-border'
                          }`}
                        >
                          {(isSelected || isAlreadyAdded) && (
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-pihole-text">{entry.name}</span>
                          {entry.recommended && (
                            <span className="px-1.5 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
                              Recommended
                            </span>
                          )}
                          {isAlreadyAdded && (
                            <span className="px-1.5 py-0.5 text-xs bg-pihole-border text-pihole-text-muted rounded">
                              Already added
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-pihole-text-muted mt-0.5 line-clamp-2">
                          {entry.description}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-pihole-text-muted">
                          <span>{formatCount(entry.domain_count)} domains</span>
                          {renderStars(entry.aggressiveness)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-pihole-border">
          <span className="text-sm text-pihole-text-muted">
            {selectedUrls.size} blocklist{selectedUrls.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-3">
            <button onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={selectedUrls.size === 0}
              className="btn btn-primary"
            >
              Add Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
