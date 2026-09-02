import { CliHistoryStore, type ExecutionMeta } from '../agents/cli-history-store.js';
import {
  type DelegateBrokerApi,
  type DelegateMessageDelivery,
  type DelegateQueuedMessage,
} from './delegate-broker.js';
import { DelegateBrokerClient } from './delegate-broker-client.js';
import {
  launchDetachedDelegateWorker,
  type DelegateExecutionRequest,
} from '../commands/delegate.js';
import type { AgentRepositoryContext } from '../../shared/agent-types.js';
import { resolveAgentRepositoryContext } from '../repository/context.js';
import {
  deriveExecutionStatus,
  deriveDelegateStatus,
  type DelegateJobLike,
} from '../utils/cli-format.js';

export interface DelegateMessageInput {
  execId: string;
  message: string;
  delivery: DelegateMessageDelivery;
  requestedBy?: string;
}

export interface DelegateMessageResult {
  execId: string;
  accepted: true;
  delivery: DelegateMessageDelivery;
  status: string;
  queuedMessage: DelegateQueuedMessage;
  immediateDispatch: boolean;
  previousStatus: string;
  queueDepth: number;
}

export interface DelegateMessageDependencies {
  historyStore?: CliHistoryStore;
  delegateBroker?: DelegateBrokerApi;
  launchDetachedDelegate?: (request: DelegateExecutionRequest) => void;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter(
    (item): item is string => typeof item === 'string',
  );
  return strings.length > 0 ? strings : undefined;
}

export function normalizeDelegateExecId(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('cli-history-')
    ? trimmed.slice('cli-history-'.length)
    : trimmed;
}

export { deriveExecutionStatus, deriveDelegateStatus, type DelegateJobLike };

/**
 * Map Maestro-internal status names to SEP-1686 Task Lifecycle standard names.
 * queued → submitted, running → working, input_required → input_required,
 * all others pass through unchanged.
 */
export function toSep1686Status(maestroStatus: string): string {
  switch (maestroStatus) {
    case 'queued':
      return 'submitted';
    case 'running':
      return 'working';
    default:
      return maestroStatus;
  }
}

export function buildDelegateRequestFromState(
  execId: string,
  message: string,
  meta: ExecutionMeta | null,
  job: { metadata?: Record<string, unknown> | null } | null,
): DelegateExecutionRequest | null {
  const metadata = job?.metadata ?? null;
  const tool = meta?.tool ?? (typeof metadata?.tool === 'string' ? metadata.tool : null);
  const metaMode = meta?.mode === 'analysis' || meta?.mode === 'write'
    ? meta.mode
    : null;
  const metadataMode = metadata?.mode === 'analysis' || metadata?.mode === 'write'
    ? metadata.mode
    : null;
  const mode: 'analysis' | 'write' | null = metaMode ?? metadataMode;
  const workDir = meta?.workDir ?? (typeof metadata?.workDir === 'string' ? metadata.workDir : null);
  const rawRepositoryContext = metadata?.repositoryContext;
  let repositoryContext = rawRepositoryContext
    && typeof rawRepositoryContext === 'object'
    && typeof (rawRepositoryContext as Partial<AgentRepositoryContext>).currentProjectRoot === 'string'
    ? rawRepositoryContext as unknown as AgentRepositoryContext
    : null;
  if (!tool || !mode || !workDir) return null;
  if (!repositoryContext) {
    try {
      repositoryContext = resolveAgentRepositoryContext(workDir, {
        allowLegacyReadFallback: mode === 'analysis',
      });
    } catch {
      return null;
    }
  }
  if (mode === 'write' && (!repositoryContext.currentRepoId || !repositoryContext.identityPersisted)) return null;

  return {
    prompt: message,
    tool,
    mode,
    model: meta?.model ?? (typeof metadata?.model === 'string' ? metadata.model : undefined),
    workDir,
    rule: typeof metadata?.rule === 'string' ? metadata.rule : undefined,
    execId,
    resume: execId,
    includeDirs: readStringArray(metadata?.includeDirs),
    sessionId: typeof metadata?.sessionId === 'string' ? metadata.sessionId : undefined,
    backend: metadata?.backend === 'terminal' ? 'terminal' : 'direct',
    repositoryContext,
  };
}

export function handleDelegateMessage(
  input: DelegateMessageInput,
  dependencies: DelegateMessageDependencies = {},
): DelegateMessageResult {
  const historyStore = dependencies.historyStore ?? new CliHistoryStore();
  const delegateBroker = dependencies.delegateBroker ?? new DelegateBrokerClient();
  const launchDelegate = dependencies.launchDetachedDelegate ?? launchDetachedDelegateWorker;
  const execId = normalizeDelegateExecId(input.execId);
  const message = input.message.trim();

  if (!execId) {
    throw new Error('execId is required');
  }
  if (!message) {
    throw new Error('message is required');
  }

  const meta = historyStore.loadMeta(execId);
  const job = delegateBroker.getJob(execId);
  if (!meta && !job) {
    throw new Error(`Delegate execution not found: ${execId}`);
  }
  if (!job) {
    throw new Error(`Delegate broker state unavailable for: ${execId}`);
  }

  const currentStatus = deriveDelegateStatus(meta, job);
  const queued = delegateBroker.queueMessage({
    jobId: execId,
    message,
    delivery: input.delivery,
    requestedBy: input.requestedBy,
  });

  let statusAfterQueue = deriveDelegateStatus(meta, delegateBroker.getJob(execId));
  let immediateDispatch = false;

  if (
    currentStatus === 'completed'
    || currentStatus === 'failed'
    || currentStatus === 'cancelled'
  ) {
    const request = buildDelegateRequestFromState(execId, message, meta, job);
    if (!request) {
      delegateBroker.updateMessage({
        jobId: execId,
        messageId: queued.messageId,
        status: 'dropped',
        dispatchReason: 'missing-delegate-context',
      });
      throw new Error(
        `Unable to reconstruct delegate request for terminal execution: ${execId}`,
      );
    }

    try {
      launchDelegate(request);
      delegateBroker.updateMessage({
        jobId: execId,
        messageId: queued.messageId,
        status: 'dispatched',
        dispatchReason: `terminal:${currentStatus}`,
      });
      immediateDispatch = true;
      statusAfterQueue = deriveDelegateStatus(
        historyStore.loadMeta(execId),
        delegateBroker.getJob(execId),
      );
    } catch {
      delegateBroker.updateMessage({
        jobId: execId,
        messageId: queued.messageId,
        status: 'dropped',
        dispatchReason: 'launch-failed',
      });
      throw new Error(`Failed to relaunch delegate for terminal execution: ${execId}`);
    }
  } else if (input.delivery === 'inject') {
    // Inject delivery: queue the message for poller pickup. The poller in
    // cli-agent-runner auto-routes based on adapter capabilities:
    //   - interactive adapter → sendMessage (no interruption)
    //   - non-interactive adapter → requestCancel + resume
    statusAfterQueue = deriveDelegateStatus(meta, delegateBroker.getJob(execId));
  }

  const queuedMessage = delegateBroker
    .listMessages(execId)
    .find((item: DelegateQueuedMessage) => item.messageId === queued.messageId) ?? queued;

  return {
    execId,
    accepted: true,
    delivery: input.delivery,
    status: statusAfterQueue,
    queuedMessage,
    immediateDispatch,
    previousStatus: currentStatus,
    queueDepth: delegateBroker
      .listMessages(execId)
      .filter((item: DelegateQueuedMessage) => item.status === 'queued')
      .length,
  };
}
