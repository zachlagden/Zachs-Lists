import type { ReactNode } from 'react';
import { categoryLabel } from '../../components/config/sourceLines';
import { Card } from '../../components/ui/Card';
import { Icon } from '../../components/ui/Icon';
import type { EditorTab } from './editorState';

function Code({ children }: { children: ReactNode }) {
  return (
    <code
      translate="no"
      className="rounded-sm bg-surface-raised px-1 py-px font-mono text-[12px] break-all"
    >
      {children}
    </code>
  );
}

function HelpRow({ form, children }: { form: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-border py-2.5 last:border-b-0 narrow:grid-cols-[minmax(0,1fr)]">
      <dt>{form}</dt>
      <dd className="m-0 text-text-secondary">{children}</dd>
    </div>
  );
}

function SourcesHelp({ categories }: { categories: readonly string[] }) {
  return (
    <dl className="m-0 text-[13px]">
      <HelpRow form={<Code>address|name|category</Code>}>
        One source per line. The address starts with http:// or https://. The name uses letters,
        numbers, dashes and underscores, and no two sources share one. The category is one of{' '}
        {categories.map((category, index) => (
          <span key={category}>
            {index > 0 ? ', ' : ''}
            <Code>{category}</Code>
          </span>
        ))}
        .
      </HelpRow>
      <HelpRow form={<Code>address|name|category|abp</Code>}>
        The <Code>abp</Code> flag is for lists written as wildcard domains. A line such as{' '}
        <Code>*.example.com</Code> in that list is then read as the Adblock rule{' '}
        <Code>||example.com^</Code>, which blocks example.com and its subdomains. Without the flag
        such lines are skipped. No other fourth field is accepted.
      </HelpRow>
      <HelpRow
        form={
          <>
            <Code>address|name</Code> or <Code>address</Code>
          </>
        }
      >
        Accepted, but the source has no category, so its domains go into a separate list named
        uncategorized. With only an address, the name is made from the host name.
      </HelpRow>
      <HelpRow form={<Code># a comment</Code>}>
        A line that starts with # is ignored, and so is a blank line. Both are kept exactly as
        written.
      </HelpRow>
      <HelpRow form="Combined list">
        Every category goes into the combined list except {categoryLabel('nsfw')}, which is only
        published as its own list.
      </HelpRow>
    </dl>
  );
}

function WhitelistHelp() {
  return (
    <dl className="m-0 text-[13px]">
      <HelpRow form={<Code>example.com</Code>}>
        Keeps exactly example.com out of your lists. Subdomains such as www.example.com stay
        blocked.
      </HelpRow>
      <HelpRow form={<Code>@@example.com</Code>}>
        Keeps example.com and every subdomain of it, such as www.example.com and a.b.example.com.
      </HelpRow>
      <HelpRow form={<Code>*.example.com</Code>}>
        Keeps every subdomain of example.com, but not example.com itself. A * can also stand for
        part of a name, as in <Code>ad*.example.com</Code>.
      </HelpRow>
      <HelpRow form={<Code>/^ads[0-9]+\.example\.com$/</Code>}>
        A regular expression between two slashes, in Rust regex syntax. It matches anywhere in a
        domain unless you anchor it with ^ and $, and it is case sensitive, so write it in lower
        case. Look-around and back-references are not supported.
      </HelpRow>
      <HelpRow form={<Code># a comment</Code>}>
        Everything from a # to the end of the line is ignored, so a note can follow a pattern. In a
        regular expression, write a literal # as <Code>\x23</Code>.
      </HelpRow>
    </dl>
  );
}

export function SyntaxHelp({ tab, categories }: { tab: EditorTab; categories: readonly string[] }) {
  return (
    <Card>
      <details className="group">
        <summary className="flex list-none items-center gap-2 px-[18px] py-3.5 text-sm font-semibold narrow:min-h-11 [&::-webkit-details-marker]:hidden">
          <Icon name="chevron-right" className="text-text-tertiary group-open:rotate-90" />
          {tab === 'sources' ? 'How a source line is written' : 'What each whitelist line matches'}
        </summary>
        <div className="border-t border-border px-[18px] py-2">
          {tab === 'sources' ? <SourcesHelp categories={categories} /> : <WhitelistHelp />}
        </div>
      </details>
    </Card>
  );
}
