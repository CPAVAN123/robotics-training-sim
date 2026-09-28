/**
 * Saved progress (best stars and personal bests per robot and lesson) in localStorage.
 * Storage can be missing or throw (private windows, blocked cookies, full quota): the app must
 * keep working, so every access is wrapped and falls back to in-memory progress.
 */
import type { RobotId } from '../core/types';
import type { LessonId, LessonResult, Stars } from './types';

export const PROGRESS_KEY = 'robotics-training-sim.progress.v1';

export interface LessonRecord {
  stars: Stars;
  best?: number;
  bestLabel?: string;
}

type ProgressData = Partial<Record<RobotId, Partial<Record<LessonId, LessonRecord>>>>;

/** The part of the Web Storage API we use (so tests can pass a fake). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class Progress {
  private data: ProgressData;

  constructor(private readonly storage: KeyValueStore | null = defaultStorage()) {
    this.data = this.load();
  }

  get(robot: RobotId, lesson: LessonId): LessonRecord | undefined {
    return this.data[robot]?.[lesson];
  }

  /** Stars for a lesson on a robot (0 if never completed). */
  stars(robot: RobotId, lesson: LessonId): Stars {
    return this.get(robot, lesson)?.stars ?? 0;
  }

  /** Keeps the best stars and personal best; returns what improved. */
  record(robot: RobotId, lesson: LessonId, result: LessonResult): { moreStars: boolean; newBest: boolean } {
    if (!result.counts) return { moreStars: false, newBest: false };
    const old = this.get(robot, lesson);
    const next: LessonRecord = { stars: Math.max(old?.stars ?? 0, result.stars) as Stars };
    let newBest = false;
    if (old?.best !== undefined) {
      next.best = old.best;
      next.bestLabel = old.bestLabel;
    }
    if (result.best && result.stars > 0) {
      const { value, lowerIsBetter, label } = result.best;
      const better = next.best === undefined || (lowerIsBetter ? value < next.best : value > next.best);
      if (better) {
        newBest = next.best !== undefined;
        next.best = value;
        next.bestLabel = label;
      }
    }
    this.data[robot] = { ...this.data[robot], [lesson]: next };
    this.save();
    return { moreStars: next.stars > (old?.stars ?? 0), newBest };
  }

  totalStars(robot: RobotId): number {
    return Object.values(this.data[robot] ?? {}).reduce((sum, r) => sum + (r?.stars ?? 0), 0);
  }

  private load(): ProgressData {
    try {
      const raw = this.storage?.getItem(PROGRESS_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      return sanitize(parsed);
    } catch {
      return {};
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(PROGRESS_KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: keep the progress for this session only.
    }
  }
}

function defaultStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const ROBOT_IDS: RobotId[] = ['g1', 'go2'];
const LESSON_IDS: LessonId[] = ['meet', 'course', 'push', 'lab'];

/** Keeps only well-formed records, so a corrupted or old save can't break the app. */
function sanitize(value: unknown): ProgressData {
  const out: ProgressData = {};
  if (!isObject(value)) return out;
  for (const robot of ROBOT_IDS) {
    const lessons = value[robot];
    if (!isObject(lessons)) continue;
    for (const lesson of LESSON_IDS) {
      const r = lessons[lesson];
      if (!isObject(r) || typeof r.stars !== 'number') continue;
      const record: LessonRecord = { stars: Math.max(0, Math.min(3, Math.round(r.stars))) as Stars };
      if (typeof r.best === 'number' && Number.isFinite(r.best)) record.best = r.best;
      if (typeof r.bestLabel === 'string') record.bestLabel = r.bestLabel;
      out[robot] = { ...out[robot], [lesson]: record };
    }
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
