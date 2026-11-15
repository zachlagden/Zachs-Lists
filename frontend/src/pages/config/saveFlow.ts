import type { ConfigResponse, ValidationResponse } from '../../api/config';
import { toApiError, type ApiError } from '../../api/errors';
import type { LineDraft } from '../../components/config/lineDraft';
import {
  issuesFromWhitelistDetails,
  reusableToken,
  sourceCheckFrom,
  type LineIssue,
  type SourceCheck,
} from './configFacts';
import type { ServerConfig } from './editorState';

export interface SaveApi {
  validateConfig: (config: string) => Promise<ValidationResponse>;
  saveConfig: (config: string, token: string) => Promise<unknown>;
  saveWhitelist: (whitelist: string) => Promise<unknown>;
  fetchConfig: () => Promise<ConfigResponse>;
  now: () => number;
}

export interface SaveRequest {
  server: ServerConfig;
  sources: { draft: LineDraft; text: string };
  whitelist: { draft: LineDraft; text: string };
  check: SourceCheck | null;
}

export type SaveProblem =
  | { kind: 'sources-invalid' }
  | { kind: 'conflict' }
  | { kind: 'whitelist-invalid'; text: string; issues: LineIssue[] }
  | { kind: 'whitelist-unchecked'; message: string }
  | { kind: 'failed'; step: 'sources' | 'whitelist'; error: ApiError };

export interface SaveResult {
  problem: SaveProblem | null;
  check: SourceCheck | null;
  savedSources: boolean;
  savedWhitelist: boolean;
  server: ServerConfig | null;
}

const CONFLICT_CODE = 'config_conflict';

function whitelistProblem(request: SaveRequest, error: ApiError): SaveProblem {
  const details = error.body.details;
  if (error.status === 400 && Array.isArray(details)) {
    return {
      kind: 'whitelist-invalid',
      text: request.whitelist.text,
      issues: issuesFromWhitelistDetails(request.whitelist.draft, details),
    };
  }
  if (error.status === 503 && typeof error.body.error === 'string') {
    return { kind: 'whitelist-unchecked', message: error.body.error };
  }
  return { kind: 'failed', step: 'whitelist', error };
}

export async function saveDraft(request: SaveRequest, api: SaveApi): Promise<SaveResult> {
  const result: SaveResult = {
    problem: null,
    check: request.check,
    savedSources: false,
    savedWhitelist: false,
    server: null,
  };
  const sourcesDirty = request.sources.text !== request.server.sources;
  const whitelistDirty = request.whitelist.text !== request.server.whitelist;
  let revision = request.server.revision;

  if (sourcesDirty) {
    try {
      let token = reusableToken(request.check, request.sources.text, api.now());
      if (token === null || request.check?.revision !== revision) {
        const response = await api.validateConfig(request.sources.text);
        result.check = sourceCheckFrom(
          request.sources.draft,
          request.sources.text,
          response,
          api.now(),
        );
        token = result.check.token;
      }
      const check = result.check;
      if (!check || check.hasErrors || token === null) {
        result.problem = { kind: 'sources-invalid' };
        return result;
      }
      if (check.revision !== revision) {
        result.problem = { kind: 'conflict' };
        return result;
      }
      await api.saveConfig(request.sources.text, token);
      result.check = { ...check, token: null };
      result.savedSources = true;
      revision += 1;
    } catch (caught) {
      const error = toApiError(caught);
      result.problem =
        error.code === CONFLICT_CODE
          ? { kind: 'conflict' }
          : { kind: 'failed', step: 'sources', error };
      return result;
    }
  }

  if (whitelistDirty) {
    try {
      const latest = await api.fetchConfig();
      if (latest.revision !== revision) {
        result.problem = { kind: 'conflict' };
      } else {
        await api.saveWhitelist(request.whitelist.text);
        result.savedWhitelist = true;
      }
    } catch (caught) {
      result.problem = whitelistProblem(request, toApiError(caught));
    }
  }

  if (result.savedSources || result.savedWhitelist) {
    result.server = {
      sources: result.savedSources ? request.sources.text : request.server.sources,
      whitelist: result.savedWhitelist ? request.whitelist.text : request.server.whitelist,
      revision: revision + (result.savedWhitelist ? 1 : 0),
    };
  }
  return result;
}
