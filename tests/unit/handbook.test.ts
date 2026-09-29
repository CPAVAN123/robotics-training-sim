import { describe, expect, it } from 'vitest';
import type { RobotId } from '../../src/core/types';
import { handbook } from '../../src/lessons/handbook';

describe('robot handbook', () => {
  for (const robot of ['g1', 'go2'] as RobotId[]) {
    it(`has complete, uniquely named chapters for ${robot}`, () => {
      const chapters = handbook(robot);
      expect(chapters.map((c) => c.id)).toEqual(['overview', 'components', 'sensors', 'control', 'balance', 'simulator', 'world', 'glossary']);
      for (const c of chapters) {
        expect(c.title && c.summary).toBeTruthy();
        expect(c.sections.length).toBeGreaterThan(0);
        for (const s of c.sections) expect(s.paragraphs.length + (s.facts?.length ?? 0)).toBeGreaterThan(0);
      }
    });
  }

  it('describes each robot with its own controller', () => {
    const text = (robot: RobotId) => JSON.stringify(handbook(robot).find((c) => c.id === 'control'));
    expect(text('g1')).toContain('neural network');
    expect(text('go2')).toContain('Raibert');
  });
});
