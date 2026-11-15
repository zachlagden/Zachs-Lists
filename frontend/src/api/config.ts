import { queryOptions } from '@tanstack/react-query';
import type { LibraryEntry } from '../components/config/types';
import { get, post, put } from './http';

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
  return post<ValidationResponse>('/api/user/config/validate', { config });
}

export function fetchCategories(): Promise<CategoriesResponse> {
  return get<CategoriesResponse>('/api/user/config/categories');
}

export function fetchUrlMetadata(urls: string[]): Promise<UrlMetadataResponse> {
  return post<UrlMetadataResponse>('/api/user/config/url-metadata', { urls });
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
