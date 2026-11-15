import { useId, useState, type FormEvent } from 'react';
import {
  categoryLabel,
  describeNameProblem,
  describeUrlProblem,
  suggestNameFromUrl,
  uniqueSourceName,
  type SourceFields,
} from '../../components/config/sourceLines';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';

export interface SourceFormDialogProps {
  mode: 'add' | 'edit';
  initial: SourceFields;
  categories: readonly string[];
  takenNames: ReadonlySet<string>;
  existingUrls: ReadonlySet<string>;
  onSubmit: (fields: SourceFields) => void;
  onClose: () => void;
}

interface FormErrors {
  url: string | null;
  name: string | null;
  category: string | null;
}

const NO_ERRORS: FormErrors = { url: null, name: null, category: null };

export function SourceFormDialog({
  mode,
  initial,
  categories,
  takenNames,
  existingUrls,
  onSubmit,
  onClose,
}: SourceFormDialogProps) {
  const formId = useId();
  const abpHintId = useId();
  const [url, setUrl] = useState(initial.url);
  const [typedName, setTypedName] = useState<string | null>(mode === 'edit' ? initial.name : null);
  const [category, setCategory] = useState(
    initial.category !== null && categories.includes(initial.category) ? initial.category : '',
  );
  const [abp, setAbp] = useState(initial.abp);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const mayStayUncategorised = mode === 'edit' && initial.category === null;

  const trimmedUrl = url.trim();
  const suggestedName =
    trimmedUrl && describeUrlProblem(trimmedUrl) === null
      ? uniqueSourceName(suggestNameFromUrl(trimmedUrl), takenNames)
      : '';
  const name = typedName ?? suggestedName;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const finalName = name.trim();
    const found: FormErrors = {
      url:
        mode === 'add'
          ? (describeUrlProblem(trimmedUrl) ??
            (existingUrls.has(trimmedUrl) ? 'This address is already in your sources.' : null))
          : null,
      name:
        describeNameProblem(finalName) ??
        (takenNames.has(finalName.toLowerCase()) ? 'Another source already uses this name.' : null),
      category: category
        ? null
        : !mayStayUncategorised
          ? 'Choose a category.'
          : abp
            ? 'Choose a category to use the Adblock flag.'
            : null,
    };
    setErrors(found);
    const firstInvalid = found.url
      ? 'url'
      : found.name
        ? 'name'
        : found.category
          ? 'category'
          : null;
    if (firstInvalid) {
      const field = event.currentTarget.elements.namedItem(firstInvalid);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    onSubmit({
      url: mode === 'add' ? trimmedUrl : initial.url,
      name: finalName,
      category: category || null,
      abp,
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdropClick={false}
      title={mode === 'add' ? 'Add a source by URL' : 'Edit source'}
      description={
        mode === 'add'
          ? 'The address of a hosts, plain domain or Adblock list.'
          : 'Change the name, category or format flag. The address stays the same.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary">
            {mode === 'add' ? 'Add source' : 'Apply'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        noValidate
        className="grid grid-cols-[minmax(0,1fr)] gap-4"
      >
        {mode === 'add' ? (
          <Field label="Address" error={errors.url}>
            <Input
              mono
              type="url"
              name="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://lists.example.org/ads.txt"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
        ) : (
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Address</span>
            <span className="font-mono text-[13px] break-all text-text-secondary">
              {initial.url}
            </span>
          </div>
        )}
        <Field
          label="Name"
          hint="Letters, numbers, dashes and underscores. It must be different from every other source."
          error={errors.name}
        >
          <Input
            mono
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            name="name"
            value={name}
            onChange={(event) => setTypedName(event.target.value)}
          />
        </Field>
        <Field label="Category" error={errors.category}>
          <Select
            name="category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="" disabled={!mayStayUncategorised}>
              {mayStayUncategorised ? 'No category' : 'Choose a category'}
            </option>
            {categories.map((option) => (
              <option key={option} value={option}>
                {categoryLabel(option)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            name="abp"
            checked={abp}
            onChange={(event) => setAbp(event.target.checked)}
            aria-describedby={abpHintId}
            className="mt-0.5 size-4 flex-none accent-(--accent-start)"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">
              Read wildcard lines as Adblock rules
            </span>
            <span id={abpHintId} className="mt-0.5 block text-xs text-text-tertiary">
              Adds the{' '}
              <span className="mono" translate="no">
                abp
              </span>{' '}
              flag. A line such as{' '}
              <span className="mono" translate="no">
                *.example.com
              </span>{' '}
              in this list then blocks example.com and its subdomains. Without the flag such lines
              are skipped.
            </span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}
