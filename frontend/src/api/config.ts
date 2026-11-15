import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { get, post, put, request } from './http';

export const VALIDATION_TIMEOUT_MS = 120_000;
export const URL_METADATA_BATCH_SIZE = 100;

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

export interface ConfigResponse {
  config: string;
  revision: number;
}

export interface WhitelistResponse {
  whitelist: string;
}

export interface CategoriesResponse {
  categories: string[];
  nsfw_excluded_from_all_domains: boolean;
}

export interface LibraryResponse {
  library: Record<string, LibraryEntry[]>;
  categories: string[];
}

export interface ValidationIssueDetail {
  message: string;
  line: number | null;
  url: string | null;
}

export interface ValidationResponse {
  issues: Array<ValidationIssueDetail & { severity: 'error' | 'warning' }>;
  errors: ValidationIssueDetail[];
  warnings: ValidationIssueDetail[];
  validated_count: number;
  error_count: number;
  warning_count: number;
  has_errors: boolean;
  has_warnings: boolean;
  validation_token: string | null;
  validation_id: string;
  revision: number;
}

export type UrlMetadataResponse = Record<string, { domain_count: number | null; cached: boolean }>;

export interface TemplateCopied {
  success: boolean;
  message: string;
  copied: { blocklists_conf: boolean; whitelist_txt: boolean };
}

export const configKeys = {
  all: ['config'] as const,
  sources: () => [...configKeys.all, 'sources'] as const,
  urlMetadata: (urls: readonly string[]) => [...configKeys.all, 'url-metadata', urls] as const,
  whitelist: () => [...configKeys.all, 'whitelist'] as const,
  categories: () => [...configKeys.all, 'categories'] as const,
  library: () => [...configKeys.all, 'library'] as const,
};

export function fetchConfig(): Promise<ConfigResponse> {
  return get<ConfigResponse>('/api/user/config');
}

export function saveConfig(config: string, validationToken: string): Promise<{ success: boolean }> {
  return put<{ success: boolean }>('/api/user/config', {
    config,
    validation_token: validationToken,
  });
}

export function validateConfig(config: string): Promise<ValidationResponse> {
  return request<ValidationResponse>({
    method: 'POST',
    url: '/api/user/config/validate',
    data: { config },
    timeout: VALIDATION_TIMEOUT_MS,
  });
}

export function fetchCategories(): Promise<CategoriesResponse> {
  return get<CategoriesResponse>('/api/user/config/categories');
}

export async function fetchUrlMetadata(urls: readonly string[]): Promise<UrlMetadataResponse> {
  const batches: string[][] = [];
  for (let start = 0; start < urls.length; start += URL_METADATA_BATCH_SIZE) {
    batches.push(urls.slice(start, start + URL_METADATA_BATCH_SIZE));
  }
  const answers = await Promise.all(
    batches.map((batch) =>
      post<UrlMetadataResponse>('/api/user/config/url-metadata', { urls: batch }),
    ),
  );
  return Object.assign({}, ...answers) as UrlMetadataResponse;
}

export function fetchLibrary(): Promise<LibraryResponse> {
  return get<LibraryResponse>('/api/user/library');
}

export function fetchWhitelist(): Promise<WhitelistResponse> {
  return get<WhitelistResponse>('/api/user/whitelist');
}

export function saveWhitelist(whitelist: string): Promise<{ success: boolean }> {
  return put<{ success: boolean }>('/api/user/whitelist', { whitelist });
}

export function copyDefaultTemplate(overwrite = false): Promise<TemplateCopied> {
  return post<TemplateCopied>('/api/user/copy-default-template', { overwrite });
}

export const configQuery = () =>
  queryOptions({ queryKey: configKeys.sources(), queryFn: fetchConfig });

export const whitelistQuery = () =>
  queryOptions({ queryKey: configKeys.whitelist(), queryFn: fetchWhitelist });

export const categoriesQuery = () =>
  queryOptions({
    queryKey: configKeys.categories(),
    queryFn: fetchCategories,
    staleTime: Infinity,
  });

export const libraryQuery = () =>
  queryOptions({ queryKey: configKeys.library(), queryFn: fetchLibrary });

export const urlMetadataQuery = (urls: readonly string[]) =>
  queryOptions({
    queryKey: configKeys.urlMetadata(urls),
    queryFn: () => fetchUrlMetadata(urls),
    enabled: urls.length > 0,
    placeholderData: keepPreviousData,
  });
