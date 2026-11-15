import fixture from '../../../tests/fixtures/job-progress.json';
import initialProgress from '../../../tests/fixtures/job-initial-progress.json';
import type {
  EnhancedJobProgress,
  FormatProgress,
  GenerationProgress,
  JobResult,
  SourceProgress,
  StageTimings,
  WhitelistPatternProgress,
  WhitelistProgress,
} from './index';

type JsonShape<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer Item)[]
        ? JsonShape<Item>[]
        : T extends object
          ? { [Key in keyof T]: JsonShape<T[Key]> }
          : T;

type SameKeys<Declared, Written> = [keyof Declared] extends [keyof Written]
  ? [keyof Written] extends [keyof Declared]
    ? true
    : never
  : never;

export const fixtureMatchesTheTypes = {
  queued: initialProgress satisfies JsonShape<EnhancedJobProgress>,
  midDownload: fixture.mid_download.progress satisfies JsonShape<EnhancedJobProgress>,
  midGeneration: fixture.mid_generation.progress satisfies JsonShape<EnhancedJobProgress>,
  completed: fixture.completed.progress satisfies JsonShape<EnhancedJobProgress>,
  result: fixture.completed.result satisfies JsonShape<JobResult>,
};

type Completed = typeof fixture.completed.progress;

export const typesDeclareExactlyTheWrittenKeys: {
  queued: SameKeys<EnhancedJobProgress, typeof initialProgress>;
  progress: SameKeys<EnhancedJobProgress, Completed>;
  source: SameKeys<SourceProgress, Completed['sources'][number]>;
  whitelist: SameKeys<WhitelistProgress, Completed['whitelist']>;
  pattern: SameKeys<WhitelistPatternProgress, Completed['whitelist']['patterns'][number]>;
  generation: SameKeys<GenerationProgress, Completed['generation']>;
  format: SameKeys<FormatProgress, Completed['generation']['formats'][number]>;
  stages: SameKeys<StageTimings, Completed['stages']>;
  result: SameKeys<JobResult, typeof fixture.completed.result>;
} = {
  queued: true,
  progress: true,
  source: true,
  whitelist: true,
  pattern: true,
  generation: true,
  format: true,
  stages: true,
  result: true,
};
