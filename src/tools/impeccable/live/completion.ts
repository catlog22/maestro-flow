/**
 * Completion type mapping for Impeccable live-session accept results.
 */

export type EventType = string;

export interface AcceptResult {
  handled?: boolean;
  carbonize?: boolean;
  mode?: string;
  error?: string;
  file?: string;
}

export type CompletionType = 'discarded' | 'error' | 'agent_done' | 'complete';

export interface CompletionAck {
  ok: boolean;
  type: CompletionType;
  final?: boolean;
  requiresComplete?: boolean;
  nextCommand?: string;
  message?: string;
  error?: string;
}

export function completionTypeForAcceptResult(
  eventType: EventType,
  acceptResult: AcceptResult | undefined,
): CompletionType {
  if (eventType === 'discard') return acceptResult?.handled === true ? 'discarded' : 'error';
  if (acceptResult?.handled === true && acceptResult?.carbonize === true) return 'agent_done';
  if (acceptResult?.handled === true) return 'complete';
  if (acceptResult?.mode === 'error') return 'error';
  return 'agent_done';
}

export function completionAckForAcceptResult(
  eventId: string,
  completionType: CompletionType,
  acceptResult: AcceptResult | undefined,
): CompletionAck {
  const ack: CompletionAck = { ok: true, type: completionType };
  if (acceptResult?.handled === true && acceptResult?.carbonize === true) {
    ack.final = false;
    ack.requiresComplete = true;
    ack.nextCommand = `live-complete --id ${eventId}`;
    ack.message =
      'Carbonize cleanup must be verified, then the session must be completed explicitly before polling again.';
  }
  return ack;
}
