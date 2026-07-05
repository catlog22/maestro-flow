/**
 * Per-endpoint circuit breaker for explore jobs.
 *
 * Tracks consecutive failures per endpoint name. When failures reach
 * the configured threshold, the endpoint is marked "open" (tripped)
 * and remaining jobs are re-routed to a fallback endpoint.
 *
 * Supports time-based auto-recovery: tripped endpoints become eligible
 * for retry after `resetAfterMs` (default 1 hour). Persistent state
 * across runs via JSON file.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { LlmConfig } from './llm.js';

const STATE_PATH = join(homedir(), '.maestro', '.explore-circuit-state.json');

export interface CircuitBreakerConfig {
  /** Consecutive failures before tripping (default 3) */
  threshold?: number;
  /** Preferred fallback endpoint names, tried in order */
  fallbackOrder?: string[];
  /** Ms before a tripped endpoint is retried (default 3600000 = 1h). 0 = no auto-reset. */
  resetAfterMs?: number;
}

interface EndpointState {
  consecutiveFailures: number;
  open: boolean;
  trippedAt?: number;
}

export interface NamedEndpointRef {
  name: string;
  llmConfig: LlmConfig;
  maxTurns?: number;
}

interface PersistedState {
  endpoints: Record<string, { trippedAt: number }>;
}

export class EndpointCircuitBreaker {
  private readonly threshold: number;
  private readonly fallbackOrder: string[];
  private readonly resetAfterMs: number;
  private readonly states = new Map<string, EndpointState>();
  private readonly onTrip?: (endpointName: string, failures: number) => void;

  constructor(
    config: CircuitBreakerConfig | undefined,
    opts?: { onTrip?: (endpointName: string, failures: number) => void },
  ) {
    this.threshold = config?.threshold ?? 3;
    this.fallbackOrder = config?.fallbackOrder ?? [];
    this.resetAfterMs = config?.resetAfterMs ?? 3_600_000;
    this.onTrip = opts?.onTrip;
    this.loadPersistedState();
  }

  private getState(name: string): EndpointState {
    let s = this.states.get(name);
    if (!s) {
      s = { consecutiveFailures: 0, open: false };
      this.states.set(name, s);
    }
    return s;
  }

  private loadPersistedState(): void {
    try {
      const raw = readFileSync(STATE_PATH, 'utf-8');
      const data = JSON.parse(raw) as PersistedState;
      const now = Date.now();
      for (const [name, info] of Object.entries(data.endpoints ?? {})) {
        if (this.resetAfterMs > 0 && now - info.trippedAt >= this.resetAfterMs) continue;
        this.states.set(name, {
          consecutiveFailures: this.threshold,
          open: true,
          trippedAt: info.trippedAt,
        });
      }
    } catch {
      // No state file or invalid — start fresh
    }
  }

  persistState(): void {
    const endpoints: Record<string, { trippedAt: number }> = {};
    for (const [name, state] of this.states) {
      if (state.open && state.trippedAt) {
        endpoints[name] = { trippedAt: state.trippedAt };
      }
    }
    try {
      mkdirSync(dirname(STATE_PATH), { recursive: true });
      writeFileSync(STATE_PATH, JSON.stringify({ endpoints }, null, 2));
    } catch {
      // Best-effort persistence
    }
  }

  recordSuccess(endpointName: string): void {
    const s = this.getState(endpointName);
    s.consecutiveFailures = 0;
    if (s.open) {
      s.open = false;
      s.trippedAt = undefined;
    }
  }

  /** Record a failure. Returns true if the endpoint just tripped. */
  recordFailure(endpointName: string): boolean {
    const s = this.getState(endpointName);
    s.consecutiveFailures++;
    if (!s.open && s.consecutiveFailures >= this.threshold) {
      s.open = true;
      s.trippedAt = Date.now();
      this.onTrip?.(endpointName, s.consecutiveFailures);
      return true;
    }
    return false;
  }

  /** Force-trip an endpoint (e.g. after pre-flight probe failure). */
  trip(endpointName: string): void {
    const s = this.getState(endpointName);
    if (s.open) return;
    s.open = true;
    s.trippedAt = Date.now();
    s.consecutiveFailures = this.threshold;
    this.onTrip?.(endpointName, 0);
  }

  isOpen(endpointName: string): boolean {
    const s = this.getState(endpointName);
    if (!s.open) return false;
    if (this.resetAfterMs > 0 && s.trippedAt && Date.now() - s.trippedAt >= this.resetAfterMs) {
      s.open = false;
      s.consecutiveFailures = 0;
      s.trippedAt = undefined;
      return false;
    }
    return true;
  }

  /**
   * Find a healthy fallback endpoint for a tripped one.
   * Tries fallbackOrder first, then any remaining healthy endpoint.
   */
  selectFallback(
    trippedName: string,
    allEndpoints: NamedEndpointRef[],
  ): NamedEndpointRef | null {
    const epMap = new Map(allEndpoints.map(ep => [ep.name, ep]));

    // Try configured fallback order first
    for (const name of this.fallbackOrder) {
      if (name === trippedName) continue;
      if (this.isOpen(name)) continue;
      const ep = epMap.get(name);
      if (ep) return ep;
    }

    // Try any healthy endpoint not in fallback order
    for (const ep of allEndpoints) {
      if (ep.name === trippedName) continue;
      if (this.isOpen(ep.name)) continue;
      if (this.fallbackOrder.includes(ep.name)) continue;
      return ep;
    }

    return null;
  }

  /** Summary of tripped endpoints for logging */
  getTrippedEndpoints(): string[] {
    const tripped: string[] = [];
    for (const [name, state] of this.states) {
      if (state.open) tripped.push(name);
    }
    return tripped;
  }
}
