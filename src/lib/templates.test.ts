/**
 * Tests for the template registry. The `renderTemplate` function is the
 * integration point between the form, the picker, and the k8s YAML preview;
 * we pin a few invariants here so that future refactors (adding new templates,
 * tightening bounds, swapping the clamp policy) don't silently drift.
 */
import { describe, expect, it } from "vitest";
import {
  defaultValuesFor,
  getTemplate,
  listTemplates,
  renderTemplate,
  type Template,
} from "./templates";

const allTemplateIds = listTemplates().map((t) => t.id);

describe("template registry", () => {
  it("exposes the three Phase-4 templates by id", () => {
    // Pinned so a future refactor that drops or renames a template fails
    // loudly (the picker would silently lose the entry).
    expect(allTemplateIds).toEqual(
      expect.arrayContaining(["deployment", "ingress", "configmap"]),
    );
  });

  it("getTemplate() round-trips every listed template", () => {
    for (const id of allTemplateIds) {
      const t = getTemplate(id);
      expect(t?.id).toBe(id);
    }
  });

  it("getTemplate() returns undefined for an unknown id", () => {
    expect(getTemplate("not-a-real-template")).toBeUndefined();
  });

  it("renderTemplate() throws on an unknown id", () => {
    expect(() => renderTemplate("nope", {})).toThrow(/not found/i);
  });
});

describe("defaultValuesFor()", () => {
  it("returns a record keyed by every param.key with the default value", () => {
    const tpl = getTemplate("deployment")!;
    const defaults = defaultValuesFor(tpl);
    for (const p of tpl.params) {
      expect(defaults[p.key]).toBe(p.default);
    }
    expect(Object.keys(defaults)).toHaveLength(tpl.params.length);
  });
});

describe("number param bounds mirror clampInt in the renderer", () => {
  // The form's `min` / `max` HTML5 attributes must agree with the bounds
  // enforced server-side by the renderer's `clampInt` (templates.ts). If
  // they ever drift, the user would see the form's preview disagree with
  // the input value (a number outside the bound is silently clamped on
  // render but the form input still shows the typed value).
  it("every number param has min and max defined", () => {
    for (const t of listTemplates()) {
      for (const p of t.params) {
        if (p.kind !== "number") continue;
        expect(
          p.min,
          `${t.id}.${p.key} should have min`,
        ).toBeTypeOf("number");
        expect(
          p.max,
          `${t.id}.${p.key} should have max`,
        ).toBeTypeOf("number");
        expect(
          p.min! <= p.max!,
          `${t.id}.${p.key} min (${p.min}) must be <= max (${p.max})`,
        ).toBe(true);
        const n = Number.parseInt(p.default, 10);
        expect(
          Number.isFinite(n) && n >= p.min! && n <= p.max!,
          `${t.id}.${p.key} default (${p.default}) must be within [${p.min}, ${p.max}]`,
        ).toBe(true);
      }
    }
  });

  it("deployment.replicas bounds are 1..100", () => {
    const t = getTemplate("deployment")!;
    const r = t.params.find((p) => p.key === "replicas")!;
    expect(r.min).toBe(1);
    expect(r.max).toBe(100);
  });

  it("deployment.port and ingress.port bounds are 1..65535", () => {
    const d = getTemplate("deployment")!.params.find((p) => p.key === "port")!;
    const i = getTemplate("ingress")!.params.find((p) => p.key === "port")!;
    expect(d.min).toBe(1);
    expect(d.max).toBe(65535);
    expect(i.min).toBe(1);
    expect(i.max).toBe(65535);
  });
});

describe("renderTemplate() clampInt behaviour (number params)", () => {
  // These tests document the silent-clamp behaviour: a number outside the
  // param's bounds is replaced by the bound. The form's new `min` / `max`
  // attributes prevent the user from ever reaching these code paths, but
  // a programmatic caller (or a stale form) could still feed out-of-range
  // values, and the renderer must keep the YAML well-formed.
  it("deployment.replicas=0 is clamped to the lower bound (1)", () => {
    const t = getTemplate("deployment")!;
    const yaml = renderTemplate(t.id, { ...defaultValuesFor(t), replicas: "0" });
    expect(yaml).toMatch(/replicas: 1\b/);
  });

  it("deployment.replicas=-5 is clamped to the lower bound (1)", () => {
    const t = getTemplate("deployment")!;
    const yaml = renderTemplate(t.id, {
      ...defaultValuesFor(t),
      replicas: "-5",
    });
    expect(yaml).toMatch(/replicas: 1\b/);
  });

  it("deployment.replicas=999 is clamped to the upper bound (100)", () => {
    const t = getTemplate("deployment")!;
    const yaml = renderTemplate(t.id, {
      ...defaultValuesFor(t),
      replicas: "999",
    });
    expect(yaml).toMatch(/replicas: 100\b/);
  });

  it("deployment.port=99999 is clamped to the upper bound (65535)", () => {
    const t = getTemplate("deployment")!;
    const yaml = renderTemplate(t.id, {
      ...defaultValuesFor(t),
      port: "99999",
    });
    expect(yaml).toMatch(/containerPort: 65535\b/);
    expect(yaml).toMatch(/  - port: 65535\b/);
  });

  it("deployment.port=abc falls back to the param default (80)", () => {
    const t = getTemplate("deployment")!;
    const yaml = renderTemplate(t.id, {
      ...defaultValuesFor(t),
      port: "abc",
    });
    expect(yaml).toMatch(/containerPort: 80\b/);
  });
});

describe("renderTemplate() ingress and configmap variants", () => {
  // The Deployment template was the only one exercised by the original
  // v0.2.4 pass; this is a smoke test that the Ingress and ConfigMap
  // paths produce a well-formed YAML document (apiVersion / kind / name /
  // namespace / spec or data) so a future refactor that breaks the YAML
  // shape fails loudly here.
  it("ingress default values produce a valid Ingress document", () => {
    const t = getTemplate("ingress")!;
    const yaml = renderTemplate(t.id, defaultValuesFor(t));
    expect(yaml).toMatch(/^apiVersion: networking\.k8s\.io\/v1$/m);
    expect(yaml).toMatch(/^kind: Ingress$/m);
    expect(yaml).toMatch(/^  name: my-app-ingress$/m);
    expect(yaml).toMatch(/^  namespace: default$/m);
    expect(yaml).toMatch(/^  - host: app\.example\.com$/m);
    expect(yaml).toMatch(/^      - path: \/$/m);
  });

  it("configmap default values produce a valid ConfigMap document", () => {
    const t = getTemplate("configmap")!;
    const yaml = renderTemplate(t.id, defaultValuesFor(t));
    expect(yaml).toMatch(/^apiVersion: v1$/m);
    expect(yaml).toMatch(/^kind: ConfigMap$/m);
    expect(yaml).toMatch(/^  name: my-config$/m);
    expect(yaml).toMatch(/^data:$/m);
    expect(yaml).toMatch(/^  log\.level: info$/m);
    expect(yaml).toMatch(/^  feature\.flag: true$/m);
  });

  it("configmap empty name falls back to the default", () => {
    const t = getTemplate("configmap")!;
    const yaml = renderTemplate(t.id, { ...defaultValuesFor(t), name: "" });
    expect(yaml).toMatch(/^  name: my-config$/m);
  });

  it("configmap custom key/value pair is rendered into the data map", () => {
    const t = getTemplate("configmap")!;
    const yaml = renderTemplate(t.id, {
      ...defaultValuesFor(t),
      key1: "db.host",
      value1: "postgres.local",
    });
    expect(yaml).toMatch(/^  db\.host: postgres\.local$/m);
  });
});
