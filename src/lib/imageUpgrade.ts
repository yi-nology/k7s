/**
 * Client-side helper for the "modify-image" row action (Bxx — KubePi parity).
 *
 * The flow is: fetch the workload's YAML → extract the current container
 * images → render an input per container → let the user type a new
 * `image:tag` → splice the new values back into the YAML → apply via the
 * existing `applyYaml` path (so the user still gets the dry-run diff
 * before anything is written).
 *
 * Why regex instead of a YAML library:
 *   - k7s already ships `@codemirror/lang-yaml` for syntax highlighting, but
 *     its Lezer grammar doesn't expose a generic YAML AST API to the rest
 *     of the app. Pulling in `js-yaml` just for this would be a real cost
 *     (≈ 45 kB gzipped) for a single field-rewrite feature.
 *   - The two structures we touch — `containers[].image` and
 *     `initContainers[].image` — are dead-regular in every manifest the
 *     `kubectl` round-trip emits. A constrained regex is enough, and the
 *     tests below pin exactly what the regex matches and what it leaves
 *     alone.
 *
 * What the regex deliberately does NOT do:
 *   - Touch `image:` lines in `annotations` (image-promoter style), in
 *     `env.valueFrom.fieldRef` (no, those don't have image fields, but
 *     other future fields might), or in CRD spec that happens to include
 *     its own `image` key. The two container-array paths are
 *     distinguished by indentation: a `containers:` array member has its
 *     `image:` at exactly 8 spaces; an `initContainers:` member at 10.
 *   - Re-flow the document. A change is a same-length or shorter
 *     replacement of the *value* of `image:`; the surrounding structure
 *     is preserved byte-for-byte so the diff the user sees is a single
 *     field change.
 */

export interface ContainerImage {
  /** The container's `name:` from the manifest. Used as the input label
   *  and as a stable identifier in the dialog so the user can tell
   *  `app` from `sidecar` at a glance. */
  name: string;
  /** "init" if this came from `initContainers:`, "standard" otherwise. */
  kind: "standard" | "init";
  /** The current image:tag value, as the manifest wrote it. */
  image: string;
}

/**
 * Parse the container images out of a single-document workload YAML.
 * Returns an empty array for an empty/invalid input so the dialog can
 * render an empty state instead of crashing.
 *
 * Only walks `containers:` and `initContainers:` arrays at the
 * `spec.template.spec` level — that's the canonical pod-template path for
 * Deployments, StatefulSets, DaemonSets, Jobs, and CronJobs. Other
 * resources (e.g. ReplicaSets, raw Pods) with the same shape are
 * supported as a side effect.
 */
export function extractContainerImages(yaml: string): ContainerImage[] {
  if (!yaml) return [];
  const out: ContainerImage[] = [];
  const lines = yaml.split("\n");

  // State machine: which container-array section we're currently inside,
  // and the indent at which its members live. `null` means "not in a
  // container array". A new `containers:` or `initContainers:` at a
  // shallower indent closes the previous one.
  let section: "standard" | "init" | null = null;
  // Indent of the array's `- name:` lines, in spaces. We track this so
  // we know the exact column where `image:` should sit for a member.
  let memberIndent = -1;
  // The current container's name (set by `- name: <X>` and reset when
  // we leave the array).
  let currentName: string | null = null;

  for (const raw of lines) {
    // Stop on document boundary (CronJob bundles a Service + StatefulSet
    // via `---`, and we only want the workload's own containers).
    if (/^---\s*$/.test(raw)) {
      section = null;
      memberIndent = -1;
      currentName = null;
      continue;
    }

    const leading = raw.match(/^(\s*)/)?.[1].length ?? 0;
    const trimmed = raw.trim();

    // Closing the section on three triggers:
    //   1. A non-blank, non-comment line at a shallower indent than the
    //      array's heading (`containers:` is at column 6, so anything at
    //      column 0–4 is back outside the pod spec).
    //   2. Another `containers:` / `initContainers:` heading at the same
    //      indent — a manifest can have both arrays in either order, and
    //      the first one ends when the second begins.
    //   3. The `---` document boundary handled at the top of the loop.
    const isContainerHeading = /^containers:\s*(#.*)?$/.test(trimmed);
    const isInitContainerHeading = /^initContainers:\s*(#.*)?$/.test(trimmed);
    if (section !== null) {
      const shallowExit =
        leading <= 2 && trimmed !== "" && !trimmed.startsWith("#");
      const switchHeading =
        (isContainerHeading || isInitContainerHeading) &&
        leading === memberIndent;
      if (shallowExit || switchHeading) {
        section = null;
        memberIndent = -1;
        currentName = null;
      }
    }

    if (section === null) {
      // The array *member* indent is the same as the array's own indent:
      // `- name: app` sits under `containers:` at the same column, not
      // indented further. (A k8s manifest uses 2-space block style, so
      // `containers:` is at 6 spaces and `- name:` is also at 6.)
      if (isContainerHeading) {
        section = "standard";
        memberIndent = leading;
        currentName = null;
        continue;
      }
      if (isInitContainerHeading) {
        section = "init";
        memberIndent = leading;
        currentName = null;
        continue;
      }
    } else {
      // Inside a container array. A `- name: <X>` line at the array's
      // member indent starts a new container; otherwise it's a field
      // on the current one. Container fields (`image:`, `ports:`,
      // `env:`, …) sit one indent level deeper than the member.
      if (leading === memberIndent && trimmed.startsWith("- name:")) {
        currentName = trimmed.slice("- name:".length).trim();
        continue;
      }
      if (
        currentName !== null &&
        leading === memberIndent + 2 &&
        trimmed.startsWith("image:")
      ) {
        const image = trimmed.slice("image:".length).trim();
        out.push({ name: currentName, kind: section, image });
        // Don't reset currentName here — `image:` is a per-container
        // field, not a per-member one, and the next field at the same
        // indent (e.g. `ports:`) belongs to the same container.
      }
    }
  }
  return out;
}

/**
 * Rewrite the `image:` value of a named container in-place.
 *
 * Returns the new YAML if the named container was found, or the original
 * YAML unchanged if it wasn't. The replacement preserves trailing
 * whitespace and the original line's content other than the image
 * value, so a well-formatted file stays well-formatted.
 *
 * Throws when `newImage` is empty — image-less containers don't make
 * sense and the dialog already refuses to submit in that case, so the
 * check is belt-and-suspenders.
 */
export function rewriteContainerImage(
  yaml: string,
  containerName: string,
  newImage: string,
): string {
  if (!newImage.trim()) {
    throw new Error("image must not be empty");
  }
  const lines = yaml.split("\n");
  const out: string[] = [];

  // Same state machine as extractContainerImages, narrowed down to a
  // single target. The repetition is intentional: the two functions have
  // different returns (gather vs. rewrite) and the cost of a second
  // state machine is two dozen lines of code.
  let section: "standard" | "init" | null = null;
  let memberIndent = -1;
  let currentName: string | null = null;

  for (const raw of lines) {
    if (/^---\s*$/.test(raw)) {
      section = null;
      memberIndent = -1;
      currentName = null;
      out.push(raw);
      continue;
    }
    const leading = raw.match(/^(\s*)/)?.[1].length ?? 0;
    const trimmed = raw.trim();

    if (section !== null) {
      // Same close-triggers as the extract function. A second array
      // heading at the same indent (the `initContainers` → `containers`
      // transition is the common case) is its own close event.
      const isContainerHeading = /^containers:\s*(#.*)?$/.test(trimmed);
      const isInitContainerHeading = /^initContainers:\s*(#.*)?$/.test(trimmed);
      const shallowExit =
        leading <= 2 && trimmed !== "" && !trimmed.startsWith("#");
      const switchHeading =
        (isContainerHeading || isInitContainerHeading) &&
        leading === memberIndent;
      if (shallowExit || switchHeading) {
        section = null;
        memberIndent = -1;
        currentName = null;
      }
    }

    if (section === null) {
      // See the matching comment in extractContainerImages: the array's
      // own indent is the member indent. Members and their fields
      // differ by 2 spaces.
      if (/^containers:\s*(#.*)?$/.test(trimmed)) {
        section = "standard";
        memberIndent = leading;
        currentName = null;
      } else if (/^initContainers:\s*(#.*)?$/.test(trimmed)) {
        section = "init";
        memberIndent = leading;
        currentName = null;
      }
    } else {
      if (leading === memberIndent && trimmed.startsWith("- name:")) {
        currentName = trimmed.slice("- name:".length).trim();
      } else if (
        currentName === containerName &&
        leading === memberIndent + 2 &&
        trimmed.startsWith("image:")
      ) {
        // Preserve the leading whitespace and the `image:` token; only
        // the value (and any inline trailing comment) is replaced.
        const prefix = raw.slice(0, raw.indexOf("image:") + "image:".length);
        out.push(`${prefix} ${newImage}`);
        currentName = null; // image is unique per container; done
        continue;
      }
    }
    out.push(raw);
  }
  return out.join("\n");
}
