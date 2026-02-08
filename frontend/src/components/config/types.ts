// Blocklist library entry from backend
export interface LibraryEntry {
  id: string;
  url: string;
  name: string;
  category: string;
  description: string;
  recommended: boolean;
  aggressiveness: number;
  domain_count: number;
  added_by: string;
  created_at: string;
  updated_at: string;
}

// Parsed config line
export interface ConfigLine {
  url: string;
  name: string;
  category: string;
  isComment?: boolean;
  raw?: string;
}

// Validation issue from backend
export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  line?: number;
  url?: string;
}

// Validation result from backend
export interface ValidationResult {
  issues: ValidationIssue[];
  validated_count: number;
  error_count: number;
  warning_count: number;
  has_errors: boolean;
  has_warnings: boolean;
  validation_token?: string; // Token for saving - ties validated config to save
}

// Category info
export const CATEGORIES = [
  { value: 'comprehensive', label: 'Comprehensive', description: 'General purpose blocklists' },
  { value: 'malicious', label: 'Malicious', description: 'Malware, phishing, scams' },
  { value: 'advertising', label: 'Advertising', description: 'Ads and ad networks' },
  { value: 'tracking', label: 'Tracking', description: 'Analytics and trackers' },
  { value: 'suspicious', label: 'Suspicious', description: 'Potentially unwanted domains' },
  { value: 'nsfw', label: 'NSFW', description: 'Adult content (excluded from all_domains)' },
] as const;

export type CategoryValue = (typeof CATEGORIES)[number]['value'];

// Parse config string into lines
export function parseConfig(config: string): ConfigLine[] {
  const lines: ConfigLine[] = [];

  for (const rawLine of config.split('\n')) {
    const line = rawLine.trim();

    // Skip empty lines
    if (!line) continue;

    // Comment lines
    if (line.startsWith('#')) {
      lines.push({ url: '', name: '', category: '', isComment: true, raw: rawLine });
      continue;
    }

    // Parse url|name|category format
    const parts = line.split('|');
    if (parts.length >= 3) {
      lines.push({
        url: parts[0].trim(),
        name: parts[1].trim(),
        category: parts[2].trim(),
        raw: rawLine,
      });
    } else if (parts.length === 1 && line.startsWith('http')) {
      // URL only
      lines.push({ url: parts[0].trim(), name: '', category: '', raw: rawLine });
    }
  }

  return lines;
}

// Convert config lines back to string
export function serializeConfig(lines: ConfigLine[]): string {
  return lines
    .map((line) => {
      if (line.isComment) {
        return line.raw || `# ${line.name}`;
      }
      return `${line.url}|${line.name}|${line.category}`;
    })
    .join('\n');
}

// Group config lines by category
export function groupByCategory(lines: ConfigLine[]): Record<string, ConfigLine[]> {
  const grouped: Record<string, ConfigLine[]> = {};

  for (const cat of CATEGORIES) {
    grouped[cat.value] = [];
  }

  for (const line of lines) {
    if (line.isComment) continue;
    if (line.category && grouped[line.category]) {
      grouped[line.category].push(line);
    }
  }

  return grouped;
}

// Extract domain from URL for auto-naming
export function extractNameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Get hostname and convert to snake_case name
    const hostname = urlObj.hostname.replace(/^www\./, '');
    // Take first part of domain and clean it
    const parts = hostname.split('.');
    const name = parts[0]
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
    return name || 'blocklist';
  } catch {
    return 'blocklist';
  }
}
