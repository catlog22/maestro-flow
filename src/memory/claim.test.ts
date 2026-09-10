import { describe, expect, it } from 'vitest';

import { claimFromText, claimsCompete, polarityFromText } from './claim.js';
import { factsConflict } from './topic.js';

describe('working-memory claim polarity', () => {
  it('treats use-X-not-Y as prefer for the chosen tool', () => {
    expect(polarityFromText('use pnpm not npm')).toBe('prefer');
    expect(polarityFromText('use pnpm instead of npm')).toBe('prefer');
    expect(polarityFromText('用 pnpm 不要用 npm')).toBe('prefer');
    expect(claimFromText('use pnpm not npm').objects).toEqual(expect.arrayContaining(['pnpm', 'npm']));
    expect(claimFromText('use pnpm not npm').family).toBe('package-manager');
  });

  it('does not treat a bare "not" as avoid', () => {
    expect(polarityFromText('I do not think we need named exports')).toBe('neutral');
    expect(polarityFromText("don't use yarn for this repo")).toBe('avoid');
    expect(polarityFromText('never use default exports')).toBe('avoid');
  });

  it('overwrites exclusive family prefers including use-X-not-Y', () => {
    const bun = claimFromText('always use bun');
    const pnpm = claimFromText('use pnpm not npm');
    expect(bun.polarity).toBe('prefer');
    expect(pnpm.polarity).toBe('prefer');
    expect(claimsCompete(pnpm, bun)).toBe(true);
    expect(factsConflict(
      { type: 'user', text: 'use pnpm not npm', topic: 'package-manager' },
      { type: 'user', text: 'always use bun', topic: 'package-manager', status: 'active' },
    )).toBe(true);
  });

  it('does not let hedged chatter overwrite a real prefer', () => {
    expect(factsConflict(
      { type: 'user', text: 'I do not think we need named exports', topic: 'module-exports' },
      { type: 'user', text: 'prefer named exports', topic: 'module-exports', status: 'active' },
    )).toBe(false);
  });

  it('does not collide Chinese unknown-topic theme sentences', () => {
    expect(factsConflict(
      { type: 'user', text: '请记住使用深色主题配色方案', topic: 'general' },
      { type: 'user', text: '请记住使用浅色主题配色方案', topic: 'general', status: 'active' },
    )).toBe(false);
    expect(claimFromText('请记住使用深色主题配色方案').objects).toEqual(['深色主题配色方案']);
    expect(claimFromText('请记住使用浅色主题配色方案').objects).toEqual(['浅色主题配色方案']);
  });
});
