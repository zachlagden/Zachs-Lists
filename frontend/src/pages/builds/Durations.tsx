import { durationBetween, formatClockTime, formatFullDateTime } from '../../lib/format';
import { describeSeconds } from './text';
import { useSecondsClock } from './useSecondsClock';

export function LiveDuration({ since }: { since: string }) {
  const now = useSecondsClock();
  const seconds = durationBetween(since, now);
  return <>{seconds === null ? '' : describeSeconds(seconds)}</>;
}

export function Duration({ since, until }: { since: string; until: string | null }) {
  if (until === null) return <LiveDuration since={since} />;
  const seconds = durationBetween(since, until);
  return <>{seconds === null ? '' : describeSeconds(seconds)}</>;
}

export function ClockTime({ at }: { at: string }) {
  return (
    <time dateTime={at} title={formatFullDateTime(at)}>
      {formatClockTime(at)}
    </time>
  );
}
