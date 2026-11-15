import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import {
  configKeys,
  copyDefaultTemplate,
  fetchConfig,
  fetchWhitelist,
  saveConfig,
  saveWhitelist,
  validateConfig,
  type ConfigResponse,
  type WhitelistResponse,
} from '../../api/config';
import { describeApiError, toApiError, type ApiError } from '../../api/errors';
import { jobsKeys, startBuild, type BuildStarted } from '../../api/jobs';
import { listsKeys, type UserListsResponse } from '../../api/lists';
import type { AlertTone } from '../../components/ui/Alert';
import { showToast } from '../../components/ui/toasts';
import { useValidationSocket } from '../../hooks/useSocket';
import { describeBuildRefusal, runningBuildId } from '../../lib/builds';
import { pluralise } from '../../lib/format';
import { sourceCheckFrom, type LineIssue, type SourceCheck } from './configFacts';
import type { EditorTab, ServerConfig } from './editorState';
import { saveDraft, type SaveApi, type SaveResult } from './saveFlow';
import type { CheckProgress } from './SidePanel';
import type { EditorDraft } from './useEditorDraft';

export interface EditorNotice {
  tone: AlertTone;
  title: string;
  message: string;
  buildJobId?: string | null;
}

export interface WhitelistRejection {
  text: string;
  issues: LineIssue[];
}

export interface ConfigActions {
  check: SourceCheck | null;
  checking: boolean;
  checkProgress: CheckProgress | null;
  whitelistRejection: WhitelistRejection | null;
  notice: EditorNotice | null;
  busy: 'save' | 'build' | null;
  startedBuildId: string | null;
  replacing: boolean;
  dismissNotice: () => void;
  runCheck: () => void;
  save: (thenBuild: boolean) => void;
  build: () => void;
  replaceWithTemplate: () => void;
  forgetResults: () => void;
}

const SAVE_API: SaveApi = {
  validateConfig,
  saveConfig,
  saveWhitelist,
  fetchConfig,
  fetchWhitelist,
  now: () => Date.now(),
};

interface SaveOutcome {
  result: SaveResult;
  built: BuildStarted | null;
  buildError: ApiError | null;
}

function savedPrefix(result: SaveResult): string {
  return result.savedSources ? 'Your sources were saved. ' : '';
}

function noticeForProblem(result: SaveResult): EditorNotice | null {
  const problem = result.problem;
  if (!problem || problem.kind === 'conflict') return null;
  if (problem.kind === 'sources-invalid') {
    const errors = result.check?.issues.filter((issue) => issue.severity === 'error').length ?? 0;
    return {
      tone: 'fail',
      title: 'Nothing was saved',
      message: `The sources have ${pluralise(errors, 'error')}. Each one is listed under Check with its line number.`,
    };
  }
  if (problem.kind === 'whitelist-invalid') {
    return {
      tone: 'fail',
      title: 'The whitelist was not saved',
      message: `${savedPrefix(result)}${pluralise(problem.issues.length, 'whitelist problem')} must be fixed first. Each one is listed under Check.`,
    };
  }
  if (problem.kind === 'whitelist-unchecked') {
    return {
      tone: 'warn',
      title: 'The whitelist was not saved',
      message: `${savedPrefix(result)}${problem.message}`,
    };
  }
  return {
    tone: 'fail',
    title: problem.step === 'sources' ? 'Nothing was saved' : 'The whitelist was not saved',
    message: `${problem.step === 'whitelist' ? savedPrefix(result) : ''}${describeApiError(problem.error, 'The server could not save it. Try again in a moment.')}`,
  };
}

export function useConfigActions(
  userId: string,
  draft: EditorDraft,
  showTab: (tab: EditorTab) => void,
): ConfigActions {
  const client = useQueryClient();
  const { state, dispatch } = draft;
  const [check, setCheck] = useState<SourceCheck | null>(null);
  const [checkProgress, setCheckProgress] = useState<CheckProgress | null>(null);
  const [whitelistRejection, setWhitelistRejection] = useState<WhitelistRejection | null>(null);
  const [notice, setNotice] = useState<EditorNotice | null>(null);
  const [startedBuildId, setStartedBuildId] = useState<string | null>(null);

  useValidationSocket({
    userId,
    onProgress: useCallback(
      (progress: CheckProgress) =>
        setCheckProgress({ current: progress.current, total: progress.total }),
      [],
    ),
  });

  const adoptServer = (server: ServerConfig) => {
    dispatch({ type: 'saved', server });
    client.setQueryData<ConfigResponse>(configKeys.sources(), {
      config: server.sources,
      revision: server.revision,
    });
    client.setQueryData<WhitelistResponse>(configKeys.whitelist(), {
      whitelist: server.whitelist,
    });
  };

  const refetchConfig = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: configKeys.sources() }),
      client.invalidateQueries({ queryKey: configKeys.whitelist() }),
    ]);

  const announceBuild = (started: BuildStarted) => {
    client.setQueryData<UserListsResponse>(listsKeys.mine(), (current) =>
      current ? { ...current, remaining_updates: started.remaining_updates } : current,
    );
    void client.invalidateQueries({ queryKey: jobsKeys.list() });
    setNotice({
      tone: 'ok',
      title: 'The build has started',
      message: 'It uses the configuration that is saved now.',
      buildJobId: started.job_id,
    });
    setStartedBuildId(started.job_id);
  };

  const refuseBuild = (error: ApiError, saved: boolean) => {
    setNotice({
      tone: 'warn',
      title: saved ? 'Saved, but the build was not started' : 'The build was not started',
      message: describeBuildRefusal(error),
      buildJobId: runningBuildId(error),
    });
  };

  const checkMutation = useMutation({
    mutationFn: async () => {
      const checked = { draft: state.sources, text: draft.sources };
      const response = await validateConfig(checked.text);
      return sourceCheckFrom(checked.draft, checked.text, response, Date.now());
    },
    onMutate: () => setCheckProgress(null),
    onSuccess: (result) => setCheck(result),
    onError: (error) =>
      setNotice({
        tone: 'fail',
        title: 'The sources could not be checked',
        message: describeApiError(error, 'Try again in a moment.'),
      }),
  });

  const saveMutation = useMutation({
    mutationFn: async (thenBuild: boolean): Promise<SaveOutcome> => {
      const result = await saveDraft(
        {
          server: state.server,
          sources: { draft: state.sources, text: draft.sources },
          whitelist: { draft: state.whitelist, text: draft.whitelist },
          check,
        },
        SAVE_API,
      );
      if (result.problem || !thenBuild) return { result, built: null, buildError: null };
      try {
        return { result, built: await startBuild(), buildError: null };
      } catch (error) {
        return { result, built: null, buildError: toApiError(error) };
      }
    },
    onMutate: () => setNotice(null),
    onSuccess: ({ result, built, buildError }) => {
      setCheck(result.check);
      if (result.server) adoptServer(result.server);
      if (result.savedWhitelist) setWhitelistRejection(null);
      const problem = result.problem;
      if (problem?.kind === 'conflict') {
        void refetchConfig();
        return;
      }
      if (problem?.kind === 'sources-invalid') showTab('sources');
      if (problem?.kind === 'whitelist-invalid') {
        setWhitelistRejection({ text: problem.text, issues: problem.issues });
        showTab('whitelist');
      }
      if (problem) {
        setNotice(noticeForProblem(result));
        return;
      }
      if (built) {
        announceBuild(built);
        return;
      }
      if (buildError) refuseBuild(buildError, true);
      else showToast('ok', 'Your configuration was saved.');
    },
    onError: (error) =>
      setNotice({
        tone: 'fail',
        title: 'Nothing was saved',
        message: describeApiError(error, 'The server could not save it. Try again in a moment.'),
      }),
  });

  const buildMutation = useMutation({
    mutationFn: startBuild,
    onMutate: () => setNotice(null),
    onSuccess: announceBuild,
    onError: (error) => refuseBuild(toApiError(error), false),
  });

  const templateMutation = useMutation({
    mutationFn: async (): Promise<ServerConfig> => {
      await copyDefaultTemplate(true);
      const [config, whitelist] = await Promise.all([fetchConfig(), fetchWhitelist()]);
      return { sources: config.config, whitelist: whitelist.whitelist, revision: config.revision };
    },
    onMutate: () => setNotice(null),
    onSuccess: (server) => {
      adoptServer(server);
      dispatch({ type: 'discard' });
      setCheck(null);
      setWhitelistRejection(null);
      showToast('ok', 'Your sources and whitelist were replaced with the default template.');
    },
    onError: (error) =>
      setNotice({
        tone: 'fail',
        title: 'The default template was not used',
        message: describeApiError(error, 'Nothing was changed. Try again in a moment.'),
      }),
  });

  return {
    check,
    checking: checkMutation.isPending,
    checkProgress,
    whitelistRejection,
    notice,
    busy: saveMutation.isPending
      ? saveMutation.variables
        ? 'build'
        : 'save'
      : buildMutation.isPending
        ? 'build'
        : null,
    startedBuildId,
    replacing: templateMutation.isPending,
    dismissNotice: () => setNotice(null),
    runCheck: () => checkMutation.mutate(),
    save: (thenBuild) => saveMutation.mutate(thenBuild),
    build: () => buildMutation.mutate(),
    replaceWithTemplate: () => templateMutation.mutate(),
    forgetResults: () => {
      setCheck(null);
      setWhitelistRejection(null);
      setNotice(null);
    },
  };
}
