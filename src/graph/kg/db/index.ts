// src/graph/kg/db/index.ts — DB 层导出

export { KgDatabaseConnection, KG_SCHEMA_VERSION, getKgDatabasePath, makeNodeId, validateNodeId, isFileLevelOnlyLanguage, isKnowledgeSourceType, FILE_LEVEL_ONLY_LANGUAGES } from './connection.js';
export { KgQueryBuilder, sanitizeFtsQuery } from './queries.js';
export { applyMigrations } from './migrations.js';
export * from './types.js';
