export { ToolRegistry } from './core/tool-registry.js';
export { ExtensionLoader } from './core/extension-loader.js';
export { loadConfig, saveConfig } from './config/index.js';
export { paths } from './config/paths.js';
export {
  createManifest,
  addFile,
  addDir,
  saveManifest,
  findManifest,
  getAllManifests,
  deleteManifest,
  cleanManifestFiles,
} from './core/manifest.js';
export type { Manifest, ManifestEntry } from './core/manifest.js';
export {
  migrateAndInject,
  injectContent,
  injectDocFile,
  removeContent,
  removeAllSections,
  hasSection,
  hasAnyMarkers,
} from './core/tag-injector.js';
export type { MigrateResult, MigrateAction, CopyStats } from './core/tag-injector.js';
export { COMPONENT_DEFS } from './core/component-defs.js';
export type { ComponentDef } from './core/component-defs.js';
export {
  scanDisabledItems,
  restoreDisabledState,
} from './commands/install-backend.js';
export type { DisabledItem } from './commands/install-backend.js';
export { ADDON_REGISTRY, HARNESS_DIRS } from './core/addon-registry.js';
export type { AddonDef, AddonTarget, HarnessType } from './core/addon-registry.js';
export type * from './types/index.js';

// KG public API
export { MaestroGraph } from './graph/kg/engine.js';
export { NodeKindRegistry } from './graph/kg/db/node-kind-registry.js';
export type { NodeKindMeta } from './graph/kg/db/node-kind-registry.js';
export { KnowledgeExtractorRegistry } from './graph/kg/extraction/knowledge-extractor-registry.js';
export type { ExtractorFunction, KnowledgeExtractorEntry } from './graph/kg/extraction/knowledge-extractor-registry.js';
export type { ExtractionResult, UnifiedNodeKind, UnifiedNode, UnifiedEdge } from './graph/kg/db/types.js';
