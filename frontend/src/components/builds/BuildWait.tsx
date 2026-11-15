import { buildNowLabel, cooldownSecondsLeft, describeBuildWait } from '../../lib/builds';
import { useNowEverySecond } from '../../lib/useNow';

function CountingDown({ endsAt }: { endsAt: number }) {
  const now = useNowEverySecond();
  return <>{buildNowLabel(cooldownSecondsLeft(endsAt, now.getTime()))}</>;
}

export function BuildNowLabel({ endsAt }: { endsAt: number | null }) {
  return endsAt === null ? <>{buildNowLabel(0)}</> : <CountingDown endsAt={endsAt} />;
}

export function BuildWait({ endsAt }: { endsAt: number }) {
  const now = useNowEverySecond();
  return <>{describeBuildWait(cooldownSecondsLeft(endsAt, now.getTime()))}</>;
}
