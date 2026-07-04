/**
 * Per-endpoint circuit breaker for explore jobs.
 *
 * Tracks consecutive failures per endpoint name. When failures reach
 * the configured threshold, the endpoint is marked "open" (tripped)
 * and remaining jobs are re-routed to a fallback endpoint.
 */

import type { LlmConfig } from './llm.js';

export interface CircuitBreakerConfig {
  /** Consecutive failures before tripping (default 3) */
  threshold?: number;
  /** Preferred fallback endpoint names, tried in order */
  fallbackOrder?: string[];
}

interface EndpointState {
  consecutiveFailures: number;
  open: boolean;
}

export interface NamedEndpointRef {
  name: string;
  llmConfig: LlmConfig;
  maxTurns?: number;
}

export class EndpointCircuitBreaker {
  private readonly threshold: number;
  private readonly fallbackOrder: string[];
  private readonly states = new Map<string, EndpointState>();
  private readonly onTrip?: (endpointName: string, failures: number) => void;

  constructor(
    config: CircuitBreakerConfig | undefined,
    opts?: { onTrip?: (endpointName: string, failures: number) => void },
  ) {
    this.threshold = config?.threshold ?? 3;
    this.fallbackOrder = config?.fallbackOrder ?? [];
    this.onTrip = opts?.onTrip;
  }

  private getState(name: string): EndpointState {
    let s = this.states.get(name);
    if (!s) {
      s = { consecutiveFailures: 0, open: false };
      this.states.set(name, s);
    }
    return s;
  }

  recordSuccess(endpointName: string): void {
    const s = this.getState(endpointName);
    s.consecutiveFailures = 0;
  }

  /** Record a failure. Returns true if the endpoint just tripped. */
  recordFailure(endpointName: string): boolean {
    const s = this.getState(endpointName);
    s.consecutiveFailures++;
    if (!s.open && s.consecutiveFailures >= this.threshold) {
      s.open = true;
      this.onTrip?.(endpointName, s.consecutiveFailures);
      return true;
    }
    return false;
  }

  isOpen(endpointName: string): boolean {
    return this.getState(endpointName).open;
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
