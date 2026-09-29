import { COURSE_LESSON } from './course';
import { LAB_LESSON } from './lab';
import { MEET_LESSON } from './meet';
import { PUSH_LESSON } from './push';
import type { LessonDef, LessonId } from './types';

/** Lessons in the order students should take them. */
export const LESSONS: LessonDef[] = [MEET_LESSON, COURSE_LESSON, PUSH_LESSON, LAB_LESSON];

export function lessonById(id: LessonId): LessonDef {
  const def = LESSONS.find((l) => l.id === id);
  if (!def) throw new Error(`Unknown lesson "${id}"`);
  return def;
}

/** The lesson after `id`, or null after the last one. */
export function nextLesson(id: LessonId): LessonDef | null {
  const i = LESSONS.findIndex((l) => l.id === id);
  return LESSONS[i + 1] ?? null;
}
