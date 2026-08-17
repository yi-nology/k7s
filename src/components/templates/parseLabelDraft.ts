/**
 * The chip-editor's `key=value` parser. Extracted from TemplatePicker.tsx so the
 * component file only exports a component (react-refresh) and the parser can be
 * tested without rendering the React tree.
 *
 * The contract is the same as `kubectl label`:
 *  - `key=value` → { key, value }
 *  - `key` (no =) → { key, value: "" }
 *  - `key=val=ue` → { key, value: "val=ue" }  (split on the FIRST =)
 *  - empty / whitespace-only / `=value` → null
 *
 * Splitting on the first `=` (not the last) matches `kubectl label` and the way
 * every shell tool handles KEY=VAL — a value containing `=` is left intact.
 */
export function parseLabelDraft(draft: string): { key: string; value: string } | null {
  const line = draft.trim();
  if (!line) return null;
  const eq = line.indexOf('=');
  let key: string;
  let value: string;
  if (eq === -1) {
    key = line;
    value = '';
  } else {
    key = line.slice(0, eq).trim();
    value = line.slice(eq + 1).trim();
  }
  if (!key) return null;
  return { key, value };
}
