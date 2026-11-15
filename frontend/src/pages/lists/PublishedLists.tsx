import { useState } from 'react';
import type { UserListsResponse } from '../../api/lists';
import { FormatSwitch } from '../../components/lists/FormatSwitch';
import { Card, CardHeader } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Layout';
import { StatusPill } from '../../components/ui/StatusPill';
import { UrlField } from '../../components/ui/UrlField';
import { SITE_URL } from '../../config/site';
import { formatDateTime } from '../../lib/format';
import {
  FORMAT_NAMES,
  FORMAT_SAMPLES,
  FORMAT_USES,
  SERVER_DEFAULT_FORMAT,
  offersFormat,
  orderLists,
  userListAddress,
} from '../../lib/listCatalogue';
import type { Job, ListFormat } from '../../types';
import { compressedSize } from '../../lib/builds';
import { describeList, isPublicList } from './listsFacts';

export interface PublishedListsProps {
  username: string;
  lists: UserListsResponse;
  publishedBuild: Job | null;
  now: Date;
}

export function PublishedLists({ username, lists, publishedBuild, now }: PublishedListsProps) {
  const [format, setFormat] = useState<ListFormat>(SERVER_DEFAULT_FORMAT);
  const ordered = orderLists(lists.lists, (list) => list.name);
  const published = formatDateTime(lists.published_at, { now });
  return (
    <Card as="section" aria-labelledby="published-lists">
      <CardHeader
        title="Published lists"
        titleId="published-lists"
        actions={
          <>
            {published ? <span className="narrow:hidden">Published {published}</span> : null}
            <FormatSwitch value={format} onChange={setFormat} />
          </>
        }
      />
      <p className="border-b border-border px-[18px] py-3 text-[13px] text-text-secondary narrow:px-3">
        {FORMAT_USES[format]} A line looks like{' '}
        <code translate="no" className="mono rounded-md bg-sunken px-1.5 py-0.5 break-all">
          {FORMAT_SAMPLES[format]}
        </code>
        .
      </p>
      <ul className="m-0 list-none p-0">
        {ordered.map((list) => (
          <li
            key={list.name}
            className="grid gap-2.5 border-b border-border px-[18px] py-3.5 last:border-b-0 narrow:px-3"
          >
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h3 className="font-medium" translate="no">
                {list.name}
              </h3>
              {isPublicList(list) ? (
                <StatusPill icon="globe">Public</StatusPill>
              ) : (
                <StatusPill icon="dash">Not public</StatusPill>
              )}
              <span className="num text-[13px] text-text-secondary">
                {describeList(list, compressedSize(publishedBuild, list.name, format), now)}
              </span>
            </div>
            {offersFormat(list.formats, format) ? (
              <UrlField
                label={`Address of the ${list.name} list in the ${FORMAT_NAMES[format]} format`}
                url={userListAddress(SITE_URL, username, list.name, format)}
              />
            ) : (
              <p className="text-[13px] text-text-tertiary">
                This list is not published in the {FORMAT_NAMES[format]} format.
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PublishedListsSkeleton() {
  return (
    <Card>
      <div className="border-b border-border px-[18px] py-3.5">
        <Skeleton className="h-5 w-32" />
      </div>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="grid gap-2.5 border-b border-border px-[18px] py-3.5 last:border-b-0"
        >
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-[52px] w-full" />
        </div>
      ))}
    </Card>
  );
}
