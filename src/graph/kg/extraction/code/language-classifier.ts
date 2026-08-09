import { extname } from 'node:path';
import type { Language } from '../../db/types.js';

export interface SourceLanguageClassification {
  language: Language;
  reason: 'path-language' | 'objc-strong-signal' | 'cpp-strong-signal' | 'header-default-c';
  matchedSignals: string[];
}

interface LanguageSignal {
  name: string;
  pattern: RegExp;
}

const OBJC_HEADER_SIGNALS: LanguageSignal[] = [
  { name: '@interface', pattern: /@interface\b/ },
  { name: '@implementation', pattern: /@implementation\b/ },
  { name: '@protocol', pattern: /@protocol\b/ },
  { name: '@property', pattern: /@property\b/ },
  { name: '@class', pattern: /@class\b/ },
  { name: 'objc-method', pattern: /^[ \t]*[+-][ \t]*\([^\r\n)]*\)[ \t]*[A-Za-z_]\w*/m },
  { name: '#import', pattern: /^[ \t]*#[ \t]*import\b/m },
  { name: '@import', pattern: /@import\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*;/ },
];

const CPP_HEADER_SIGNALS: LanguageSignal[] = [
  { name: 'namespace', pattern: /\bnamespace\s+(?:[A-Za-z_]\w*\s*)?(?:\{|=)/ },
  { name: 'template', pattern: /\btemplate\s*</ },
  { name: 'class-declaration', pattern: /\bclass\s+[A-Za-z_]\w*(?:\s+final)?\s*(?::|\{|;)/ },
  { name: 'std::', pattern: /\bstd\s*::/ },
  { name: 'extern-c', pattern: /\bextern\s*"C"/ },
  { name: 'access-label', pattern: /\b(?:public|private|protected)\s*:/ },
];

/**
 * 屏蔽不会影响语言语义的注释和 literal，避免其中的 token 误导 header 分类。
 * 唯一例外是 C++ grammar token `extern "C"`，它不是任意 string 内容。
 */
function sanitizeForLanguageSignals(sourceCode: string): string {
  const output = sourceCode.split('');
  let index = 0;

  const blank = (start: number, end: number): void => {
    for (let cursor = start; cursor < end; cursor++) {
      if (output[cursor] !== '\n' && output[cursor] !== '\r') output[cursor] = ' ';
    }
  };

  while (index < sourceCode.length) {
    if (sourceCode[index] === 'R' || sourceCode[index] === 'u' || sourceCode[index] === 'U' || sourceCode[index] === 'L') {
      const rawOpening = sourceCode.slice(index, index + 32)
        .match(/^(?:u8|u|U|L)?R"([^\s()\\]{0,16})\(/);
      if (rawOpening) {
        const start = index;
        const closingMarker = `)${rawOpening[1]}"`;
        const closingIndex = sourceCode.indexOf(closingMarker, index + rawOpening[0].length);
        index = closingIndex < 0 ? sourceCode.length : closingIndex + closingMarker.length;
        blank(start, index);
        continue;
      }
    }

    if (sourceCode[index] === '/' && sourceCode[index + 1] === '/') {
      const start = index;
      index += 2;
      while (index < sourceCode.length && sourceCode[index] !== '\n') index++;
      blank(start, index);
      continue;
    }

    if (sourceCode[index] === '/' && sourceCode[index + 1] === '*') {
      const start = index;
      index += 2;
      while (index < sourceCode.length && !(sourceCode[index] === '*' && sourceCode[index + 1] === '/')) index++;
      index = Math.min(index + 2, sourceCode.length);
      blank(start, index);
      continue;
    }

    const quote = sourceCode[index];
    if (quote === '"' || quote === "'") {
      const start = index;
      index++;
      while (index < sourceCode.length) {
        if (sourceCode[index] === '\\') {
          index = Math.min(index + 2, sourceCode.length);
          continue;
        }
        if (sourceCode[index] === quote) {
          index++;
          break;
        }
        index++;
      }

      const literal = sourceCode.slice(start, index);
      let prefixEnd = start;
      while (prefixEnd > 0 && /\s/.test(output[prefixEnd - 1])) prefixEnd--;
      let prefixStart = prefixEnd;
      while (prefixStart > 0 && /[A-Za-z_]/.test(output[prefixStart - 1])) prefixStart--;
      const isExternCString = quote === '"'
        && literal === '"C"'
        && output.slice(prefixStart, prefixEnd).join('') === 'extern';
      if (!isExternCString) blank(start, index);
      continue;
    }

    index++;
  }

  return output.join('');
}

function matchingSignals(sourceCode: string, signals: LanguageSignal[]): string[] {
  return signals.filter(signal => signal.pattern.test(sourceCode)).map(signal => signal.name);
}

/**
 * 使用文件内容收敛 Apple source 的最终语言。扫描阶段仍可使用 path-only provisional route。
 */
export function classifyLanguageForSource(
  filePath: string,
  sourceCode: string,
  pathLanguage: Language,
): SourceLanguageClassification {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.m' || extension === '.mm') {
    return { language: 'objc', reason: 'path-language', matchedSignals: [] };
  }
  if (extension === '.swift') {
    return { language: 'swift', reason: 'path-language', matchedSignals: [] };
  }
  if (extension !== '.h') {
    return { language: pathLanguage, reason: 'path-language', matchedSignals: [] };
  }

  const sanitizedSource = sanitizeForLanguageSignals(sourceCode);
  const objcSignals = matchingSignals(sanitizedSource, OBJC_HEADER_SIGNALS);
  if (objcSignals.length > 0) {
    return { language: 'objc', reason: 'objc-strong-signal', matchedSignals: objcSignals };
  }

  const cppSignals = matchingSignals(sanitizedSource, CPP_HEADER_SIGNALS);
  if (cppSignals.length > 0) {
    return { language: 'cpp', reason: 'cpp-strong-signal', matchedSignals: cppSignals };
  }

  return { language: 'c', reason: 'header-default-c', matchedSignals: [] };
}
