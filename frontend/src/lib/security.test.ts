import { describe, it, expect } from 'vitest';
import {
  sanitizePath,
  isSafePathSegment,
  safePathJoin,
  isValidK8sName,
  isValidNamespace,
  toK8sName,
  isValidImageRef,
  sanitizeImageRef,
  isValidHelmReleaseName,
  escapeHtml,
  isSafeLogLine,
  sanitizeLogLine,
  isSafeHelmValues,
} from './security';

// ---------------------------------------------------------------------------
// Path sanitization
// ---------------------------------------------------------------------------

describe('sanitizePath', () => {
  it('normalizes simple paths', () => {
    expect(sanitizePath('/usr/local/bin')).toBe('/usr/local/bin');
  });

  it('collapses multiple slashes', () => {
    expect(sanitizePath('//usr///local//bin')).toBe('/usr/local/bin');
  });

  it('resolves single dot segments', () => {
    expect(sanitizePath('/usr/./local/bin')).toBe('/usr/local/bin');
  });

  it('resolves double-dot segments', () => {
    expect(sanitizePath('/usr/local/../bin')).toBe('/usr/bin');
  });

  it('rejects path traversal above root', () => {
    expect(sanitizePath('/../../../etc/passwd')).toBeNull();
  });

  it('rejects null bytes', () => {
    expect(sanitizePath('/usr/local\0/bin')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(sanitizePath('')).toBeNull();
  });

  it('handles root path', () => {
    expect(sanitizePath('/')).toBe('/');
  });

  it('handles relative path segments', () => {
    expect(sanitizePath('usr/local')).toBe('/usr/local');
  });

  it('respects allowedRoot constraint', () => {
    expect(sanitizePath('/usr/local/bin', '/usr/local')).toBe('/usr/local/bin');
    expect(sanitizePath('/etc/passwd', '/usr/local')).toBeNull();
  });

  it('allows exact root match', () => {
    expect(sanitizePath('/usr/local', '/usr/local')).toBe('/usr/local');
  });
});

describe('isSafePathSegment', () => {
  it('accepts normal filenames', () => {
    expect(isSafePathSegment('config.yaml')).toBe(true);
    expect(isSafePathSegment('my-file.txt')).toBe(true);
    expect(isSafePathSegment('file_1')).toBe(true);
  });

  it('rejects directory traversal', () => {
    expect(isSafePathSegment('..')).toBe(false);
    expect(isSafePathSegment('.')).toBe(false);
  });

  it('rejects path separators', () => {
    expect(isSafePathSegment('foo/bar')).toBe(false);
    expect(isSafePathSegment('foo\\bar')).toBe(false);
  });

  it('rejects null bytes', () => {
    expect(isSafePathSegment('file\0.txt')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isSafePathSegment('')).toBe(false);
  });
});

describe('safePathJoin', () => {
  it('joins segments safely', () => {
    expect(safePathJoin('/usr', 'local', 'bin')).toBe('/usr/local/bin');
  });

  it('handles trailing slashes', () => {
    expect(safePathJoin('/usr/', '/local/', 'bin')).toBe('/usr/local/bin');
  });

  it('resolves dots', () => {
    expect(safePathJoin('/usr', '.', 'local')).toBe('/usr/local');
  });

  it('rejects traversal', () => {
    expect(safePathJoin('/usr', '..', '..', 'etc')).toBeNull();
  });

  it('rejects unsafe segments', () => {
    expect(safePathJoin('/usr', 'foo\0bar')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Kubernetes name validation
// ---------------------------------------------------------------------------

describe('isValidK8sName', () => {
  it('accepts valid names', () => {
    expect(isValidK8sName('my-deployment')).toBe(true);
    expect(isValidK8sName('nginx')).toBe(true);
    expect(isValidK8sName('app-v1.2.3')).toBe(true);
    expect(isValidK8sName('a')).toBe(true);
  });

  it('rejects names starting with hyphen', () => {
    expect(isValidK8sName('-bad')).toBe(false);
  });

  it('rejects names ending with hyphen', () => {
    expect(isValidK8sName('bad-')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidK8sName('My-App')).toBe(false);
  });

  it('rejects names with spaces', () => {
    expect(isValidK8sName('my app')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidK8sName('')).toBe(false);
  });

  it('rejects names over 253 chars', () => {
    expect(isValidK8sName('a'.repeat(254))).toBe(false);
  });

  it('accepts names at max length', () => {
    expect(isValidK8sName('a'.repeat(253))).toBe(true);
  });
});

describe('isValidNamespace', () => {
  it('delegates to isValidK8sName', () => {
    expect(isValidNamespace('default')).toBe(true);
    expect(isValidNamespace('kube-system')).toBe(true);
    expect(isValidNamespace('BAD')).toBe(false);
  });
});

describe('toK8sName', () => {
  it('converts to valid k8s name', () => {
    expect(toK8sName('My App')).toBe('my-app');
  });

  it('collapses multiple hyphens', () => {
    expect(toK8sName('a---b')).toBe('a-b');
  });

  it('strips leading/trailing hyphens', () => {
    expect(toK8sName('-abc-')).toBe('abc');
  });

  it('handles special characters', () => {
    expect(toK8sName('hello world!')).toBe('hello-world');
  });

  it('truncates to 253 chars', () => {
    const long = 'a'.repeat(300);
    expect(toK8sName(long).length).toBe(253);
  });
});

// ---------------------------------------------------------------------------
// Container image validation
// ---------------------------------------------------------------------------

describe('isValidImageRef', () => {
  it('accepts simple image names', () => {
    expect(isValidImageRef('nginx')).toBe(true);
    expect(isValidImageRef('nginx:latest')).toBe(true);
    expect(isValidImageRef('nginx:1.21')).toBe(true);
  });

  it('accepts images with registry', () => {
    expect(isValidImageRef('docker.io/library/nginx:latest')).toBe(true);
    expect(isValidImageRef('gcr.io/project/image:v1')).toBe(true);
  });

  it('accepts images with digest', () => {
    expect(isValidImageRef('nginx@sha256:abc123')).toBe(true);
  });

  it('rejects empty input', () => {
    expect(isValidImageRef('')).toBe(false);
    expect(isValidImageRef('  ')).toBe(false);
  });

  it('rejects whitespace', () => {
    expect(isValidImageRef('nginx latest')).toBe(false);
    expect(isValidImageRef('nginx\tlatest')).toBe(false);
  });

  it('rejects shell metacharacters', () => {
    expect(isValidImageRef('nginx;rm -rf /')).toBe(false);
    expect(isValidImageRef('nginx|cat /etc/passwd')).toBe(false);
    expect(isValidImageRef('nginx$(whoami)')).toBe(false);
    expect(isValidImageRef('nginx`id`')).toBe(false);
    expect(isValidImageRef('nginx{test}')).toBe(false);
    expect(isValidImageRef('nginx[0]')).toBe(false);
  });

  it('rejects images over 1024 chars', () => {
    expect(isValidImageRef('a'.repeat(1025))).toBe(false);
  });

  it('rejects leading/trailing separators', () => {
    expect(isValidImageRef('/nginx')).toBe(false);
    expect(isValidImageRef('nginx/')).toBe(false);
    expect(isValidImageRef(':nginx')).toBe(false);
  });
});

describe('sanitizeImageRef', () => {
  it('returns trimmed valid image', () => {
    expect(sanitizeImageRef('  nginx:latest  ')).toBe('nginx:latest');
  });

  it('returns null for invalid images', () => {
    expect(sanitizeImageRef('nginx;rm -rf /')).toBeNull();
    expect(sanitizeImageRef('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helm release name validation
// ---------------------------------------------------------------------------

describe('isValidHelmReleaseName', () => {
  it('accepts valid release names', () => {
    expect(isValidHelmReleaseName('my-release')).toBe(true);
    expect(isValidHelmReleaseName('nginx')).toBe(true);
    expect(isValidHelmReleaseName('app-v1')).toBe(true);
  });

  it('rejects names with dots', () => {
    expect(isValidHelmReleaseName('my.release')).toBe(false);
  });

  it('rejects names over 63 chars', () => {
    expect(isValidHelmReleaseName('a'.repeat(64))).toBe(false);
  });

  it('rejects names starting with hyphen', () => {
    expect(isValidHelmReleaseName('-bad')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidHelmReleaseName('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    expect(escapeHtml("'hello'")).toBe('&#39;hello&#39;');
  });

  it('returns safe strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// Log line sanitization
// ---------------------------------------------------------------------------

describe('isSafeLogLine', () => {
  it('accepts normal log lines', () => {
    expect(isSafeLogLine('2024-01-01 INFO: Server started')).toBe(true);
  });

  it('rejects ANSI escape sequences', () => {
    expect(isSafeLogLine('\x1b[31mERROR\x1b[0m')).toBe(false);
  });

  it('rejects control characters', () => {
    expect(isSafeLogLine('line\x00with\x01control')).toBe(false);
  });

  it('allows newline and tab', () => {
    expect(isSafeLogLine('line\nwith\twhitespace')).toBe(true);
  });
});

describe('sanitizeLogLine', () => {
  it('strips ANSI escapes', () => {
    expect(sanitizeLogLine('\x1b[31mERROR\x1b[0m')).toBe('ERROR');
  });

  it('strips control characters', () => {
    expect(sanitizeLogLine('line\x00with\x01control')).toBe('linewithcontrol');
  });

  it('preserves normal text', () => {
    expect(sanitizeLogLine('normal log line')).toBe('normal log line');
  });

  it('handles empty input', () => {
    expect(sanitizeLogLine('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Helm values safety
// ---------------------------------------------------------------------------

describe('isSafeHelmValues', () => {
  it('accepts empty values', () => {
    expect(isSafeHelmValues('')).toBe(true);
  });

  it('accepts normal YAML', () => {
    expect(isSafeHelmValues('replicaCount: 3\nimage:\n  tag: latest')).toBe(true);
  });

  it('rejects Go template injection', () => {
    expect(isSafeHelmValues('{{ .Values.secret }}')).toBe(false);
  });

  it('rejects backtick commands', () => {
    expect(isSafeHelmValues('value: `rm -rf /`')).toBe(false);
  });
});
