/**
 * Security utilities for input validation, path sanitization, and XSS prevention.
 *
 * This module provides defense-in-depth for user-facing inputs:
 * - Path traversal prevention for file operations
 * - Kubernetes resource name validation
 * - Image reference validation
 * - General input sanitization
 */

// ---------------------------------------------------------------------------
// Path sanitization (prevents path traversal)
// ---------------------------------------------------------------------------

/**
 * Sanitize a file path to prevent directory traversal attacks.
 *
 * Rules:
 * - Resolves `.` and `..` segments
 * - Collapses multiple slashes
 * - Ensures the path stays within the intended root
 * - Strips null bytes
 *
 * Returns the sanitized path, or null if the path is invalid/unsafe.
 */
export function sanitizePath(path: string, allowedRoot: string = '/'): string | null {
  if (!path || typeof path !== 'string') return null;

  // Null bytes are always suspicious
  if (path.includes('\0')) return null;

  // Normalize: collapse multiple slashes, remove trailing slash (except root)
  let normalized = path.replace(/\/+/g, '/');
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, '');
  }

  // Resolve the path segments
  const segments: string[] = [];
  for (const seg of normalized.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      // Going above root is not allowed
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(seg);
    }
  }

  const resolved = '/' + segments.join('/');

  // Check against allowed root if specified
  if (allowedRoot && allowedRoot !== '/') {
    const normalizedRoot = allowedRoot.replace(/\/+$/, '');
    if (!resolved.startsWith(normalizedRoot + '/') && resolved !== normalizedRoot) {
      return null;
    }
  }

  return resolved;
}

/**
 * Check if a path component (filename or directory name) is safe.
 * Rejects names with path separators, null bytes, or special traversal sequences.
 */
export function isSafePathSegment(segment: string): boolean {
  if (!segment || typeof segment !== 'string') return false;
  if (segment.includes('\0')) return false;
  if (segment.includes('/') || segment.includes('\\')) return false;
  if (segment === '.' || segment === '..') return false;
  // Reject hidden files starting with dot (optional, stricter security)
  // if (segment.startsWith('.')) return false;
  return true;
}

/**
 * Join path segments safely, preventing traversal.
 * Each segment is validated before joining.
 */
export function safePathJoin(...segments: string[]): string | null {
  const parts: string[] = [];

  for (const seg of segments) {
    if (!seg || typeof seg !== 'string') continue;

    // Split on slashes and validate each part
    for (const part of seg.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (parts.length === 0) return null;
        parts.pop();
      } else if (!isSafePathSegment(part)) {
        return null;
      } else {
        parts.push(part);
      }
    }
  }

  return '/' + parts.join('/');
}

// ---------------------------------------------------------------------------
// Kubernetes resource name validation
// ---------------------------------------------------------------------------

/** Regex for valid Kubernetes resource names (RFC 1123 subdomain). */
const K8S_NAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** Max length for a Kubernetes name (from the spec). */
const K8S_NAME_MAX_LEN = 253;

/**
 * Validate a Kubernetes resource name (DNS subdomain format).
 * Returns true if the name is valid per RFC 1123.
 */
export function isValidK8sName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.length > K8S_NAME_MAX_LEN) return false;
  return K8S_NAME_RE.test(name);
}

/**
 * Validate a Kubernetes namespace name.
 * Same rules as resource names, but typically shorter.
 */
export function isValidNamespace(name: string): boolean {
  return isValidK8sName(name);
}

/**
 * Sanitize a string to be a valid Kubernetes name.
 * Converts invalid characters to hyphens, lowercases, and trims.
 */
export function toK8sName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, K8S_NAME_MAX_LEN);
}

// ---------------------------------------------------------------------------
// Container image validation
// ---------------------------------------------------------------------------

/**
 * Validate a container image reference format.
 *
 * Checks:
 * - Non-empty
 * - No whitespace
 * - No shell metacharacters
 * - Reasonable length
 * - Basic format: [registry/]repository[:tag|@digest]
 *
 * This is intentionally lenient — the server-side admission webhook is the
 * authoritative validator. This catches obvious mistakes and injection attempts.
 */
export function isValidImageRef(image: string): boolean {
  if (!image || typeof image !== 'string') return false;

  const trimmed = image.trim();
  if (trimmed.length === 0 || trimmed.length > 1024) return false;

  // No whitespace
  if (/\s/.test(trimmed)) return false;

  // No shell metacharacters (prevent command injection in helm/kubectl)
  if (/[;&|`$(){}[\]!<>]/.test(trimmed)) return false;

  // Basic format check: must contain at least one alphanumeric or common chars
  if (!/^[a-zA-Z0-9._:/@-]+$/.test(trimmed)) return false;

  // Must not start or end with common separators
  if (/^[/:@.-]|[/:@.-]$/.test(trimmed)) return false;

  return true;
}

/**
 * Validate and sanitize an image reference.
 * Returns the trimmed image if valid, or null if invalid.
 */
export function sanitizeImageRef(image: string): string | null {
  if (!image) return null;
  const trimmed = image.trim();
  return isValidImageRef(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// General input sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a Helm release name.
 * Helm release names must be valid DNS names (RFC 1123 label).
 */
export function isValidHelmReleaseName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  // Helm uses RFC 1123 labels (max 63 chars, no dots)
  if (name.length > 63) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name);
}

/**
 * Strip potentially dangerous characters from display text.
 * Use for rendering user-provided strings in HTML contexts where
 * React's automatic escaping might not be sufficient (e.g., dangerouslySetInnerHTML).
 *
 * NOTE: In React JSX, text content is auto-escaped. This is a belt-and-suspenders
 * measure for edge cases.
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

/**
 * Check if a string contains only safe characters for a log line.
 * Prevents log injection by rejecting ANSI escape sequences and control chars.
 */
export function isSafeLogLine(line: string): boolean {
  if (!line || typeof line !== 'string') return false;
  // Reject ANSI escape sequences
  if (/\x1b\[/.test(line)) return false;
  // Reject other control characters except newline and tab
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(line)) return false;
  return true;
}

/**
 * Sanitize a log line by removing dangerous sequences.
 */
export function sanitizeLogLine(line: string): string {
  if (!line) return '';
  return line
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // strip ANSI escapes
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''); // strip control chars
}

/**
 * Validate a YAML values string for Helm chart installation.
 * Basic safety check — rejects obviously dangerous patterns.
 */
export function isSafeHelmValues(yaml: string): boolean {
  if (!yaml || typeof yaml !== 'string') return true; // empty is ok

  // Check for command injection patterns in YAML values
  const dangerous = [
    /\{\{.*?\}\}/, // Go template injection (could be used in some Helm contexts)
    /`[^`]*`/, // backtick command substitution
  ];

  for (const pattern of dangerous) {
    if (pattern.test(yaml)) return false;
  }

  return true;
}
