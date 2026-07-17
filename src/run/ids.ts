/** Validate user-facing Session IDs before they can become filesystem paths. */
export function validateSessionId(value: string): void {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)) {
    throw new Error(`Invalid session ID: "${value}". Use lowercase alphanumeric + hyphens (e.g. 20260715-odyssey-jwt-auth).`);
  }
  if (value.length > 128) {
    throw new Error(`Session ID too long (${value.length} > 128): "${value.slice(0, 40)}..."`);
  }
}

/** Reject path separators and dot segments at the storage boundary. */
export function assertSafePathSegment(value: string, label: string): void {
  if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value)) {
    throw new Error(`Invalid ${label}: "${value}"`);
  }
}
