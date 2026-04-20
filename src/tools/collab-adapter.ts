/**
 * Collaboration adapter interface and registry (team-lite collaboration).
 *
 * Provides a pluggable notification layer that maps collab events to external
 * services (DingTalk, Linear, etc.). Adapters are configured via
 * `.workflow/collab/adapters.json` and instantiated on demand.
 *
 * Fire-and-forget contract: `notifyAdapters()` is synchronous (void return),
 * spawns async work internally, and NEVER throws -- matching the
 * `reportActivity` pattern in `team-activity.ts`.
 *
 * Strict namespace separation: this module belongs to the HUMAN collaboration
 * domain (`.workflow/collab/`).
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:https';

import { getProjectRoot } from '../utils/path-validator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollabEventType =
  | 'task.created'
  | 'task.assigned'
  | 'task.status_changed'
  | 'task.checked'
  | 'role.changed';

export interface CollabEvent {
  type: CollabEventType;
  payload: Record<string, unknown>;
  recipients?: string[];
}

export interface CollabAdapter {
  name: string;
  sendNotification(event: CollabEvent): Promise<void>;
  validateConfig(config: Record<string, unknown>): boolean;
}

/**
 * Adapter configuration shape.
 *
 * `enabled` lists adapter names to activate. Every other top-level key holds
 * the per-adapter config block (arbitrary key-value pairs).
 *
 * The index signature uses `unknown` values so that both `Record<string, unknown>`
 * (adapter config blocks) and `string[]` (the `enabled` field) are valid values.
 */
export interface AdapterConfig {
  enabled: string[];
  [adapterName: string]: unknown;
}

// ---------------------------------------------------------------------------
// Built-in adapter: DingTalk
// ---------------------------------------------------------------------------

/** DingTalk webhook adapter with HMAC-SHA256 signing. */
export class DingTalkAdapter implements CollabAdapter {
  readonly name = 'dingtalk';
  private webhook = '';
  private secret = '';

  validateConfig(config: Record<string, unknown>): boolean {
    if (typeof config.webhook !== 'string' || !config.webhook) return false;
    if (typeof config.secret !== 'string' || !config.secret) return false;
    this.webhook = config.webhook;
    this.secret = config.secret;
    return true;
  }

  async sendNotification(event: CollabEvent): Promise<void> {
    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${this.secret}`;
    const hmac = createHmac('sha256', this.secret);
    hmac.update(stringToSign);
    const sign = encodeURIComponent(hmac.digest('base64'));

    const url = new URL(this.webhook);
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', sign);

    const body = JSON.stringify({
      msgtype: 'text',
      text: {
        content: formatEventSummary(event),
      },
    });

    await postJSON(url.href, body);
  }
}

// ---------------------------------------------------------------------------
// Built-in adapter: Linear
// ---------------------------------------------------------------------------

/** Linear GraphQL API adapter. */
export class LinearAdapter implements CollabAdapter {
  readonly name = 'linear';
  private apiKey = '';
  private teamId = '';

  validateConfig(config: Record<string, unknown>): boolean {
    if (typeof config.apiKey !== 'string' || !config.apiKey) return false;
    if (typeof config.teamId !== 'string' || !config.teamId) return false;
    this.apiKey = config.apiKey;
    this.teamId = config.teamId;
    return true;
  }

  async sendNotification(event: CollabEvent): Promise<void> {
    const { query, variables } = buildLinearMutation(event, this.teamId);
    const body = JSON.stringify({ query, variables });

    await postJSON('https://api.linear.app/graphql', body, {
      Authorization: this.apiKey,
    });
  }
}

// ---------------------------------------------------------------------------
// Built-in adapter: GitHub Issues
// ---------------------------------------------------------------------------

/** GitHub Issues adapter using REST API v3. */
export class GitHubAdapter implements CollabAdapter {
  readonly name = 'github';
  private owner = '';
  private repo = '';
  private token = '';

  validateConfig(config: Record<string, unknown>): boolean {
    if (typeof config.owner !== 'string' || !config.owner) return false;
    if (typeof config.repo !== 'string' || !config.repo) return false;
    if (typeof config.token !== 'string' || !config.token) return false;
    this.owner = config.owner;
    this.repo = config.repo;
    this.token = config.token;
    return true;
  }

  async sendNotification(event: CollabEvent): Promise<void> {
    const p = event.payload;
    const baseUrl = `https://api.github.com/repos/${this.owner}/${this.repo}`;

    switch (event.type) {
      case 'task.created': {
        const title = typeof p.task_title === 'string' ? p.task_title : 'Untitled';
        const description = typeof p.description === 'string' ? p.description : '';
        const labels = Array.isArray(p.tags) ? p.tags as string[] : [];
        const body = JSON.stringify({
          title: `[Maestro] ${title}`,
          body: description || `Created by ${p.actor ?? 'unknown'} via Maestro collab`,
          labels,
        });
        await postJSON(`${baseUrl}/issues`, body, {
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        });
        break;
      }

      case 'task.status_changed': {
        const issueNumber = p.github_issue_number;
        if (typeof issueNumber !== 'number') break;
        const state = p.status === 'done' || p.status === 'closed' ? 'closed' : 'open';
        const body = JSON.stringify({ state });
        await postJSON(`${baseUrl}/issues/${issueNumber}`, body, {
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        });
        break;
      }

      case 'task.assigned': {
        const issueNumber = p.github_issue_number;
        if (typeof issueNumber !== 'number') break;
        const assignee = typeof p.github_username === 'string' ? p.github_username : '';
        if (!assignee) break;
        const body = JSON.stringify({ assignees: [assignee] });
        await postJSON(`${baseUrl}/issues/${issueNumber}/assignees`, body, {
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        });
        break;
      }

      default: {
        // For other events, add a comment if we have an issue number.
        const issueNum = p.github_issue_number;
        if (typeof issueNum !== 'number') break;
        const body = JSON.stringify({ body: formatEventSummary(event) });
        await postJSON(`${baseUrl}/issues/${issueNum}/comments`, body, {
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Built-in adapter: Slack
// ---------------------------------------------------------------------------

/** Slack Incoming Webhook adapter with Block Kit formatting. */
export class SlackAdapter implements CollabAdapter {
  readonly name = 'slack';
  private webhookUrl = '';
  private channel = '';

  validateConfig(config: Record<string, unknown>): boolean {
    if (typeof config.webhookUrl !== 'string' || !config.webhookUrl) return false;
    this.webhookUrl = config.webhookUrl;
    this.channel = typeof config.channel === 'string' ? config.channel : '';
    return true;
  }

  async sendNotification(event: CollabEvent): Promise<void> {
    const summary = formatEventSummary(event);
    const emoji = getSlackEmoji(event.type);

    const payload: Record<string, unknown> = {
      text: summary,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${eventTypeLabel(event.type)}*\n${summary}`,
          },
        },
      ],
    };

    if (this.channel) {
      payload.channel = this.channel;
    }

    await postJSON(this.webhookUrl, JSON.stringify(payload));
  }
}

function getSlackEmoji(type: CollabEventType): string {
  switch (type) {
    case 'task.created': return ':clipboard:';
    case 'task.assigned': return ':bust_in_silhouette:';
    case 'task.status_changed': return ':arrows_counterclockwise:';
    case 'task.checked': return ':white_check_mark:';
    case 'role.changed': return ':key:';
    default: return ':bell:';
  }
}

function eventTypeLabel(type: CollabEventType): string {
  switch (type) {
    case 'task.created': return 'Task Created';
    case 'task.assigned': return 'Task Assigned';
    case 'task.status_changed': return 'Status Changed';
    case 'task.checked': return 'Task Checked';
    case 'role.changed': return 'Role Changed';
    default: return 'Event';
  }
}

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const BUILTIN_ADAPTERS: Record<string, new () => CollabAdapter> = {
  dingtalk: DingTalkAdapter,
  linear: LinearAdapter,
  github: GitHubAdapter,
  slack: SlackAdapter,
};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Absolute path to the adapter configuration file. */
export function getAdaptersConfigPath(): string {
  return join(getProjectRoot(), '.workflow', 'collab', 'adapters.json');
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Read and parse the adapter config file.
 *
 * Returns `{ enabled: [] }` if the file is missing, empty, or fails to parse.
 * Never throws -- graceful fallback on any I/O or JSON error.
 */
export function loadAdapterConfig(): AdapterConfig {
  const configPath = getAdaptersConfigPath();
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { enabled: [] };
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.enabled)) return { enabled: [] };
    return parsed as AdapterConfig;
  } catch {
    return { enabled: [] };
  }
}

// ---------------------------------------------------------------------------
// Adapter instantiation
// ---------------------------------------------------------------------------

/**
 * Instantiate adapter classes based on the `enabled` array in config.
 *
 * For each name in `config.enabled`:
 *   1. Look up the constructor in the built-in registry.
 *   2. Instantiate and call `validateConfig` with the matching config block.
 *   3. Keep only valid adapters; skip unknown or invalid ones.
 *
 * Returns an empty array when no adapters are configured or valid.
 */
export function getEnabledAdapters(config: AdapterConfig): CollabAdapter[] {
  const adapters: CollabAdapter[] = [];
  for (const name of config.enabled) {
    const Ctor = BUILTIN_ADAPTERS[name];
    if (!Ctor) {
      console.error(`[collab-adapter] unknown adapter: ${name}`);
      continue;
    }
    try {
      const instance = new Ctor();
      const block = config[name] as Record<string, unknown> | undefined;
      if (!instance.validateConfig(block ?? {})) {
        console.error(`[collab-adapter] invalid config for adapter: ${name}`);
        continue;
      }
      adapters.push(instance);
    } catch (err) {
      console.error(`[collab-adapter] failed to instantiate adapter: ${name}`, err);
    }
  }
  return adapters;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Send a collab event to all enabled adapters.
 *
 * Fire-and-forget: this function is synchronous (returns void), dispatches
 * notifications in parallel via `Promise.allSettled`, and NEVER throws.
 * Individual adapter failures are logged to `console.error`.
 *
 * No-op when no adapters are configured.
 */
export function notifyAdapters(event: CollabEvent): void {
  try {
    const config = loadAdapterConfig();
    const adapters = getEnabledAdapters(config);
    if (adapters.length === 0) return;

    const promises = adapters.map((adapter) => adapter.sendNotification(event));
    Promise.allSettled(promises).then((results) => {
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          console.error(
            `[collab-adapter] ${adapters[i].name} notification failed:`,
            result.reason,
          );
        }
      }
    });
  } catch (err) {
    console.error('[collab-adapter] unexpected error in notifyAdapters:', err);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Format a human-readable one-liner from a collab event. */
function formatEventSummary(event: CollabEvent): string {
  const p = event.payload;
  const who = typeof p.actor === 'string' ? p.actor : 'unknown';
  const task = typeof p.task_title === 'string' ? p.task_title : '';
  switch (event.type) {
    case 'task.created':
      return `${who} created task: ${task}`;
    case 'task.assigned':
      return `${who} assigned task: ${task} -> ${p.assignee ?? 'unknown'}`;
    case 'task.status_changed':
      return `${who} changed status: ${task} -> ${p.status ?? 'unknown'}`;
    case 'task.checked':
      return `${who} checked item in: ${task}`;
    case 'role.changed':
      return `${who} changed role: ${p.member ?? 'unknown'} -> ${p.role ?? 'unknown'}`;
    default:
      return `${who}: ${event.type}`;
  }
}

/** Build a Linear GraphQL mutation for the given event type. */
function buildLinearMutation(
  event: CollabEvent,
  teamId: string,
): { query: string; variables: Record<string, unknown> } {
  const p = event.payload;
  const title = typeof p.task_title === 'string' ? p.task_title : 'Untitled';
  const description = typeof p.description === 'string' ? p.description : '';

  switch (event.type) {
    case 'task.created':
      return {
        query: `
          mutation CreateIssue($title: String!, $teamId: String!, $description: String) {
            issueCreate(input: { title: $title, teamId: $teamId, description: $description }) {
              success
              issue { id title }
            }
          }
        `,
        variables: { title, teamId, description },
      };

    case 'task.status_changed': {
      const linearState = mapToLinearState(p.status as string);
      return {
        query: `
          mutation UpdateIssueState($issueId: String!, $stateId: String!) {
            issueUpdate(id: $issueId, input: { stateId: $stateId }) {
              success
            }
          }
        `,
        variables: { issueId: p.task_id ?? '', stateId: linearState },
      };
    }

    case 'task.assigned': {
      return {
        query: `
          mutation AssignIssue($issueId: String!, $assigneeId: String!) {
            issueUpdate(id: $issueId, input: { assigneeId: $assigneeId }) {
              success
            }
          }
        `,
        variables: { issueId: p.task_id ?? '', assigneeId: p.assignee_id ?? '' },
      };
    }

    default:
      // For events without a direct Linear mapping, create a comment.
      return {
        query: `
          mutation CreateComment($issueId: String!, $body: String!) {
            commentCreate(input: { issueId: $issueId, body: $body }) {
              success
            }
          }
        `,
        variables: {
          issueId: p.task_id ?? '',
          body: formatEventSummary(event),
        },
      };
  }
}

/** Map collab status strings to Linear state IDs (placeholder heuristic). */
function mapToLinearState(status: string): string {
  const map: Record<string, string> = {
    todo: 'Todo',
    in_progress: 'In Progress',
    done: 'Done',
    cancelled: 'Cancelled',
    backlog: 'Backlog',
  };
  return map[status] ?? status;
}

/**
 * POST a JSON body to an HTTPS URL.
 *
 * Returns a promise that resolves on 2xx status and rejects otherwise.
 * Uses only Node.js built-in `node:https` -- no external dependencies.
 */
function postJSON(
  url: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
    };

    const req = request(options, (res) => {
      // Drain the response to free the connection.
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          const responseBody = Buffer.concat(chunks).toString('utf-8');
          reject(
            new Error(
              `HTTP ${res.statusCode} from ${parsed.hostname}: ${responseBody.slice(0, 200)}`,
            ),
          );
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
