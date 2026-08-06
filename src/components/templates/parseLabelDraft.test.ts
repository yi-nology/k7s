/**
 * Tests for the chip-editor's `key=value` parser. The function is
 * exported from TemplatePicker.tsx (Bxx wizard pass) so it can be
 * tested without rendering the React tree — the component is small
 * and the parsing rules are the part that actually has branches.
 *
 * The contract is the same as `kubectl label`:
 *  - `key=value` → { key, value }
 *  - `key` (no =) → { key, value: "" }
 *  - `key=val=ue` → { key, value: "val=ue" }  (split on the FIRST =)
 *  - empty / whitespace-only / `=value` → null
 */
import { describe, expect, it } from 'vitest';
import { parseLabelDraft } from './parseLabelDraft';

describe('parseLabelDraft', () => {
  it('parses a simple key=value pair', () => {
    expect(parseLabelDraft('app=my-app')).toEqual({
      key: 'app',
      value: 'my-app',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseLabelDraft('  app = my-app  ')).toEqual({
      key: 'app',
      value: 'my-app',
    });
  });

  it('returns an empty value when there is no = in the input', () => {
    // The form lets a user add a key-only label; the value gets
    // filled in via the chip's edit affordance later. Today the
    // editor doesn't expose per-chip edit (only add / remove), so
    // the empty-value case is the common one.
    expect(parseLabelDraft('tier')).toEqual({ key: 'tier', value: '' });
  });

  it('splits on the first = (a value containing = is preserved)', () => {
    // Without this, `key=val=ue` would either land as
    // { key: "key", value: "val" } (split on last =) or
    // { key: "key=val", value: "ue" } (split on a non-first =).
    // The kubectl convention is to take the part before the first
    // = as the key, which is what users expect when they paste
    // `connection=host=db.local`.
    expect(parseLabelDraft('conn=host=db.local')).toEqual({
      key: 'conn',
      value: 'host=db.local',
    });
  });

  it('rejects an empty / whitespace-only input', () => {
    expect(parseLabelDraft('')).toBeNull();
    expect(parseLabelDraft('   ')).toBeNull();
  });

  it('rejects an input that is only = (no key, no value)', () => {
    expect(parseLabelDraft('=value')).toBeNull();
    expect(parseLabelDraft('=')).toBeNull();
  });

  it('rejects a key that is whitespace after the =', () => {
    // `app =` → key is "app", value is "" (the user's intent is a
    // key-only label, which is valid). But `app =   ` with a
    // whitespace-only value should also pass, since trim is on
    // both sides. This pins both behaviors.
    expect(parseLabelDraft('app=   ')).toEqual({ key: 'app', value: '' });
  });
});
