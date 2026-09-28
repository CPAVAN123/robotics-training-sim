import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { G1Policy, type G1PolicyWeights } from '../../src/robots/g1/policy';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;

describe('G1 policy forward pass', () => {
  const weights = readJson<G1PolicyWeights>('../../public/policies/g1_walk.json');
  // 100 consecutive policy steps recorded from PyTorch by tools/g1_reference.py (LSTM state carried over).
  const golden = readJson<{ steps: { obs: number[]; action: number[] }[] }>('../fixtures/g1_golden.json');

  it('matches PyTorch on all 100 recorded steps (max |diff| < 1e-4)', () => {
    const policy = new G1Policy(weights);
    expect(golden.steps).toHaveLength(100);
    let maxDiff = 0;
    for (const { obs, action } of golden.steps) {
      const out = policy.forward(Float32Array.from(obs));
      for (let j = 0; j < action.length; j++) maxDiff = Math.max(maxDiff, Math.abs(out[j] - action[j]));
    }
    console.log(`G1 policy vs PyTorch: max |action diff| over 100 steps = ${maxDiff.toExponential(2)}`);
    expect(maxDiff).toBeLessThan(1e-4);
  });

  it('reset() clears the LSTM memory so an episode replays identically', () => {
    const policy = new G1Policy(weights);
    const first = golden.steps.slice(0, 5).map(({ obs }) => Array.from(policy.forward(Float32Array.from(obs))));
    policy.reset();
    const again = golden.steps.slice(0, 5).map(({ obs }) => Array.from(policy.forward(Float32Array.from(obs))));
    expect(again).toEqual(first);
  });

  it('carries memory between steps (the same observation gives a different action later)', () => {
    const policy = new G1Policy(weights);
    const obs = Float32Array.from(golden.steps[0].obs);
    const a1 = Array.from(policy.forward(obs));
    const a2 = Array.from(policy.forward(obs));
    expect(a2).not.toEqual(a1);
  });

  it('rejects weights of the wrong shape', () => {
    const bad = { ...weights, hidden: 32 };
    expect(() => new G1Policy(bad)).toThrow(/shape/);
  });
});
