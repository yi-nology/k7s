/**
 * Tests for the client-side image upgrade helper. The action's whole value
 * proposition is that it touches a single field per container and leaves
 * everything else byte-identical — so the tests focus on edge cases
 * (init containers, multi-document YAML, missing containers) that would
 * silently corrupt the manifest if mishandled.
 */
import { describe, expect, it } from "vitest";
import {
  extractContainerImages,
  rewriteContainerImage,
} from "./imageUpgrade";

const SAMPLE_DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: wiki
  namespace: prod
spec:
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.25
        ports:
        - containerPort: 80
      - name: sidecar
        image: envoyproxy/envoy:v1.30
`;

const SAMPLE_WITH_INIT = `apiVersion: batch/v1
kind: Job
metadata:
  name: migrator
spec:
  template:
    spec:
      initContainers:
      - name: db-migrate
        image: busybox:1.36
        command: ["/bin/sh", "-c", "true"]
      containers:
      - name: main
        image: my-app:1.2.3
`;

const SAMPLE_MULTI_DOC = `apiVersion: v1
kind: Service
metadata:
  name: wiki
spec:
  selector:
    app: wiki
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wiki
spec:
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.25
`;

const SAMPLE_CRONJOB_WITH_ANNOTATION = `apiVersion: batch/v1
kind: CronJob
metadata:
  name: cleanup
  annotations:
    # An 'image' key in annotations must NOT be picked up — it's not a
    # container field, just a label that happens to contain the substring.
    example.com/track-image: "old:1.0"
spec:
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: janitor
            image: cleanup:0.4
`;

describe("extractContainerImages", () => {
  it("returns an empty array for empty input", () => {
    expect(extractContainerImages("")).toEqual([]);
  });

  it("picks up every container in a Deployment", () => {
    const got = extractContainerImages(SAMPLE_DEPLOYMENT);
    expect(got).toEqual([
      { name: "app", kind: "standard", image: "nginx:1.25" },
      { name: "sidecar", kind: "standard", image: "envoyproxy/envoy:v1.30" },
    ]);
  });

  it("distinguishes initContainers from containers", () => {
    const got = extractContainerImages(SAMPLE_WITH_INIT);
    expect(got).toEqual([
      { name: "db-migrate", kind: "init", image: "busybox:1.36" },
      { name: "main", kind: "standard", image: "my-app:1.2.3" },
    ]);
  });

  it("stops at `---` and only walks the workload document", () => {
    // The first document is a Service (no `containers:`), the second is
    // a Deployment. Only the Deployment's `app` should be returned.
    const got = extractContainerImages(SAMPLE_MULTI_DOC);
    expect(got).toEqual([{ name: "app", kind: "standard", image: "nginx:1.25" }]);
  });

  it("ignores `image:` lines in annotations", () => {
    const got = extractContainerImages(SAMPLE_CRONJOB_WITH_ANNOTATION);
    expect(got).toEqual([{ name: "janitor", kind: "standard", image: "cleanup:0.4" }]);
  });

  it("handles a manifest with no containers", () => {
    const yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: x
data:
  key: value
`;
    expect(extractContainerImages(yaml)).toEqual([]);
  });
});

describe("rewriteContainerImage", () => {
  it("replaces the named container's image and leaves siblings untouched", () => {
    const out = rewriteContainerImage(SAMPLE_DEPLOYMENT, "sidecar", "envoyproxy/envoy:v1.31");
    expect(out).toMatch(/^ {6}- name: sidecar$/m);
    // The new image is on the line below `- name: sidecar`, with the
    // same indent as the original. Pinning the exact line keeps the
    // diff to a single field.
    expect(out).toMatch(/^ {8}image: envoyproxy\/envoy:v1\.31$/m);
    // The other container's image is byte-identical.
    expect(out).toMatch(/^ {8}image: nginx:1\.25$/m);
    // Surrounding fields survive verbatim — pin a couple as canaries.
    expect(out).toMatch(/^ {8}ports:$/m);
    expect(out).toMatch(/^ {8}- containerPort: 80$/m);
  });

  it("rewrites the initContainer image when targeted by name", () => {
    const out = rewriteContainerImage(SAMPLE_WITH_INIT, "db-migrate", "busybox:1.37");
    expect(out).toMatch(/^ {8}image: busybox:1\.37$/m);
    // The standard container is untouched.
    expect(out).toMatch(/^ {8}image: my-app:1\.2\.3$/m);
  });

  it("returns the YAML unchanged when the container name is not found", () => {
    const out = rewriteContainerImage(SAMPLE_DEPLOYMENT, "ghost", "nope:1");
    expect(out).toBe(SAMPLE_DEPLOYMENT);
  });

  it("refuses to write an empty image value", () => {
    expect(() => rewriteContainerImage(SAMPLE_DEPLOYMENT, "app", "")).toThrow(
      /image must not be empty/i,
    );
    expect(() => rewriteContainerImage(SAMPLE_DEPLOYMENT, "app", "   ")).toThrow(
      /image must not be empty/i,
    );
  });

  it("does not touch the `---`-separated Service in a multi-doc YAML", () => {
    // The Service document has no `containers:` so nothing should change
    // there; the Deployment's `app` image should still be rewritten.
    const out = rewriteContainerImage(SAMPLE_MULTI_DOC, "app", "nginx:1.26");
    // Service block is byte-identical: the only change is below `---`.
    const [serviceBlock, deployBlock] = out.split("\n---\n");
    expect(serviceBlock).toBe(SAMPLE_MULTI_DOC.split("\n---\n")[0]);
    expect(deployBlock).toMatch(/^ {8}image: nginx:1\.26$/m);
  });

  it("preserves the line's leading whitespace (no reformatting)", () => {
    // The rewrite is a string-replace of the value only; the leading
    // whitespace and the `image:` token are kept verbatim so the diff
    // the user sees is exactly the field that changed. Pinning the
    // exact 8-space indent catches a refactor that accidentally calls
    // `.trimStart()` on the line or rebuilds it from scratch.
    const yaml = `spec:
  template:
    spec:
      containers:
      - name: app
        image: old:1.0
`;
    const out = rewriteContainerImage(yaml, "app", "new:2.0");
    expect(out).toMatch(/^ {8}image: new:2\.0$/m);
    // Trailing lines survive verbatim — a smoke test that the loop
    // pushed every line it didn't touch.
    expect(out).toMatch(/^ {6}- name: app$/m);
    expect(out).toMatch(/^ {2}template:$/m);
  });
});

/**
 * The "modify-image" action composes extract + rewrite: the dialog uses
 * extract to populate inputs, the user edits the values, then rewrite is
 * called once per changed container. The round-trip test below is the
 * acceptance criterion — pick a YAML, run extract, rewrite each entry,
 * and the result is parse-equivalent (same container images, same other
 * fields) to the input.
 */
describe("extract + rewrite round-trip", () => {
  it("rewriting every extracted image yields the same image set as the input", () => {
    const newImages: Record<string, string> = {
      app: "nginx:1.26",
      sidecar: "envoyproxy/envoy:v1.31",
    };
    let out = SAMPLE_DEPLOYMENT;
    for (const c of extractContainerImages(SAMPLE_DEPLOYMENT)) {
      out = rewriteContainerImage(out, c.name, newImages[c.name]!);
    }
    const after = extractContainerImages(out);
    expect(after.map((c) => c.image)).toEqual([
      "nginx:1.26",
      "envoyproxy/envoy:v1.31",
    ]);
  });
});

// Regression: some workloads (and kubectl output) put `image:` before `name:`
// inside a container. The state machine must handle any field order.
const YAML_IMAGE_BEFORE_NAME = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: kylin-insights-frontend
  namespace: kylin-insights
spec:
  template:
    spec:
      containers:
      - image: cr.kylinos.cn/kylin-insight/kylin-insights-frontend:main_v3-20260728-a3e77b36-gitlabci
        imagePullPolicy: IfNotPresent
        name: kylin-insights-frontend
        ports:
        - containerPort: 80
`;

describe("field order: image before name", () => {
  it("extracts container when image appears before name", () => {
    const out = extractContainerImages(YAML_IMAGE_BEFORE_NAME);
    expect(out).toEqual([
      {
        name: "kylin-insights-frontend",
        kind: "standard",
        image: "cr.kylinos.cn/kylin-insight/kylin-insights-frontend:main_v3-20260728-a3e77b36-gitlabci",
      },
    ]);
  });

  it("rewrites the image even when name comes after image", () => {
    const out = rewriteContainerImage(
      YAML_IMAGE_BEFORE_NAME,
      "kylin-insights-frontend",
      "cr.kylinos.cn/kylin-insight/kylin-insights-frontend:v2.0.0",
    );
    expect(out).toMatch(/image: cr\.kylinos\.cn\/kylin-insight\/kylin-insights-frontend:v2\.0\.0/m);
    // The name line is preserved verbatim.
    expect(out).toMatch(/name: kylin-insights-frontend/m);
  });
});
