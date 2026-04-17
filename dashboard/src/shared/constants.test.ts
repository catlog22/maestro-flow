import { describe, it, expect } from 'vitest';
import {
  PHASE_STATUSES,
  TASK_STATUSES,
  COLLAPSED_COLUMNS,
  SSE_EVENT_TYPES,
  API_ENDPOINTS,
  DEFAULT_CONFIG,
  STATUS_COLORS,
  WS_EVENT_TYPES,
  getDisplayStatus,
} from './constants.js';
import type { Issue } from './issue-types.js';

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'ISS-test-001',
    title: 'Test',
    description: 'desc',
    type: 'bug',
    priority: 'medium',
    status: 'open',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('PHASE_STATUSES', () => {
  it('contains 9 statuses', () => {
    expect(PHASE_STATUSES).toHaveLength(9);
  });

  it('includes expected statuses', () => {
    expect(PHASE_STATUSES).toContain('pending');
    expect(PHASE_STATUSES).toContain('completed');
    expect(PHASE_STATUSES).toContain('blocked');
  });
});

describe('TASK_STATUSES', () => {
  it('contains 4 statuses', () => {
    expect(TASK_STATUSES).toHaveLength(4);
  });

  it('includes pending and completed', () => {
    expect(TASK_STATUSES).toContain('pending');
    expect(TASK_STATUSES).toContain('completed');
  });
});

describe('COLLAPSED_COLUMNS', () => {
  it('has 6 columns', () => {
    expect(COLLAPSED_COLUMNS).toHaveLength(6);
  });

  it('covers all phase statuses', () => {
    const allStatuses = COLLAPSED_COLUMNS.flatMap((c) => c.statuses);
    for (const status of PHASE_STATUSES) {
      expect(allStatuses).toContain(status);
    }
  });

  it('each column has id and label', () => {
    for (const col of COLLAPSED_COLUMNS) {
      expect(typeof col.id).toBe('string');
      expect(typeof col.label).toBe('string');
      expect(Array.isArray(col.statuses)).toBe(true);
    }
  });
});

describe('SSE_EVENT_TYPES', () => {
  it('contains heartbeat and connected', () => {
    expect(SSE_EVENT_TYPES.HEARTBEAT).toBe('heartbeat');
    expect(SSE_EVENT_TYPES.CONNECTED).toBe('connected');
  });

  it('all values are non-empty strings', () => {
    for (const value of Object.values(SSE_EVENT_TYPES)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe('WS_EVENT_TYPES', () => {
  it('includes agent events', () => {
    expect(WS_EVENT_TYPES.AGENT_SPAWNED).toBe('agent:spawned');
    expect(WS_EVENT_TYPES.AGENT_STOPPED).toBe('agent:stopped');
  });

  it('includes execution events', () => {
    expect(WS_EVENT_TYPES.EXECUTION_STARTED).toBe('execution:started');
    expect(WS_EVENT_TYPES.EXECUTION_COMPLETED).toBe('execution:completed');
  });

  it('is a superset of SSE events', () => {
    for (const key of Object.keys(SSE_EVENT_TYPES)) {
      expect(WS_EVENT_TYPES[key]).toBe(SSE_EVENT_TYPES[key]);
    }
  });
});

describe('API_ENDPOINTS', () => {
  it('health endpoint is /api/health', () => {
    expect(API_ENDPOINTS.HEALTH).toBe('/api/health');
  });

  it('all endpoints start with /api/', () => {
    for (const ep of Object.values(API_ENDPOINTS)) {
      expect(ep).toMatch(/^\/api\//);
    }
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_CONFIG.serverPort).toBe(3001);
    expect(DEFAULT_CONFIG.serverHost).toBe('127.0.0.1');
    expect(DEFAULT_CONFIG.watchDebounceMs).toBe(150);
    expect(DEFAULT_CONFIG.sseHeartbeatMs).toBe(30_000);
    expect(DEFAULT_CONFIG.sseMaxConnections).toBe(10);
  });
});

describe('STATUS_COLORS', () => {
  it('has a color for each phase status', () => {
    for (const status of PHASE_STATUSES) {
      expect(STATUS_COLORS[status]).toBeDefined();
      expect(typeof STATUS_COLORS[status]).toBe('string');
    }
  });

  it('colors are hex strings', () => {
    for (const color of Object.values(STATUS_COLORS)) {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('getDisplayStatus', () => {
  it('returns open for default open issue', () => {
    expect(getDisplayStatus(makeIssue())).toBe('open');
  });

  it('returns closed for closed status', () => {
    expect(getDisplayStatus(makeIssue({ status: 'closed' }))).toBe('closed');
  });

  it('returns resolved for resolved status', () => {
    expect(getDisplayStatus(makeIssue({ status: 'resolved' }))).toBe('resolved');
  });

  it('returns in_progress for in_progress status', () => {
    expect(getDisplayStatus(makeIssue({ status: 'in_progress' }))).toBe('in_progress');
  });
});
