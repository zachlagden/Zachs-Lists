import { ViewPlugin, ViewUpdate, Decoration, WidgetType } from '@codemirror/view';
import type { Extension, Range } from '@codemirror/state';

// Types
interface UrlMetadata {
  domain_count: number | null;
  cached: boolean;
}

type FetchMetadataFn = (urls: string[]) => Promise<Record<string, UrlMetadata>>;

// Format large numbers (1234567 -> "1.2M")
function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return count.toString();
}

// Widget that renders the domain count
class UrlMetadataWidget extends WidgetType {
  constructor(
    private domainCount: number | null,
    private cached: boolean
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-url-metadata';

    if (this.domainCount !== null) {
      span.textContent = ` \u2190 ${formatCount(this.domainCount)} domains`;
      span.style.cssText = 'color: #6b7280; opacity: 0.7; font-size: 0.9em; margin-left: 0.5em;';
    } else if (!this.cached) {
      span.textContent = ' \u2190 (not cached)';
      span.style.cssText = 'color: #6b7280; opacity: 0.5; font-style: italic; font-size: 0.9em; margin-left: 0.5em;';
    }

    return span;
  }

  eq(other: UrlMetadataWidget) {
    return this.domainCount === other.domainCount && this.cached === other.cached;
  }
}

// Extract URLs from document content
function extractUrls(content: string): { url: string; lineEnd: number }[] {
  const results: { url: string; lineEnd: number }[] = [];
  const lines = content.split('\n');
  let pos = 0;

  for (const line of lines) {
    const lineEnd = pos + line.length;
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      pos = lineEnd + 1;
      continue;
    }

    // Extract URL (before first pipe)
    const match = trimmed.match(/^(https?:\/\/[^|\s]+)/);
    if (match) {
      results.push({ url: match[1], lineEnd });
    }

    pos = lineEnd + 1;
  }

  return results;
}

// Create ViewPlugin
export function urlMetadataExtension(fetchMetadata: FetchMetadataFn): Extension {
  return ViewPlugin.define(
    (view) => {
      let decorations = Decoration.none;
      let metadata: Record<string, UrlMetadata> = {};
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let currentUrls: string[] = [];

      const updateDecorations = () => {
        const urlInfos = extractUrls(view.state.doc.toString());
        const builder: Range<Decoration>[] = [];

        for (const { url, lineEnd } of urlInfos) {
          const meta = metadata[url];
          if (meta) {
            const widget = Decoration.widget({
              widget: new UrlMetadataWidget(meta.domain_count, meta.cached),
              side: 1,
            });
            builder.push(widget.range(lineEnd));
          }
        }

        decorations = Decoration.set(builder, true);
      };

      const fetchAndUpdate = async () => {
        const urlInfos = extractUrls(view.state.doc.toString());
        const urls = urlInfos.map((u) => u.url);

        // Only fetch if URLs changed
        if (JSON.stringify(urls) === JSON.stringify(currentUrls)) {
          return;
        }
        currentUrls = urls;

        if (urls.length === 0) {
          decorations = Decoration.none;
          return;
        }

        try {
          metadata = await fetchMetadata(urls);
          updateDecorations();
          // Request a view update to show new decorations
          view.requestMeasure();
        } catch (error) {
          console.error('Failed to fetch URL metadata:', error);
        }
      };

      // Initial fetch
      fetchAndUpdate();

      return {
        get decorations() {
          return decorations;
        },
        update(update: ViewUpdate) {
          if (update.docChanged) {
            // Debounce on document changes
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(fetchAndUpdate, 500);
          }
        },
        destroy() {
          if (debounceTimer) clearTimeout(debounceTimer);
        },
      };
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}
