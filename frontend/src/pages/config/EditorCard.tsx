import { lazy, Suspense, useMemo } from 'react';
import type { EditorDiagnostic } from '../../components/config/editorDiagnostics';
import { applyViewText, draftViewText } from '../../components/config/lineDraft';
import type {
  GroupedSources,
  ParsedSource,
  SourceEntry,
} from '../../components/config/sourceLines';
import type { WhitelistEntry } from '../../components/config/whitelistLines';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { LoadingRegion, Skeleton } from '../../components/ui/Layout';
import type { LocatedIssue, SourceRowState } from './configFacts';
import type { EditorTab } from './editorState';
import type { EditorView } from './editorView';
import { SourcesPanel } from './SourcesPanel';
import type { EditorDraft } from './useEditorDraft';
import { WhitelistPanel } from './WhitelistPanel';

const LineEditor = lazy(async () => ({
  default: (await import('../../components/config/LineEditor')).LineEditor,
}));

export type EditorDialog =
  | { kind: 'add' }
  | { kind: 'library' }
  | { kind: 'edit'; lineId: number }
  | { kind: 'template' }
  | { kind: 'limit' };

const SOURCES_PLACEHOLDER =
  '# One source per line: address|name|category\nhttps://lists.example.org/ads.txt|example_ads|advertising';
const WHITELIST_PLACEHOLDER =
  '# One domain or pattern per line\nexample.com\n@@example.org\n*.example.net';
const EDITOR_HEIGHT = 'h-[clamp(320px,calc(100dvh-330px),1200px)]';

function diagnosticsFrom(issues: LocatedIssue[]): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  for (const issue of issues) {
    if (issue.lineNumber === null) continue;
    diagnostics.push({
      lineNumber: issue.lineNumber,
      severity: issue.severity,
      message: issue.message,
    });
  }
  return diagnostics;
}

export interface EditorCardProps {
  tab: EditorTab;
  view: EditorView;
  categories: readonly string[];
  draft: EditorDraft;
  grouped: GroupedSources;
  whitelist: WhitelistEntry[];
  sourceIssues: LocatedIssue[];
  whitelistIssues: LocatedIssue[];
  sourceComments: number;
  whitelistComments: number;
  limitReason: string | null;
  jump: { tab: EditorTab; lineNumber: number; request: number } | null;
  rowState: (entry: SourceEntry<ParsedSource>) => SourceRowState;
  onOpenDialog: (dialog: EditorDialog) => void;
  onRemoveSource: (lineId: number) => void;
  onRemoveWhitelist: (lineId: number) => void;
  onAddWhitelist: (pattern: string) => void;
  onShowLine: (tab: EditorTab, lineNumber: number) => void;
}

export function EditorCard({
  tab,
  view,
  categories,
  draft,
  grouped,
  whitelist,
  sourceIssues,
  whitelistIssues,
  sourceComments,
  whitelistComments,
  limitReason,
  jump,
  rowState,
  onOpenDialog,
  onRemoveSource,
  onRemoveWhitelist,
  onAddWhitelist,
  onShowLine,
}: EditorCardProps) {
  const { state, dispatch } = draft;
  const sourcesView = useMemo(() => draftViewText(state.sources), [state.sources]);
  const whitelistView = useMemo(() => draftViewText(state.whitelist), [state.whitelist]);
  const sourceDiagnostics = useMemo(() => diagnosticsFrom(sourceIssues), [sourceIssues]);
  const whitelistDiagnostics = useMemo(() => diagnosticsFrom(whitelistIssues), [whitelistIssues]);
  const atLimit = limitReason !== null;

  const addButtons = (
    <>
      <Button
        size="sm"
        icon="list"
        disabled={atLimit}
        onClick={() => onOpenDialog({ kind: 'library' })}
      >
        Add from library
      </Button>
      <Button
        size="sm"
        icon="plus"
        disabled={atLimit}
        onClick={() => onOpenDialog({ kind: 'add' })}
      >
        Add by URL
      </Button>
    </>
  );

  return (
    <Card as="section" aria-labelledby="config-editor" className="min-w-0 overflow-hidden">
      <CardHeader
        title={tab === 'sources' ? 'Sources' : 'Whitelist'}
        titleId="config-editor"
        className="flex-wrap"
        actions={tab === 'sources' ? addButtons : undefined}
      />
      {tab === 'sources' && limitReason ? (
        <div className="border-b border-border px-[18px] py-3 narrow:px-3">
          <Alert tone="warn" live={false}>
            {limitReason}
          </Alert>
        </div>
      ) : null}
      {view === 'text' ? (
        <div className="p-3">
          <Suspense
            fallback={
              <LoadingRegion label="Loading the text editor…">
                <Skeleton className={EDITOR_HEIGHT} />
              </LoadingRegion>
            }
          >
            <div hidden={tab !== 'sources'}>
              <LineEditor
                value={sourcesView}
                onChange={(text) =>
                  dispatch({
                    type: 'edit',
                    tab: 'sources',
                    apply: (current) => applyViewText(current, text),
                  })
                }
                syntax="sources"
                categories={categories}
                label="Sources, one per line"
                placeholder={SOURCES_PLACEHOLDER}
                diagnostics={sourceDiagnostics}
                jump={jump?.tab === 'sources' ? jump : null}
                className={EDITOR_HEIGHT}
              />
            </div>
            <div hidden={tab !== 'whitelist'}>
              <LineEditor
                value={whitelistView}
                onChange={(text) =>
                  dispatch({
                    type: 'edit',
                    tab: 'whitelist',
                    apply: (current) => applyViewText(current, text),
                  })
                }
                syntax="whitelist"
                categories={categories}
                label="Whitelist, one domain or pattern per line"
                placeholder={WHITELIST_PLACEHOLDER}
                diagnostics={whitelistDiagnostics}
                jump={jump?.tab === 'whitelist' ? jump : null}
                className={EDITOR_HEIGHT}
              />
            </div>
          </Suspense>
          <p className="mt-2 px-1 text-xs text-text-tertiary">
            {tab === 'sources'
              ? 'Domain counts and last build results for each source are shown in the Visual view.'
              : 'Problems found when saving are underlined here and listed under Check.'}
          </p>
        </div>
      ) : tab === 'sources' ? (
        <SourcesPanel
          grouped={grouped}
          rowState={rowState}
          commentCount={sourceComments}
          onEdit={(lineId) => onOpenDialog({ kind: 'edit', lineId })}
          onRemove={onRemoveSource}
          onShowInText={(lineNumber) => onShowLine('sources', lineNumber)}
          emptyAction={addButtons}
        />
      ) : (
        <WhitelistPanel
          entries={whitelist}
          commentCount={whitelistComments}
          problemLines={
            new Set(
              whitelistIssues.flatMap((issue) =>
                issue.lineNumber === null ? [] : [issue.lineNumber],
              ),
            )
          }
          onAdd={onAddWhitelist}
          onRemove={onRemoveWhitelist}
        />
      )}
    </Card>
  );
}
