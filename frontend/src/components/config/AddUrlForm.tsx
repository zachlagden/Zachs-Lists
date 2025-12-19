import { useState, useEffect } from 'react';
import { CATEGORIES, CategoryValue, extractNameFromUrl } from './types';

interface AddUrlFormProps {
  onClose: () => void;
  onAdd: (url: string, name: string, category: string) => void;
  existingUrls: Set<string>;
  existingNames: Set<string>;
  defaultCategory?: CategoryValue;
}

export default function AddUrlForm({
  onClose,
  onAdd,
  existingUrls,
  existingNames,
  defaultCategory,
}: AddUrlFormProps) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CategoryValue>(defaultCategory || 'comprehensive');
  const [autoName, setAutoName] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auto-generate name from URL
  useEffect(() => {
    if (autoName && url) {
      let generatedName = extractNameFromUrl(url);

      // Make name unique if it already exists
      let uniqueName = generatedName;
      let counter = 1;
      while (existingNames.has(uniqueName)) {
        uniqueName = `${generatedName}_${counter}`;
        counter++;
      }
      setName(uniqueName);
    }
  }, [url, autoName, existingNames]);

  // Validate form
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // URL validation
    if (!url.trim()) {
      newErrors.url = 'URL is required';
    } else {
      try {
        const urlObj = new URL(url);
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
          newErrors.url = 'URL must use HTTP or HTTPS';
        }
      } catch {
        newErrors.url = 'Invalid URL format';
      }

      if (existingUrls.has(url)) {
        newErrors.url = 'This URL is already in your configuration';
      }
    }

    // Name validation
    if (!name.trim()) {
      newErrors.name = 'Name is required';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      newErrors.name = 'Name can only contain letters, numbers, dashes, and underscores';
    } else if (existingNames.has(name)) {
      newErrors.name = 'This name is already used';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onAdd(url.trim(), name.trim(), category);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-pihole-card rounded-xl shadow-xl max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-pihole-border">
          <div>
            <h2 className="text-lg font-semibold text-pihole-text">Add Custom URL</h2>
            <p className="text-sm text-pihole-text-muted">Add a blocklist source manually</p>
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* URL Input */}
          <div>
            <label className="block text-sm font-medium text-pihole-text mb-1.5">
              Blocklist URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/blocklist.txt"
              className={`w-full px-3 py-2 bg-pihole-dark border rounded-lg text-pihole-text placeholder-pihole-text-muted focus:outline-none focus:ring-2 focus:ring-pihole-accent ${
                errors.url ? 'border-red-500' : 'border-pihole-border'
              }`}
            />
            {errors.url && <p className="mt-1 text-sm text-red-400">{errors.url}</p>}
          </div>

          {/* Name Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-pihole-text">Name</label>
              <label className="flex items-center gap-2 text-sm text-pihole-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoName}
                  onChange={(e) => {
                    setAutoName(e.target.checked);
                    if (!e.target.checked) {
                      setName('');
                    }
                  }}
                  className="rounded border-pihole-border bg-pihole-dark text-pihole-accent focus:ring-pihole-accent"
                />
                Auto-detect
              </label>
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''));
                setAutoName(false);
              }}
              placeholder="my_blocklist"
              disabled={autoName && !url}
              className={`w-full px-3 py-2 bg-pihole-dark border rounded-lg text-pihole-text placeholder-pihole-text-muted focus:outline-none focus:ring-2 focus:ring-pihole-accent disabled:opacity-50 ${
                errors.name ? 'border-red-500' : 'border-pihole-border'
              }`}
            />
            {errors.name && <p className="mt-1 text-sm text-red-400">{errors.name}</p>}
            <p className="mt-1 text-xs text-pihole-text-muted">
              Alphanumeric characters, dashes, and underscores only
            </p>
          </div>

          {/* Category Select */}
          <div>
            <label className="block text-sm font-medium text-pihole-text mb-1.5">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryValue)}
              className="w-full px-3 py-2 bg-pihole-dark border border-pihole-border rounded-lg text-pihole-text focus:outline-none focus:ring-2 focus:ring-pihole-accent"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label} - {cat.description}
                </option>
              ))}
            </select>
            {category === 'nsfw' && (
              <p className="mt-1 text-xs text-yellow-500">
                NSFW domains will not be included in the combined all_domains list.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add Source
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
