/**
 * Tests for the events time-range filter shared by the Cluster → Events table
 * and the detail-panel EventsTab.
 */

import { describe, expect, it } from "vitest";
import { eventWithinSince, parseEventMs, SINCE_OPTIONS } from "./events";

const NOW = Date.UTC(2026, 7, 3, 2, 30, 0); // fixed "now" so cutoffs are exact
const min = 60_000;
const hour = 60 * min;

describe("eventWithinSince", () => {
  it("'all' keeps everything regardless of age", () => {
    expect(eventWithinSince(NOW - 100 * hour, "all", NOW)).toBe(true);
    expect(eventWithinSince(NOW, "all", NOW)).toBe(true);
  });

  it("keeps an event inside the window", () => {
    expect(eventWithinSince(NOW - 4 * min, "5m", NOW)).toBe(true);
    expect(eventWithinSince(NOW - 30 * min, "1h", NOW)).toBe(true);
    expect(eventWithinSince(NOW - 2 * hour, "24h", NOW)).toBe(true);
  });

  it("drops an event outside the window", () => {
    expect(eventWithinSince(NOW - 6 * min, "5m", NOW)).toBe(false);
    expect(eventWithinSince(NOW - 61 * min, "1h", NOW)).toBe(false);
    expect(eventWithinSince(NOW - 25 * hour, "24h", NOW)).toBe(false);
  });

  // "1h" must not flicker a 3600.0s-old event in and out — the boundary is kept.
  it("keeps the exact boundary (inclusive)", () => {
    expect(eventWithinSince(NOW - 5 * min, "5m", NOW)).toBe(true);
    expect(eventWithinSince(NOW - hour, "1h", NOW)).toBe(true);
  });

  it("covers every SINCE_OPTIONS entry", () => {
    for (const o of SINCE_OPTIONS) {
      // recent event always kept; an event far in the past is kept iff 'all'
      expect(eventWithinSince(NOW, o, NOW)).toBe(true);
      const farOld = o === "all";
      expect(eventWithinSince(NOW - 1000 * hour, o, NOW)).toBe(farOld);
    }
  });
});

describe("parseEventMs", () => {
  it("parses an ISO timestamp to epoch ms", () => {
    expect(parseEventMs("2026-08-03T02:00:00Z")).toBe(
      Date.UTC(2026, 7, 3, 2, 0, 0),
    );
  });

  it("returns null for missing input (kept regardless of filter)", () => {
    expect(parseEventMs(undefined)).toBeNull();
    expect(parseEventMs(null)).toBeNull();
    expect(parseEventMs("")).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(parseEventMs("not-a-date")).toBeNull();
  });
});
