/**
 * Phase Orchestrator - Structured team phase management.
 *
 * Manages phase transitions with guard evaluation, fix retry counting,
 * state broadcast via team-msg, and transition persistence.
 */

import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { resolveTeamWorkDir } from '../tools/team-run-paths.js';
import { evaluatePhaseGate } from '../tools/phase-gate-evaluator.js';
import type { PhaseGateInput } from '../tools/phase-gate-evaluator.js';
import {
  TeamPhase,
  TRANSITIONS,
  type PhaseGateConfig,
  type PhaseStatus,
  type PhaseTransitionRecord,
} from './phase-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FIX_ATTEMPTS = 3;
const DEFAULT_TRIGGER = 'phase_orchestrator';

// ---------------------------------------------------------------------------
// Transition result
// ---------------------------------------------------------------------------

export interface TransitionResult {
  success: boolean;
  from: TeamPhase;
  to: TeamPhase;
  /** Non-empty when success=false, explains why the transition was rejected */
  reason?: string;
  /** Gate evaluation reasons (populated even on success if gates were soft-blocked and forced) */
  gateReasons: string[];
}

// ---------------------------------------------------------------------------
// PhaseOrchestrator
// ---------------------------------------------------------------------------

export class PhaseOrchestrator {
  private readonly sessionId: string;
  private _currentPhase: TeamPhase;
  private _fixAttempts: number;
  private readonly _history: PhaseTransitionRecord[];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this._currentPhase = TeamPhase.planning;
    this._fixAttempts = 0;
    this._history = [];
  }

  /** Current phase of the team workflow */
  get currentPhase(): TeamPhase {
    return this._currentPhase;
  }

  /** Number of fix attempts in the current fix loop */
  get fixAttempts(): number {
    return this._fixAttempts;
  }

  // -------------------------------------------------------------------------
  // transitionTo
  // -------------------------------------------------------------------------

  /**
   * Attempt to transition to `targetPhase`.
   *
   * Steps:
   * 1. Validate the transition exists in TRANSITIONS map
   * 2. Check fix retry limit for fix->review transitions
   * 3. Evaluate phase-gate guard (if gateConfig provided)
   * 4. Apply the transition, update counters, record history
   * 5. Broadcast state_update via team-msg opLog
   * 6. Persist transition to transitions.jsonl
   */
  transitionTo(
    targetPhase: TeamPhase,
    options?: {
      trigger?: string;
      force?: boolean;
      gateConfig?: PhaseGateConfig;
      /** Callback to broadcast via team-msg (decoupled from direct import) */
      broadcast?: (sessionId: string, phase: TeamPhase, fixAttempts: number) => void;
    },
  ): TransitionResult {
    const trigger = options?.trigger ?? DEFAULT_TRIGGER;
    const force = options?.force ?? false;
    const gateConfig = options?.gateConfig;

    // 1. Validate transition is allowed
    const allowedTargets = TRANSITIONS.get(this._currentPhase);
    if (!allowedTargets) {
      return reject(this._currentPhase, targetPhase, `No transitions defined from ${this._currentPhase}`);
    }

    const rule = allowedTargets.find((r) => r.to === targetPhase);
    if (!rule) {
      const allowed = allowedTargets.map((r) => r.to).join(', ');
      return reject(this._currentPhase, targetPhase, `Invalid transition: ${this._currentPhase} -> ${targetPhase}. Allowed: ${allowed}`);
    }

    // 2. Fix retry limit
    // Checked when trying to enter fix (verification -> fix) or when leaving fix (fix -> review)
    if (this._currentPhase === TeamPhase.verification && targetPhase === TeamPhase.fix) {
      if (this._fixAttempts >= MAX_FIX_ATTEMPTS) {
        // Force transition to complete with warning instead of rejecting
        const forcedResult = this.applyTransition(
          TeamPhase.complete,
          trigger,
          true,
          [`Max fix attempts (${MAX_FIX_ATTEMPTS}) reached, forcing transition to complete`],
          options?.broadcast,
        );
        return { ...forcedResult, reason: `Max fix attempts (${MAX_FIX_ATTEMPTS}) exceeded, forced to complete` };
      }
    }
    if (this._currentPhase === TeamPhase.fix && targetPhase === TeamPhase.review) {
      // Count this as a completed fix cycle
      this._fixAttempts++;
    }

    // 3. Phase-gate evaluation
    let gateReasons: string[] = [];
    if (gateConfig) {
      const gate = evaluatePhaseGate(gateConfig.gateInput);
      if (!gate.allowed) {
        if (!gate.overridable) {
          // Hard block - cannot be overridden
          return reject(this._currentPhase, targetPhase, `Hard gate block: ${gate.reasons.join('; ')}`, gate.reasons);
        }
        if (!force && !gateConfig.allowForceOverride) {
          return reject(this._currentPhase, targetPhase, `Gate blocked: ${gate.reasons.join('; ')}`, gate.reasons);
        }
        // Force override - proceed but record reasons
        gateReasons = gate.reasons;
      }
    }

    // 4-6. Apply transition
    return this.applyTransition(targetPhase, trigger, force, gateReasons, options?.broadcast);
  }

  // -------------------------------------------------------------------------
  // getPhaseStatus
  // -------------------------------------------------------------------------

  getPhaseStatus(): PhaseStatus {
    const allowedTargets = TRANSITIONS.get(this._currentPhase) ?? [];
    return {
      current: this._currentPhase,
      fixAttempts: this._fixAttempts,
      history: [...this._history],
      nextTransitions: allowedTargets.map((r) => r.to),
    };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private applyTransition(
    targetPhase: TeamPhase,
    trigger: string,
    force: boolean,
    gateReasons: string[],
    broadcast?: (sessionId: string, phase: TeamPhase, fixAttempts: number) => void,
  ): TransitionResult {
    const from = this._currentPhase;

    // Update fix counter
    if (targetPhase === TeamPhase.complete || targetPhase === TeamPhase.planning) {
      // Reset fix counter when leaving the fix loop or restarting
      this._fixAttempts = 0;
    }

    // Record history
    const record: PhaseTransitionRecord = {
      from,
      to: targetPhase,
      timestamp: new Date().toISOString(),
      trigger,
      force,
      gateReasons,
    };
    this._history.push(record);

    // Apply
    this._currentPhase = targetPhase;

    // Broadcast via callback
    if (broadcast) {
      broadcast(this.sessionId, this._currentPhase, this._fixAttempts);
    }

    // Persist to transitions.jsonl
    this.persistTransition(record);

    return { success: true, from, to: targetPhase, gateReasons };
  }

  /**
   * Append transition record to {run_dir}/work/team/transitions.jsonl.
   * Legacy team session IDs retain their former storage location.
   */
  private persistTransition(record: PhaseTransitionRecord): void {
    try {
      const dir = resolveTeamWorkDir(this.sessionId);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const filePath = join(dir, 'transitions.jsonl');
      appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
    } catch {
      // Persistence failure must not block the transition
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reject(
  from: TeamPhase,
  to: TeamPhase,
  reason: string,
  gateReasons: string[] = [],
): TransitionResult {
  return { success: false, from, to, reason, gateReasons };
}
