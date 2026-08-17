/**
 * Client-side YAML lint for the editor.
 *
 * Uses the `yaml` package to parse the document and report syntax errors as
 * CodeMirror diagnostics. Also includes heuristic warnings for common K8s mistakes.
 */

import { parseDocument } from 'yaml';
import type { Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';

/**
 * Lint a YAML document, returning diagnostics for syntax errors and heuristic warnings.
 * Only runs for editable views — read-only views don't need lint.
 */
export function yamlLinter(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  if (!text.trim()) return [];

  const diagnostics: Diagnostic[] = [];

  // Parse — YAML's parseDocument is lenient and returns partial results even on error.
  const doc = parseDocument(text, { strict: false });

  // Syntax errors from the parser.
  for (const err of doc.errors) {
    const from = err.pos[0];
    const to = err.pos[1];
    diagnostics.push({
      from: Math.min(from, view.state.doc.length),
      to: Math.min(to, view.state.doc.length),
      severity: 'error',
      message: err.message,
    });
  }

  // Warnings from the parser (e.g. duplicate keys).
  for (const warn of doc.warnings) {
    const from = warn.pos[0];
    const to = warn.pos[1];
    diagnostics.push({
      from: Math.min(from, view.state.doc.length),
      to: Math.min(to, view.state.doc.length),
      severity: 'warning',
      message: warn.message,
    });
  }

  // Heuristic warnings for K8s manifests (only if no syntax errors).
  if (diagnostics.length === 0 && doc.contents) {
    const root = doc.contents;
    // Check if root is a YAML map by testing for the `items` property.
    if (root && 'items' in root) {
      const map = root as unknown as { items: { key: { value: string } }[] };
      const keys = new Set(map.items.map((i) => i.key?.value));

      if (!keys.has('apiVersion')) {
        diagnostics.push({
          from: 0,
          to: Math.min(text.length, 20),
          severity: 'warning',
          message: 'Missing "apiVersion" — expected in a K8s manifest.',
        });
      }
      if (!keys.has('kind')) {
        diagnostics.push({
          from: 0,
          to: Math.min(text.length, 20),
          severity: 'warning',
          message: 'Missing "kind" — expected in a K8s manifest.',
        });
      }
      if (!keys.has('metadata')) {
        diagnostics.push({
          from: 0,
          to: Math.min(text.length, 20),
          severity: 'warning',
          message: 'Missing "metadata" — expected in a K8s manifest.',
        });
      }
    }
  }

  return diagnostics;
}
