import { describe, expect, it } from 'vitest';

import type { Keyframe } from '../project/project.types';
import { evaluateProperty } from './animation';

const keyframes = (
  interpolation: Keyframe['interpolation'] = 'linear',
): Keyframe[] => [
  { id: 'a', time: 0, value: 10, interpolation },
  { id: 'b', time: 2, value: 30, interpolation: 'linear' },
];

describe('evaluateProperty', () => {
  it('uses the fallback for invalid time or no keyframes', () => {
    expect(evaluateProperty([], 1, 7)).toBe(7);
    expect(evaluateProperty(keyframes(), Number.NaN, 7)).toBe(7);
  });

  it('holds endpoint values outside the keyed range', () => {
    expect(evaluateProperty(keyframes(), -1, 0)).toBe(10);
    expect(evaluateProperty(keyframes(), 3, 0)).toBe(30);
  });

  it('linearly interpolates and sorts without mutating input', () => {
    const unordered = keyframes().reverse();
    expect(evaluateProperty(unordered, 1, 0)).toBe(20);
    expect(unordered[0].id).toBe('b');
  });

  it('supports hold and all ease curves', () => {
    expect(evaluateProperty(keyframes('hold'), 1, 0)).toBe(10);
    expect(evaluateProperty(keyframes('ease-in'), 1, 0)).toBe(15);
    expect(evaluateProperty(keyframes('ease-out'), 1, 0)).toBe(25);
    expect(evaluateProperty(keyframes('ease-in-out'), 0.5, 0)).toBe(12.5);
    expect(evaluateProperty(keyframes('ease-in-out'), 1.5, 0)).toBe(27.5);
  });

  it('uses the last keyframe at duplicate times and ignores invalid keys', () => {
    const duplicate = [
      { id: 'bad', time: Number.NaN, value: 80, interpolation: 'linear' },
      { id: 'first', time: 1, value: 10, interpolation: 'linear' },
      { id: 'last', time: 1, value: 20, interpolation: 'linear' },
      { id: 'end', time: 2, value: 30, interpolation: 'linear' },
    ] satisfies Keyframe[];
    expect(evaluateProperty(duplicate, 1, 0)).toBe(20);
  });
});
