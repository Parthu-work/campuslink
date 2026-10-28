import { PullToRefresh } from './pull-to-refresh';
import { RealtimeBridge } from './realtime-bridge';

/** Shell behaviour that starts after the first screen has painted, loaded as one file. */
export function IdleParts({ realtime, pull }: { realtime: boolean; pull: boolean }) {
  return (
    <>
      {realtime && <RealtimeBridge />}
      {pull && <PullToRefresh />}
    </>
  );
}
