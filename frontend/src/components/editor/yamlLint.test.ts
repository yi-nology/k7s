/**
 * Tests for yamlLinter — the client-side YAML lint used by EditorCore.
 *
 * Covers: empty input, a clean K8s manifest, K8s heuristic warnings for
 * missing required keys, parser syntax errors, and duplicate-key warnings.
 *
 * CodeMirror's EditorView is faked with just the surface the linter reads
 * (`state.doc.toString()` / `state.doc.length`).
 */

import { describe, expect, it } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { yamlLinter } from './yamlLint';

function fakeView(text: string): EditorView {
  return {
    state: { doc: { toString: () => text, length: text.length } },
  } as unknown as EditorView;
}

describe('yamlLinter', () => {
  it('returns no diagnostics for empty or whitespace-only documents', () => {
    expect(yamlLinter(fakeView(''))).toEqual([]);
    expect(yamlLinter(fakeView('   \n  \n'))).toEqual([]);
  });

  it('returns no diagnostics for a complete K8s manifest', () => {
    const text = [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: web',
      'spec:',
      '  replicas: 2',
    ].join('\n');
    expect(yamlLinter(fakeView(text))).toEqual([]);
  });

  it('warns when apiVersion, kind, or metadata are missing', () => {
    const text = ['spec:', '  replicas: 2'].join('\n');
    const diagnostics = yamlLinter(fakeView(text));
    const messages = diagnostics.map((d) => d.message);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    expect(messages.some((m) => m.includes('apiVersion'))).toBe(true);
    expect(messages.some((m) => m.includes('kind'))).toBe(true);
    expect(messages.some((m) => m.includes('metadata'))).toBe(true);
    expect(diagnostics[0].from).toBe(0);
  });

  it('reports a syntax error for a broken document', () => {
    const text = 'key: [unclosed-sequence';
    const diagnostics = yamlLinter(fakeView(text));
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
    // Positions must stay inside the document.
    for (const d of diagnostics) {
      expect(d.from).toBeLessThanOrEqual(text.length);
      expect(d.to).toBeLessThanOrEqual(text.length);
      expect(d.message.length).toBeGreaterThan(0);
    }
  });

  it('reports duplicate keys as an error', () => {
    const text = [
      'apiVersion: v1',
      'kind: Pod',
      'metadata:',
      '  name: a',
      '  name: b',
    ].join('\n');
    const diagnostics = yamlLinter(fakeView(text));
    // The yaml parser classifies duplicate map keys as errors (not warnings),
    // even with strict: false.
    const dup = diagnostics.filter((d) => /duplicate|unique/i.test(d.message));
    expect(dup.length).toBeGreaterThanOrEqual(1);
    expect(dup.every((d) => d.severity === 'error')).toBe(true);
  });

  it('skips the K8s heuristics when syntax errors are present', () => {
    // Broken YAML that also lacks apiVersion/kind/metadata: the parser error
    // wins and no heuristic warnings pile on top.
    const text = 'key: [unclosed';
    const diagnostics = yamlLinter(fakeView(text));
    expect(diagnostics.some((d) => d.message.includes('apiVersion'))).toBe(false);
  });
});
