import type { Language } from '../../db/types.js';

/**
 * Scanner and hook source suffixes have one owner. Keep every extension here so
 * automatic sync cannot silently lag behind language registration.
 */
export const SOURCE_EXTENSION_TO_LANGUAGE: Readonly<Record<string, Language>> = Object.freeze({
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
  '.mjs': 'javascript', '.cjs': 'javascript', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python', '.pyi': 'python',
  '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.cs': 'csharp', '.php': 'php', '.rb': 'ruby',
  '.swift': 'swift', '.kt': 'kotlin', '.kts': 'kotlin', '.dart': 'dart', '.luau': 'luau', '.zig': 'zig',
  '.svelte': 'svelte', '.vue': 'vue', '.liquid': 'liquid',
  '.pas': 'pascal', '.dfm': 'pascal', '.fmx': 'pascal', '.scala': 'scala', '.sc': 'scala',
  '.lua': 'lua', '.m': 'objc', '.mm': 'objc',
  '.yaml': 'yaml', '.yml': 'yaml', '.twig': 'twig',
  '.xml': 'xml', '.properties': 'properties',
});

export const SUPPORTED_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.keys(SOURCE_EXTENSION_TO_LANGUAGE),
);

/** Returns the final lower-cased suffix, including its leading dot. */
export function sourceExtension(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const dot = normalized.lastIndexOf('.');
  return dot > slash ? normalized.slice(dot).toLowerCase() : '';
}

export function isSupportedSourcePath(filePath: string): boolean {
  return SUPPORTED_SOURCE_EXTENSIONS.has(sourceExtension(filePath));
}
