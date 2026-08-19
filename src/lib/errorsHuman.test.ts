/**
 * Tests for errorsHuman — the known-error-pattern table that maps raw provider
 * error strings to an i18n key + English fallback (P3 Task 4).
 *
 * The realistic strings below are copied from what the providers actually
 * surface (kubeclient ServiceError chains, K8s RBAC API errors, auth rejections
 * and client timeouts), so each pattern is exercised against the shape it
 * exists to catch, not just the literal alternation. Unknown strings must stay
 * null — the caller falls back to the original toast title.
 */

import { describe, expect, it } from 'vitest';
import { humanizeError } from './errorsHuman';

describe('humanizeError', () => {
  it('maps connect failures (kubeclient ServiceError) to errors.connect', () => {
    // The exact casing kubeclient produces ("Connect"), matched case-insensitively.
    expect(humanizeError('kubernetes error: ServiceError: client error (Connect)')).toEqual({
      key: 'errors.connect',
      fallback: 'Cannot reach the cluster API',
    });
    expect(humanizeError('dial tcp 10.0.0.1:6443: connect: connection refused')).toEqual({
      key: 'errors.connect',
      fallback: 'Cannot reach the cluster API',
    });
    expect(humanizeError('client error (Connect)')).toEqual({
      key: 'errors.connect',
      fallback: 'Cannot reach the cluster API',
    });
  });

  it('maps RBAC denials to errors.rbac', () => {
    expect(humanizeError('forbidden: User cannot get resource')).toEqual({
      key: 'errors.rbac',
      fallback: 'Permission denied (RBAC)',
    });
    // Bare status code form.
    expect(humanizeError('API returned 403')).toEqual({
      key: 'errors.rbac',
      fallback: 'Permission denied (RBAC)',
    });
  });

  it('maps auth failures to errors.auth', () => {
    expect(humanizeError('unauthorized: missing or invalid token')).toEqual({
      key: 'errors.auth',
      fallback: 'Authentication failed',
    });
    expect(humanizeError('invalid token')).toEqual({
      key: 'errors.auth',
      fallback: 'Authentication failed',
    });
    expect(humanizeError('Unauthorized: 401')).toEqual({
      key: 'errors.auth',
      fallback: 'Authentication failed',
    });
  });

  it('maps timeouts to errors.timeout', () => {
    expect(humanizeError('operation timed out')).toEqual({
      key: 'errors.timeout',
      fallback: 'Request timed out',
    });
    expect(humanizeError('client error (SendRequest): timeout')).toEqual({
      key: 'errors.timeout',
      fallback: 'Request timed out',
    });
  });

  it('returns null for unknown error strings', () => {
    expect(humanizeError('namespaces "x" not found')).toBeNull();
    expect(humanizeError('something completely different')).toBeNull();
    expect(humanizeError('')).toBeNull();
  });

  it('is case-insensitive across every pattern', () => {
    expect(humanizeError('CONNECTION REFUSED')).toEqual({
      key: 'errors.connect',
      fallback: 'Cannot reach the cluster API',
    });
    expect(humanizeError('Forbidden')).toEqual({
      key: 'errors.rbac',
      fallback: 'Permission denied (RBAC)',
    });
    expect(humanizeError('UNAUTHORIZED')).toEqual({
      key: 'errors.auth',
      fallback: 'Authentication failed',
    });
    expect(humanizeError('Request Timeout')).toEqual({
      key: 'errors.timeout',
      fallback: 'Request timed out',
    });
  });
});
