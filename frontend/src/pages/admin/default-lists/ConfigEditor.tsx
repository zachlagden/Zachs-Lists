import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { adminKeys, updateDefaultConfig, type DefaultConfigUpdate } from '../../../api/admin';
import { toApiError } from '../../../api/errors';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { Field, Textarea } from '../../../components/ui/Field';
import { showToast } from '../../../components/ui/toasts';
import {
  acceptingSaved,
  editsChangedUnderneath,
  pendingEdits,
  shownValues,
  withEdit,
  withoutEdit,
  type FieldEdits,
} from '../../../lib/editOverlay';
import type { DefaultConfig } from '../../../types';
import { errorDetails, formFailure } from '../shared/fieldErrors';
import { LeaveDialog } from '../../../components/ui/LeaveDialog';
import { useUnsavedChangesGuard } from '../../../hooks/useUnsavedChangesGuard';

type ConfigField = 'config' | 'whitelist';

const FIELDS: ReadonlyArray<ConfigField> = ['config', 'whitelist'];

const FIELD_NAMES: Record<ConfigField, string> = {
  config: 'sources',
  whitelist: 'whitelist',
};

const NO_EDITS: FieldEdits<ConfigField> = {};

function LineErrors({ title, details }: { title: string; details: string[] }) {
  return (
    <Alert tone="fail" title={title}>
      {details.length > 0 ? (
        <ul className="m-0 grid list-disc gap-0.5 pl-4">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

export interface ConfigEditorProps {
  config: DefaultConfig;
  onDone: () => void;
}

export function ConfigEditor({ config, onDone }: ConfigEditorProps) {
  const client = useQueryClient();
  const [edits, setEdits] = useState(NO_EDITS);
  const saved: Record<ConfigField, string> = {
    config: config.config,
    whitelist: config.whitelist,
  };
  const shown = shownValues(saved, edits);
  const changedUnderneath = editsChangedUnderneath(saved, edits);
  const save = useMutation({
    mutationFn: (update: DefaultConfigUpdate) => updateDefaultConfig(update),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: adminKeys.defaultConfig() });
      showToast(
        'ok',
        'The default configuration is saved. Rebuild the default lists to publish it.',
      );
      onDone();
    },
    onError: (error) => {
      if (toApiError(error).code === 'default_config_managed') {
        void client.invalidateQueries({ queryKey: adminKeys.defaultConfig() });
        void client.invalidateQueries({ queryKey: adminKeys.defaultSync() });
      }
    },
  });
  const failure = save.isError
    ? formFailure<ConfigField>(save.error, {
        fields: FIELDS,
        fallback: 'The default configuration could not be saved.',
      })
    : null;
  const details = save.isError ? errorDetails(save.error) : [];
  const serverSummary = save.isError ? toApiError(save.error).body.error : undefined;
  const summary = typeof serverSummary === 'string' ? serverSummary : 'This text has errors';
  const changes: DefaultConfigUpdate = pendingEdits(saved, edits);
  const dirty = Object.keys(changes).length > 0;
  const blocker = useUnsavedChangesGuard(dirty);

  const change = (field: ConfigField, value: string) => {
    setEdits((current) => withEdit(saved, current, field, value));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(changes);
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4 compact:grid-cols-[minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          <Field
            label="Sources"
            hint="One source on each line: address|name|category. Lines starting with # are comments."
          >
            <Textarea
              mono
              rows={18}
              value={shown.config}
              onChange={(event) => change('config', event.target.value)}
              spellCheck={false}
              wrap="off"
            />
          </Field>
          {failure?.fields.config ? <LineErrors title={summary} details={details} /> : null}
        </div>
        <div className="grid content-start gap-2">
          <Field
            label="Whitelist"
            hint="One pattern on each line. Matching domains are removed from every default list."
          >
            <Textarea
              mono
              rows={18}
              value={shown.whitelist}
              onChange={(event) => change('whitelist', event.target.value)}
              spellCheck={false}
              wrap="off"
            />
          </Field>
          {failure?.fields.whitelist ? <LineErrors title={summary} details={details} /> : null}
        </div>
      </div>
      {changedUnderneath.length > 0 ? (
        <Alert
          tone="warn"
          title={`Someone else saved the ${changedUnderneath.map((field) => FIELD_NAMES[field]).join(' and the ')} while you were editing`}
          actions={
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEdits((current) => acceptingSaved(saved, current))}
              >
                Keep my edit
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  setEdits((current) => changedUnderneath.reduce(withoutEdit, current))
                }
              >
                Load the saved text
              </Button>
            </>
          }
        >
          Saving replaces the text on the server with what you typed.
        </Alert>
      ) : null}
      {failure?.form ? (
        <Alert tone="fail" title="Nothing was saved">
          {failure.form}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
          Save the configuration
        </Button>
      </div>
      <LeaveDialog blocker={blocker}>
        Your unsaved changes to the default sources or the default whitelist will be lost.
      </LeaveDialog>
    </form>
  );
}
