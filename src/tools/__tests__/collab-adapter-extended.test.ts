import { describe, it, expect } from 'vitest';

import { GitHubAdapter, SlackAdapter } from '../collab-adapter.js';

// ---------------------------------------------------------------------------
// Tests — validateConfig only (network calls not tested here)
// ---------------------------------------------------------------------------

describe('GitHubAdapter', () => {
  it('validates valid config', () => {
    const adapter = new GitHubAdapter();
    const valid = adapter.validateConfig({
      owner: 'acme',
      repo: 'project',
      token: 'ghp_abc123',
    });
    expect(valid).toBe(true);
    expect(adapter.name).toBe('github');
  });

  it('rejects config without owner', () => {
    const adapter = new GitHubAdapter();
    expect(adapter.validateConfig({ repo: 'x', token: 'y' })).toBe(false);
  });

  it('rejects config without repo', () => {
    const adapter = new GitHubAdapter();
    expect(adapter.validateConfig({ owner: 'x', token: 'y' })).toBe(false);
  });

  it('rejects config without token', () => {
    const adapter = new GitHubAdapter();
    expect(adapter.validateConfig({ owner: 'x', repo: 'y' })).toBe(false);
  });

  it('rejects empty strings', () => {
    const adapter = new GitHubAdapter();
    expect(adapter.validateConfig({ owner: '', repo: 'y', token: 'z' })).toBe(false);
  });
});

describe('SlackAdapter', () => {
  it('validates valid config with webhookUrl', () => {
    const adapter = new SlackAdapter();
    const valid = adapter.validateConfig({
      webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
    });
    expect(valid).toBe(true);
    expect(adapter.name).toBe('slack');
  });

  it('accepts optional channel', () => {
    const adapter = new SlackAdapter();
    const valid = adapter.validateConfig({
      webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
      channel: '#general',
    });
    expect(valid).toBe(true);
  });

  it('rejects config without webhookUrl', () => {
    const adapter = new SlackAdapter();
    expect(adapter.validateConfig({})).toBe(false);
  });

  it('rejects empty webhookUrl', () => {
    const adapter = new SlackAdapter();
    expect(adapter.validateConfig({ webhookUrl: '' })).toBe(false);
  });
});
