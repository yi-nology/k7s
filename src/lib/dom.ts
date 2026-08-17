/**
 * True when the focused element is a text-entry target.
 *
 * Checks for `<input>`, `<textarea>`, or a `contenteditable` region (such as
 * CodeMirror). Keyboard shortcuts skip these so typing is never hijacked.
 *
 * @param el - The event target (typically `document.activeElement`).
 * @returns `true` if the element is a text-entry field.
 *
 * @example
 * ```ts
 * if (isTypingTarget(document.activeElement)) return; // don't hijack typing
 * ```
 */
export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable;
}
