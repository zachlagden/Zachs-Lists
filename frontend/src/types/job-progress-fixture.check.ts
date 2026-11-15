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

const completed = fixture.completed.progress;

export const typesDeclareExactlyTheWrittenKeys: {
  queued: SameKeys<EnhancedJobProgress, typeof initialProgress>;
  progress: SameKeys<EnhancedJobProgress, typeof completed>;
  source: SameKeys<SourceProgress, (typeof completed.sources)[number]>;
  whitelist: SameKeys<WhitelistProgress, typeof completed.whitelist>;
  pattern: SameKeys<WhitelistPatternProgress, (typeof completed.whitelist.patterns)[number]>;
  generation: SameKeys<GenerationProgress, typeof completed.generation>;
  format: SameKeys<FormatProgress, (typeof completed.generation.formats)[number]>;
  stages: SameKeys<StageTimings, typeof completed.stages>;
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
