/**
 * SBOM (Software Bill of Materials) types.
 */

export type SbomFormat = 'cyclonedx' | 'spdx';

export interface SbomSourceImage {
  kind: 'image';
  imageRef: string;
  namespace: string;
  pod?: string;
}

export interface SbomSourceCluster {
  kind: 'cluster';
  context: string;
}

export type SbomSource = SbomSourceImage | SbomSourceCluster;

export interface SbomComponent {
  name: string;
  version: string;
  purl?: string;
  cpe?: string;
  componentType: string;
  licenses: string[];
  supplier?: string;
  hashes: string[];
}

export interface SbomDependency {
  refId: string;
  dependsOn: string[];
}

export interface SbomVulnerability {
  id: string;
  severity: string;
  affectedComponents: string[];
  description?: string;
  fixedVersion?: string;
}

export interface SbomMetadata {
  tool: string;
  toolVersion: string;
  scanDurationMs: number;
}

export interface SbomResult {
  id: string;
  source: SbomSource;
  format: SbomFormat;
  specVersion: string;
  metadata: SbomMetadata;
  components: SbomComponent[];
  dependencies: SbomDependency[];
  vulnerabilities: SbomVulnerability[];
  rawOutput?: string;
  createdAt: string;
}

export interface SbomSummary {
  id: string;
  source: SbomSource;
  format: SbomFormat;
  componentCount: number;
  vulnerabilityCount: number;
  tool: string;
  createdAt: string;
}
