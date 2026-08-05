/**
 * Provider types barrel — re-exports all domain type modules.
 *
 * Split from providers/types.ts during the large-file refactor.
 * All existing import paths (`from '../../providers/types'`) continue to work
 * because TypeScript resolves `types/` directories via `index.ts`.
 */

export * from './resource';
export * from './table';
export * from './cluster';
export * from './kubernetes';
export * from './helm';
export * from './observability';
export * from './image';
export * from './operations';
export * from './sbom';
export * from './provider';
