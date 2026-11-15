import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { LimitRequestsResponse } from '../../api/account';
import { urlMetadataQuery } from '../../api/config';
import { BuildNowLabel } from '../../components/builds/BuildWait';
import type { UserListsResponse } from '../../api/lists';
import { removeLine } from '../../components/config/lineDraft';
import { analyseSources, countSources, groupSources } from '../../components/config/sourceLines';
import {
  addWhitelistEntry,
  countWhitelistComments,
  whitelistEntries,
} from '../../components/config/whitelistLines';
import LimitRequestModal from '../../components/LimitRequestModal';
import { Button } from '../../components/ui/Button';
import { PageHeader, Stack } from '../../components/ui/Layout';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Tabs } from '../../components/ui/Tabs';
import { formatInteger } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import type { Job, User } from '../../types';
import { openLimitReview } from '../../utils/limitReview';
import { activeJob, domainUsage } from '../dashboard/dashboardFacts';
import {
  checkIsCurrent,
  describeChanges,
  describeSourceLimit,
  lastBuildSourceStates,
  locateIssues,
  metadataUrls,
  savedSourceLines,
  sourceChanges,
  sourceRowState,
  whitelistChanges,
} from './configFacts';
import { EditorCard, type EditorDialog } from './EditorCard';
import { ConflictDialog, NoticeAlert, RestoreAlert, TemplateDialog } from './EditorNotices';
import type { EditorTab } from './editorState';
import { readEditorView, rememberEditorView, type EditorView } from './editorView';
import { SaveBar } from './SaveBar';
import { CheckCard, LimitsCard, type SourceCheckStatus } from './SidePanel';
import { SourceDialogs } from './SourceDialogs';
import { SyntaxHelp } from './SyntaxHelp';
import { useConfigActions } from './useConfigActions';
import { useEditorDraft } from './useEditorDraft';
import { LeaveDialog } from '../../components/ui/LeaveDialog';

const VIEW_OPTIONS = [
  { value: 'visual', label: 'Visual' },
  { value: 'text', label: 'Text' },
] as const;

export interface ConfigEditorProps {
  user: User;
  server: { sources: string; whitelist: string; revision: number };
  categories: readonly string[];
  lists: UserListsResponse | undefined;
  jobs: Job[];
  limitRequests: LimitRequestsResponse | undefined;
}

export function ConfigEditor({
  user,
  server,
  categories,
  lists,
  jobs,
  limitRequests,
}: ConfigEditorProps) {
  const now = useNow();
  const draft = useEditorDraft(user.id, server);
  const { state, dispatch } = draft;
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: EditorTab = searchParams.get('tab') === 'whitelist' ? 'whitelist' : 'sources';
  const setTab = (next: EditorTab) =>
    setSearchParams(next === 'whitelist' ? { tab: next } : {}, { replace: true });
  const [view, setView] = useState<EditorView>(readEditorView);
  const [dialog, setDialog] = useState<EditorDialog | null>(null);
  const [jump, setJump] = useState<{ tab: EditorTab; lineNumber: number; request: number } | null>(
    null,
  );
  const actions = useConfigActions(user.id, draft, setTab);
  const navigate = useNavigate();
  const buildToOpen = draft.dirty ? null : actions.startedBuildId;

  useEffect(() => {
    if (buildToOpen) navigate(`/jobs/${encodeURIComponent(buildToOpen)}`);
  }, [buildToOpen, navigate]);

  const entries = useMemo(
    () => analyseSources(state.sources, categories),
    [state.sources, categories],
  );
  const grouped = useMemo(() => groupSources(entries, categories), [entries, categories]);
  const whitelist = useMemo(() => whitelistEntries(state.whitelist), [state.whitelist]);
  const savedLines = useMemo(() => savedSourceLines(state.server.sources), [state.server.sources]);
  const buildStates = useMemo(() => lastBuildSourceStates(jobs), [jobs]);
  const urls = useMemo(() => metadataUrls(entries), [entries]);
  const metadata = useQuery({
    ...urlMetadataQuery(urls),
    enabled: view === 'visual' && urls.length > 0,
  });

  const sourceCount = countSources(entries);
  const sourceLimit = lists?.limits.max_source_lists ?? user.limits.max_source_lists;
  const limitReason = describeSourceLimit(sourceCount, sourceLimit);
  const sourceIssues = useMemo(
    () => locateIssues(state.sources, actions.check?.issues ?? []),
    [state.sources, actions.check],
  );
  const whitelistIssues = useMemo(
    () => locateIssues(state.whitelist, actions.whitelistRejection?.issues ?? []),
    [state.whitelist, actions.whitelistRejection],
  );
  const checkStatus: SourceCheckStatus = actions.checking
    ? 'checking'
    : checkIsCurrent(actions.check, draft.sources)
      ? 'checked'
      : actions.check
        ? 'outdated'
        : 'unchecked';
  const running = activeJob(jobs);
  const review = user.is_admin ? null : openLimitReview(user.limit_review);
  const chooseView = (next: EditorView) => {
    setView(next);
    rememberEditorView(next);
  };

  const showLine = (target: EditorTab, lineNumber: number) => {
    setTab(target);
    chooseView('text');
    setJump((current) => ({ tab: target, lineNumber, request: (current?.request ?? 0) + 1 }));
  };

  const removeFrom = (target: EditorTab) => (lineId: number) =>
    dispatch({ type: 'edit', tab: target, apply: (current) => removeLine(current, lineId) });

  const discard = () => {
    dispatch({ type: 'discard' });
    actions.forgetResults();
  };

  const panel = (
    <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-start gap-4 compact:grid-cols-[minmax(0,1fr)]">
      <EditorCard
        tab={tab}
        view={view}
        categories={categories}
        draft={draft}
        grouped={grouped}
        whitelist={whitelist}
        sourceIssues={sourceIssues}
        whitelistIssues={whitelistIssues}
        sourceComments={entries.filter((entry) => entry.parsed.kind === 'comment').length}
        whitelistComments={countWhitelistComments(state.whitelist)}
        limitReason={limitReason}
        jump={jump}
        rowState={(entry) => sourceRowState(entry, savedLines, buildStates, metadata.data)}
        onOpenDialog={setDialog}
        onRemoveSource={removeFrom('sources')}
        onRemoveWhitelist={removeFrom('whitelist')}
        onAddWhitelist={(pattern) =>
          dispatch({
            type: 'edit',
            tab: 'whitelist',
            apply: (current) => addWhitelistEntry(current, pattern).draft,
          })
        }
        onShowLine={showLine}
      />
      <Stack className="content-start">
        <LimitsCard
          sourceCount={sourceCount}
          sourceLimit={sourceLimit}
          usage={lists ? domainUsage(lists, review, jobs) : null}
          hasBuilt={Boolean(lists?.generation_id)}
          isAdmin={user.is_admin}
          canRequestMore={(limitRequests?.available_tiers.length ?? 0) > 0}
          hasPendingRequest={limitRequests?.has_pending ?? false}
          onRequestMore={() => setDialog({ kind: 'limit' })}
        />
        <CheckCard
          tab={tab}
          status={checkStatus}
          progress={actions.checkProgress}
          issues={sourceIssues}
          checkedCount={actions.check?.checkedCount ?? 0}
          checkedAt={actions.check?.at ?? null}
          sourceCount={sourceCount}
          whitelistIssues={whitelistIssues}
          now={now}
          onCheck={actions.runCheck}
          onJump={showLine}
        />
      </Stack>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Configuration"
        description="Choose the lists to combine and the domains to keep out of the result."
        actions={
          <>
            <Button
              variant="ghost"
              loading={actions.replacing}
              onClick={() => setDialog({ kind: 'template' })}
            >
              Use default template
            </Button>
            {running ? (
              <Button to={`/jobs/${encodeURIComponent(running.job_id)}`} icon="bolt">
                View build
              </Button>
            ) : draft.dirty ? null : (
              <Button
                icon="bolt"
                loading={actions.busy === 'build'}
                disabled={sourceCount === 0 || actions.cooldownEndsAt !== null}
                onClick={actions.build}
              >
                <BuildNowLabel endsAt={actions.cooldownEndsAt} />
              </Button>
            )}
            <SegmentedControl
              label="Editor"
              options={VIEW_OPTIONS}
              value={view}
              onChange={chooseView}
            />
          </>
        }
      />
      <Stack>
        {draft.restorable ? (
          <RestoreAlert onRestore={draft.restoreStoredDraft} onDiscard={draft.dropStoredDraft} />
        ) : null}
        {actions.notice ? (
          <NoticeAlert notice={actions.notice} onDismiss={actions.dismissNotice} />
        ) : null}
        <Tabs
          label="Section"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'sources', label: `Sources · ${formatInteger(sourceCount)}`, content: panel },
            {
              value: 'whitelist',
              label: `Whitelist · ${formatInteger(whitelist.length)}`,
              content: panel,
            },
          ]}
        />
        <SyntaxHelp tab={tab} categories={categories} />
      </Stack>
      {draft.dirty ? (
        <SaveBar
          summary={describeChanges(
            sourceChanges(state.server.sources, draft.sources),
            whitelistChanges(state.server.whitelist, draft.whitelist),
          )}
          busy={actions.busy}
          blocked={state.conflict !== null}
          canBuild={sourceCount > 0}
          cooldownEndsAt={actions.cooldownEndsAt}
          onDiscard={discard}
          onSave={() => actions.save(false)}
          onSaveAndBuild={() => actions.save(true)}
        />
      ) : null}
      <SourceDialogs
        dialog={dialog}
        entries={entries}
        categories={categories}
        remainingSlots={sourceLimit - sourceCount}
        dispatch={dispatch}
        onClose={() => setDialog(null)}
      />
      {dialog?.kind === 'limit' && lists && limitRequests ? (
        <LimitRequestModal
          isOpen
          onClose={() => setDialog(null)}
          currentLimit={lists.limits.max_domains}
          availableTiers={limitRequests.available_tiers}
        />
      ) : null}
      <TemplateDialog
        open={dialog?.kind === 'template'}
        busy={false}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          actions.replaceWithTemplate();
        }}
      />
      <ConflictDialog
        open={state.conflict !== null}
        onTakeServerVersion={() => {
          dispatch({ type: 'take-server-version' });
          actions.forgetResults();
        }}
        onKeepMyEdits={() => dispatch({ type: 'keep-my-edits' })}
      />
      <LeaveDialog blocker={draft.blocker} onLeave={discard}>
        Your unsaved changes to the sources or the whitelist will be lost.
      </LeaveDialog>
    </>
  );
}
