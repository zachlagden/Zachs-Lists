import { describe, expect, it } from 'vitest';
import type { ValidationResponse } from '../../api/config';
import { ApiError } from '../../api/errors';
import { parseDraft } from '../../components/config/lineDraft';
import { TOKEN_LIFETIME_MS, sourceCheckFrom } from './configFacts';
import {
  editorReducer,
  initialEditorState,
  sourcesAreDirty,
  whitelistIsDirty,
  type ServerConfig,
} from './editorState';
import { saveDraft, type SaveApi, type SaveRequest } from './saveFlow';

const SERVER: ServerConfig = {
  sources: 'https://example.com/a|a|tracking\n',
  whitelist: 'example.com\n',
  revision: 3,
};
const NEW_SOURCES = `${SERVER.sources}https://example.com/b|b|tracking\n`;
const NEW_WHITELIST = `${SERVER.whitelist}bad domain\n@@example.org\n`;

function validation(overrides: Partial<ValidationResponse> = {}): ValidationResponse {
  return {
    issues: [],
    errors: [],
    warnings: [],
    validated_count: 2,
    error_count: 0,
    warning_count: 0,
    has_errors: false,
    has_warnings: false,
    validation_token: 'token-1',
    validation_id: 'token-1',
    revision: 3,
    ...overrides,
  };
}

function request(sources = NEW_SOURCES, whitelist = SERVER.whitelist): SaveRequest {
  return {
    server: SERVER,
    sources: { draft: parseDraft(sources), text: sources },
    whitelist: { draft: parseDraft(whitelist), text: whitelist },
    check: null,
  };
}

interface FakeServer {
  api: SaveApi;
  calls: string[];
  stored: ServerConfig;
}

function fakeServer(overrides: Partial<SaveApi> = {}): FakeServer {
  const stored = { ...SERVER };
  const calls: string[] = [];
  const api: SaveApi = {
    validateConfig: async () => {
      calls.push('validate');
      return validation({ revision: stored.revision });
    },
    saveConfig: async (config, token) => {
      calls.push(`save-config:${token}`);
      stored.sources = config;
      stored.revision += 1;
    },
    saveWhitelist: async (whitelist) => {
      calls.push('save-whitelist');
      stored.whitelist = whitelist;
      stored.revision += 1;
    },
    fetchConfig: async () => ({ config: stored.sources, revision: stored.revision }),
    now: () => 1_000_000,
    ...overrides,
  };
  return { api, calls, stored };
}

function httpError(status: number, body: Record<string, unknown>): ApiError {
  return new ApiError({
    kind: 'http',
    status,
    message: String(body.error ?? 'failed'),
    code: typeof body.code === 'string' ? body.code : undefined,
    body,
  });
}

describe('saving the draft', () => {
  it('validates, then saves the exact text with the token it was given', async () => {
    const server = fakeServer();
    const result = await saveDraft(request(), server.api);
    expect(server.calls).toEqual(['validate', 'save-config:token-1']);
    expect(result.problem).toBeNull();
    expect(result.savedSources).toBe(true);
    expect(result.server).toEqual({ ...SERVER, sources: NEW_SOURCES, revision: 4 });
    expect(result.check?.token).toBeNull();
  });

  it('saves both tabs, sources first, and reports the revision after both', async () => {
    const server = fakeServer();
    const result = await saveDraft(
      request(NEW_SOURCES, 'example.com\n@@example.org\n'),
      server.api,
    );
    expect(server.calls).toEqual(['validate', 'save-config:token-1', 'save-whitelist']);
    expect(result.savedWhitelist).toBe(true);
    expect(result.server?.revision).toBe(5);
  });

  it('touches nothing that has not changed', async () => {
    const server = fakeServer();
    const result = await saveDraft(
      request(SERVER.sources, 'example.com\n@@example.org\n'),
      server.api,
    );
    expect(server.calls).toEqual(['save-whitelist']);
    expect(result.savedSources).toBe(false);
    expect(result.problem).toBeNull();
  });

  it('reuses a fresh check of the same text and revision', async () => {
    const server = fakeServer();
    const check = sourceCheckFrom(
      parseDraft(NEW_SOURCES),
      NEW_SOURCES,
      validation({ validation_token: 'earlier' }),
      999_000,
    );
    await saveDraft({ ...request(), check }, server.api);
    expect(server.calls).toEqual(['save-config:earlier']);
  });

  it('checks again when the earlier check is old, used or for other text', async () => {
    const stale = sourceCheckFrom(
      parseDraft(NEW_SOURCES),
      NEW_SOURCES,
      validation({ validation_token: 'old' }),
      1_000_000 - TOKEN_LIFETIME_MS,
    );
    const used = { ...stale, at: 999_000, token: null };
    const otherText = { ...stale, at: 999_000, text: 'something else' };
    for (const check of [stale, used, otherText]) {
      const server = fakeServer();
      await saveDraft({ ...request(), check }, server.api);
      expect(server.calls).toEqual(['validate', 'save-config:token-1']);
    }
  });

  it('saves nothing when the sources have errors, and reports the lines', async () => {
    const server = fakeServer({
      validateConfig: async () =>
        validation({
          has_errors: true,
          error_count: 1,
          validation_token: null,
          issues: [{ severity: 'error', message: 'Invalid source category', line: 2, url: null }],
        }),
    });
    const result = await saveDraft(request(NEW_SOURCES, NEW_WHITELIST), server.api);
    expect(result.problem).toEqual({ kind: 'sources-invalid' });
    expect(server.calls).toEqual([]);
    expect(result.server).toBeNull();
    expect(result.check?.issues[0]).toMatchObject({
      raw: 'https://example.com/b|b|tracking',
      severity: 'error',
    });
  });

  it('refuses to save over a change made elsewhere before the check', async () => {
    const server = fakeServer();
    server.stored.revision = 9;
    const result = await saveDraft(request(), server.api);
    expect(result.problem).toEqual({ kind: 'conflict' });
    expect(server.calls).toEqual(['validate']);
  });

  it('reports a change made elsewhere between the check and the save', async () => {
    const server = fakeServer({
      saveConfig: async () => {
        throw httpError(409, { error: 'Configuration changed', code: 'config_conflict' });
      },
    });
    const result = await saveDraft(request(), server.api);
    expect(result.problem).toEqual({ kind: 'conflict' });
    expect(result.savedSources).toBe(false);
  });

  it('refuses to save the whitelist over a change made elsewhere', async () => {
    const server = fakeServer();
    server.stored.revision = 9;
    const result = await saveDraft(request(SERVER.sources, NEW_WHITELIST), server.api);
    expect(result.problem).toEqual({ kind: 'conflict' });
    expect(server.calls).toEqual([]);
  });

  it('keeps the whitelist baseline when its save meets a change made elsewhere', async () => {
    const server = fakeServer();
    const saveOurSources = server.api.saveConfig;
    server.api.saveConfig = async (config, token) => {
      await saveOurSources(config, token);
      server.stored.whitelist = 'changed.example.com\n';
      server.stored.revision += 1;
    };
    const result = await saveDraft(request(NEW_SOURCES, NEW_WHITELIST), server.api);
    expect(result.savedSources).toBe(true);
    expect(result.savedWhitelist).toBe(false);
    expect(result.problem).toEqual({ kind: 'conflict' });
    expect(server.calls).toEqual(['validate', 'save-config:token-1']);
    expect(result.server).toEqual({
      sources: NEW_SOURCES,
      whitelist: SERVER.whitelist,
      revision: 4,
    });

    const editing = editorReducer(
      editorReducer(initialEditorState(SERVER), {
        type: 'restore',
        sources: NEW_SOURCES,
        whitelist: NEW_WHITELIST,
      }),
      { type: 'saved', server: result.server as ServerConfig },
    );
    expect(sourcesAreDirty(editing)).toBe(false);
    expect(whitelistIsDirty(editing)).toBe(true);
    const refetched = editorReducer(editing, {
      type: 'server-changed',
      server: { ...server.stored },
    });
    expect(refetched.conflict).toEqual({
      sources: NEW_SOURCES,
      whitelist: 'changed.example.com\n',
      revision: 5,
    });
    expect(refetched.server.whitelist).toBe(SERVER.whitelist);
  });

  it('keeps the saved sources when the whitelist is refused, with line numbers', async () => {
    const server = fakeServer({
      saveWhitelist: async () => {
        throw httpError(400, {
          error: 'Invalid whitelist',
          details: ['Line 2: Not a valid domain', '3 more lines have problems'],
        });
      },
    });
    const result = await saveDraft(request(NEW_SOURCES, NEW_WHITELIST), server.api);
    expect(result.savedSources).toBe(true);
    expect(result.savedWhitelist).toBe(false);
    expect(result.server).toEqual({ ...SERVER, sources: NEW_SOURCES, revision: 4 });
    expect(result.problem).toMatchObject({
      kind: 'whitelist-invalid',
      issues: [
        { raw: 'bad domain', message: 'Not a valid domain', severity: 'error' },
        { lineId: null, message: '3 more lines have problems' },
      ],
    });
  });

  it('says so when the whitelist could not be checked', async () => {
    const server = fakeServer({
      saveWhitelist: async () => {
        throw httpError(503, { error: 'The whitelist could not be checked, so it was not saved.' });
      },
    });
    const result = await saveDraft(request(SERVER.sources, NEW_WHITELIST), server.api);
    expect(result.problem).toEqual({
      kind: 'whitelist-unchecked',
      message: 'The whitelist could not be checked, so it was not saved.',
    });
    expect(result.server).toBeNull();
  });

  it('reports any other failure with the step it happened in', async () => {
    const server = fakeServer({
      saveConfig: async () => {
        throw httpError(400, { error: 'Config file too large. Maximum size: 1MB' });
      },
    });
    const result = await saveDraft(request(), server.api);
    expect(result.problem).toMatchObject({ kind: 'failed', step: 'sources' });
  });
});
