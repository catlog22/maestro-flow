import { describe, expect, it } from 'vitest';
import { normalizeHookToggleKey, normalizeHookToggles } from './index.js';

describe('hook toggle key normalization', () => {
  it('normalizes CLI and env-style hook names to runner keys', () => {
    expect(normalizeHookToggleKey('preflight-guard')).toBe('preflightGuard');
    expect(normalizeHookToggleKey('search-cache-invalidator')).toBe('searchCacheInvalidator');
    expect(normalizeHookToggleKey('telemetry')).toBe('telemetry');
  });

  it('migrates persisted aliases and lets canonical keys win', () => {
    expect(normalizeHookToggles({
      'preflight-guard': false,
      preflightGuard: true,
      'spec-validator': false,
    })).toEqual({
      preflightGuard: true,
      specValidator: false,
    });
  });
});
