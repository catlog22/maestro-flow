/**
 * Human-team member registry (team-lite collaboration, Wave 2).
 *
 * Owns `.workflow/collab/members/{uid}.json` — per-file member records.
 *
 * Strict namespace separation: this module belongs to the HUMAN collaboration
 * domain (`.workflow/collab/`). It must NEVER touch `.workflow/.team/` which
 * is the agent pipeline message bus owned by `src/tools/team-msg.ts`.
 *
 * Per-file layout is deliberate: each member writes their own JSON file so
 * two concurrent `maestro team join` on different machines never collide on
 * git merge (vs. a single `members.json` which cannot `merge=union`).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { execSync } from 'node:child_process';

import { getProjectRoot } from '../utils/path-validator.js';

export type ProjectRole = string; // e.g., 'frontend', 'backend', 'devops', 'designer', 'reviewer'

export interface MemberRecord {
  uid: string;
  name: string;
  email: string;
  host: string;
  role: 'admin' | 'member';
  joinedAt: string; // ISO 8601
  projectRoles?: ProjectRole[];
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Absolute path to the human-collab members directory. */
export function getMembersDir(): string {
  return join(getProjectRoot(), '.workflow', 'collab', 'members');
}

function getMemberFilePath(uid: string): string {
  return join(getMembersDir(), `${uid}.json`);
}

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

/**
 * Resolve local git identity via `git config user.name` / `user.email`.
 * Returns null if either is missing or git is unavailable.
 */
export function readGitIdentity(): { name: string; email: string } | null {
  // Hooks call this on every status refresh. Read repository-local identity
  // directly first so a contended git subprocess cannot consume the hook's
  // entire latency budget. Fall back to Git for global/includes/worktree cases.
  const local = readLocalGitIdentity();
  if (local) return local;
  const name = tryGitConfig('user.name');
  const email = tryGitConfig('user.email');
  if (!name || !email) return null;
  return { name, email };
}

function readLocalGitIdentity(): { name: string; email: string } | null {
  try {
    const root = getProjectRoot();
    const dotGit = join(root, '.git');
    let configPath = join(dotGit, 'config');
    if (existsSync(dotGit)) {
      try {
        const pointer = readFileSync(dotGit, 'utf8').trim();
        const match = /^gitdir:\s*(.+)$/i.exec(pointer);
        if (match) {
          const gitDir = isAbsolute(match[1]) ? match[1] : resolve(dirname(dotGit), match[1]);
          configPath = join(gitDir, 'config');
        }
      } catch {
        // A directory cannot be read as a file; use .git/config.
      }
    }
    if (!existsSync(configPath)) return null;
    const config = readFileSync(configPath, 'utf8');
    const userSection = /(?:^|\r?\n)\s*\[user\]\s*\r?\n([\s\S]*?)(?=\r?\n\s*\[|$)/i.exec(config)?.[1];
    if (!userSection) return null;
    const clean = (value: string | undefined): string | null => {
      const normalized = value?.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2') ?? '';
      return normalized || null;
    };
    const name = clean(/^\s*name\s*=\s*(.+)$/mi.exec(userSection)?.[1]);
    const email = clean(/^\s*email\s*=\s*(.+)$/mi.exec(userSection)?.[1]);
    return name && email ? { name, email } : null;
  } catch {
    return null;
  }
}

function tryGitConfig(key: string): string | null {
  try {
    const out = execSync(`git config ${key}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // Reached from interactive hooks (team-monitor, preflight-guard,
      // spec-injector), where an unbounded git spawn stalls the turn. A missing
      // identity already degrades to null, so a timeout is a safe outcome.
      timeout: 2000,
      windowsHide: true,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Derive a uid from an email address.
 *
 * Rule: take the local-part (before '@'), lowercase it.
 *   "Alice@Example.COM" -> "alice"
 *
 * Collision handling is NOT done here — callers must check `getMembersDir`
 * and append `-2`, `-3`, ... as needed (see `joinTeam`).
 */
export function deriveUid(email: string): string {
  const at = email.indexOf('@');
  const local = at >= 0 ? email.slice(0, at) : email;
  return local.trim().toLowerCase();
}

/** Return the machine hostname. Exported so tests can stub if needed. */
export function getHost(): string {
  return hostname();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * List all known members. Returns an empty array if the directory does not
 * exist yet. Files that fail to parse as `MemberRecord` JSON are skipped
 * silently — corrupt files should not break `whoami` / `status`.
 */
export function listMembers(): MemberRecord[] {
  const dir = getMembersDir();
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const out: MemberRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const rec = readMemberFile(join(dir, entry));
    if (rec) out.push(rec);
  }
  return out;
}

/** Read a single member by uid, or null if the file does not exist. */
export function getMemberByUid(uid: string): MemberRecord | null {
  const path = getMemberFilePath(uid);
  if (!existsSync(path)) return null;
  return readMemberFile(path);
}

/**
 * Return the member record matching the current git identity.
 *
 * Matching uses `email` (case-insensitive), NOT just `uid`, so two users who
 * happened to get the same local-part on different domains still resolve to
 * their own record.
 *
 * Returns null if git identity is unavailable or no record matches.
 */
export function resolveSelf(): MemberRecord | null {
  // Member lookup first: it is pure local fs (and short-circuits on a missing
  // directory), whereas the identity probe spawns two `git config` processes.
  // With no members joined there is nothing to match, so the old order paid
  // both spawns on every hook invocation only to return null from the loop.
  const members = listMembers();
  if (members.length === 0) return null;
  const ident = readGitIdentity();
  if (!ident) return null;
  const target = ident.email.toLowerCase();
  for (const m of members) {
    if (m.email.toLowerCase() === target) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Assert that team mode is active (i.e. the current git user has a member
 * record). Throws a descriptive error if `resolveSelf()` returns null.
 *
 * Returns the resolved `MemberRecord` for convenience so callers can chain:
 *   const self = requireTeamMode();
 */
export function requireTeamMode(): MemberRecord {
  const self = resolveSelf();
  if (!self) {
    throw new Error(
      "Team mode not enabled. Run 'maestro team join' first.",
    );
  }
  return self;
}

/**
 * Assert the current user holds the given role. Calls `resolveSelf()`
 * internally, so it also fails when team mode is off.
 *
 * Throws with a message like:
 *   "This operation requires admin role. Your role: member"
 */
export function requireRole(required: 'admin' | 'member'): MemberRecord {
  const self = requireTeamMode();
  if (self.role !== required) {
    throw new Error(
      `This operation requires ${required} role. Your role: ${self.role}`,
    );
  }
  return self;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Join the team. Idempotent.
 *
 * Flow:
 *   1. Read git identity (throws if name/email missing — cannot join without it).
 *   2. If a record with the same email already exists, return it unchanged
 *      (preserves `joinedAt` and any prior `role`).
 *   3. Derive uid from email local-part. If another member with a different
 *      email already owns that uid, append `-2`, `-3`, ... until free.
 *   4. Assign role: explicit `opts.role` wins; otherwise the very first member
 *      to join becomes `admin`, everyone after is `member`.
 *   5. Write `.workflow/collab/members/{uid}.json` atomically via `writeFileSync`.
 */
export function joinTeam(opts?: { role?: 'admin' | 'member' }): MemberRecord {
  const ident = readGitIdentity();
  if (!ident) {
    throw new Error(
      'Git identity not configured. Run `git config user.name "Your Name"` and ' +
        '`git config user.email "you@example.com"` before joining.',
    );
  }

  // Idempotency: same email already registered -> return existing record.
  const existing = resolveSelf();
  if (existing) return existing;

  const dir = getMembersDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const base = deriveUid(ident.email);
  const uid = allocateUid(base, ident.email);

  // Role: explicit wins. Otherwise first-joiner is admin.
  const role: 'admin' | 'member' =
    opts?.role ?? (listMembers().length === 0 ? 'admin' : 'member');

  const record: MemberRecord = {
    uid,
    name: ident.name,
    email: ident.email,
    host: getHost(),
    role,
    joinedAt: new Date().toISOString(),
  };

  writeFileSync(getMemberFilePath(uid), JSON.stringify(record, null, 2), 'utf-8');
  return record;
}

// ---------------------------------------------------------------------------
// Project roles
// ---------------------------------------------------------------------------

/**
 * Add a project role to a member's record. Idempotent — adding a role that
 * already exists is a no-op. Returns the updated record, or null if the
 * member was not found.
 */
export function addProjectRole(uid: string, role: string): MemberRecord | null {
  const member = getMemberByUid(uid);
  if (!member) return null;

  const roles = member.projectRoles ?? [];
  if (roles.includes(role)) return member; // already present

  member.projectRoles = [...roles, role];
  writeFileSync(getMemberFilePath(uid), JSON.stringify(member, null, 2), 'utf-8');
  return member;
}

/**
 * Remove a project role from a member's record. No-op if the role is not
 * present. Returns the updated record, or null if the member was not found.
 */
export function removeProjectRole(uid: string, role: string): MemberRecord | null {
  const member = getMemberByUid(uid);
  if (!member) return null;

  const roles = member.projectRoles ?? [];
  const filtered = roles.filter((r) => r !== role);
  if (filtered.length === roles.length) return member; // role was not present

  member.projectRoles = filtered.length > 0 ? filtered : undefined;
  writeFileSync(getMemberFilePath(uid), JSON.stringify(member, null, 2), 'utf-8');
  return member;
}

/**
 * List project roles. When `uid` is provided, returns that member's roles
 * (or an empty array). When omitted, returns a Map of all members' roles.
 */
export function listProjectRoles(uid?: string): ProjectRole[] | Map<string, ProjectRole[]> {
  if (uid !== undefined) {
    const member = getMemberByUid(uid);
    return member?.projectRoles ?? [];
  }

  const map = new Map<string, ProjectRole[]>();
  for (const m of listMembers()) {
    map.set(m.uid, m.projectRoles ?? []);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function readMemberFile(path: string): MemberRecord | null {
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MemberRecord>;
    if (
      typeof parsed.uid === 'string' &&
      typeof parsed.name === 'string' &&
      typeof parsed.email === 'string' &&
      typeof parsed.host === 'string' &&
      (parsed.role === 'admin' || parsed.role === 'member') &&
      typeof parsed.joinedAt === 'string'
    ) {
      return parsed as MemberRecord;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Allocate a free uid derived from `base`.
 *
 * - If `{base}.json` does not exist, use it.
 * - If `{base}.json` exists AND belongs to the same email, reuse it
 *   (this path is normally caught earlier by `resolveSelf`, but we keep
 *   the safety net in case files got out of sync).
 * - Otherwise try `{base}-2`, `{base}-3`, ... until a free slot is found.
 */
function allocateUid(base: string, email: string): string {
  const ownEmail = email.toLowerCase();
  const firstPath = getMemberFilePath(base);
  if (!existsSync(firstPath)) return base;

  const existing = readMemberFile(firstPath);
  if (existing && existing.email.toLowerCase() === ownEmail) return base;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    const candidatePath = getMemberFilePath(candidate);
    if (!existsSync(candidatePath)) return candidate;
    const rec = readMemberFile(candidatePath);
    if (rec && rec.email.toLowerCase() === ownEmail) return candidate;
  }
  throw new Error(`Could not allocate uid for email ${email} after 1000 attempts`);
}
