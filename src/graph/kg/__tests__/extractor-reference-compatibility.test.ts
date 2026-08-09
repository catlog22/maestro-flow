import { describe, expect, it } from 'vitest';
import { extractDfm } from '../extraction/code/dfm-extractor.js';
import { getExtractor } from '../extraction/code/languages/index.js';
import { extractMybatisXml } from '../extraction/code/mybatis-extractor.js';
import { PluginEngine } from '../extraction/code/plugin-engine.js';
import { makeImportReference } from '../extraction/code/tree-sitter-types.js';

describe('extractor reference compatibility', () => {
  it('retains DFM event handlers as call references', () => {
    const result = extractDfm([
      'object MainForm: TMainForm',
      '  OnClick = HandleClick',
      'end',
    ].join('\n'), '/project/Main.dfm');

    expect(result.references).toContainEqual(expect.objectContaining({
      referenceKind: 'calls',
      referenceName: 'HandleClick',
    }));
  });

  it('retains MyBatis include targets as symbol references', () => {
    const result = extractMybatisXml([
      '<mapper namespace="DemoMapper">',
      '  <select id="findAll">',
      '    <include refid="BaseColumns"/>',
      '  </select>',
      '</mapper>',
    ].join('\n'), '/project/DemoMapper.xml');

    expect(result.references).toContainEqual(expect.objectContaining({
      referenceKind: 'references',
      referenceName: 'BaseColumns',
    }));
  });

  it('preserves strict import facts and diagnostics when plugin results are merged', () => {
    const importReference = makeImportReference('/project/Feature.swift', 'UIKit', 1, 1);
    const result = new PluginEngine('/project').mergeResults({
      symbols: [],
      references: [],
      importReferences: [importReference],
      structuralReferences: [],
      edges: [],
      diagnostics: ['objcxx-partial-parse'],
    }, { symbols: [] });

    expect(result.importReferences).toEqual([importReference]);
    expect(result.diagnostics).toEqual(['objcxx-partial-parse']);
  });

  it('retains Vue composable invocations in the fallback extractor', () => {
    const extractor = getExtractor('vue');
    expect(extractor).not.toBeNull();
    const result = extractor!.extract(
      {} as never,
      '<script setup>\nconst state = useFeature()\n</script>\n',
      '/project/Feature.vue',
    );

    expect(result.references).toContainEqual(expect.objectContaining({
      referenceKind: 'calls',
      referenceName: 'useFeature',
    }));
  });
});
