import { useQuery } from '@tanstack/react-query';
import { defaultListsQuery, featuredListsQuery } from '../../api/lists';
import { DefaultListsCard } from '../../components/lists/DefaultListsCard';
import { PageHeader, Stack } from '../../components/ui/Layout';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';
import { FeaturedLists } from './FeaturedLists';
import { HowToUse } from './HowToUse';

const DESCRIPTION =
  'Ready-made blocklists that need no account, in the hosts, plain and Adblock formats, with the address of each one.';

export default function BrowsePage() {
  useDocumentMeta('Default and featured lists', DESCRIPTION);
  const defaultLists = useQuery(defaultListsQuery());
  const featuredLists = useQuery(featuredListsQuery());
  return (
    <div className="mx-auto max-w-[1160px] px-6 pt-8 pb-16 narrow:pt-4">
      <PageHeader
        title="Default and featured lists"
        description="Ready-made blocklists that need no account. Pick a format, copy the address and add it to your blocker."
      />
      <Stack>
        <DefaultListsCard query={defaultLists} detailed />
        <FeaturedLists query={featuredLists} />
        <HowToUse />
      </Stack>
    </div>
  );
}
