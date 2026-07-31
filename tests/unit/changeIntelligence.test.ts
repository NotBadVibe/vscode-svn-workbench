import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn()
}));

import * as fs from 'node:fs/promises';
import { buildLocalChangeReview, buildLocalImpactAnalysis } from '../../src/ai/changeIntelligence';
import type { CommitCandidate } from '../../src/commit/commitCandidateCollector';

const candidate = (relativePath: string): CommitCandidate => ({
  absolutePath: `/repo/${relativePath}`,
  relativePath,
  status: 'modified',
  fileType: 'TypeScript',
  templateGroup: 'frontend',
  generatedDecision: 'keep',
  selection: 'selected',
  reason: '本地修改'
});

describe('change intelligence', () => {
  beforeEach(() => vi.mocked(fs.readFile).mockReset());

  it('敏感信息只报告位置，不回显匹配到的密钥', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('const apiKey = "super-secret-value";\n' as never);
    const review = await buildLocalChangeReview([candidate('src/config.ts')]);
    const finding = review.findings.find((item) => item.category === 'security');
    expect(finding?.line).toBe(1);
    expect(finding?.evidence).not.toContain('super-secret-value');
  });

  it('根据 UI 变更生成浏览器验收建议', () => {
    const impact = buildLocalImpactAnalysis([candidate('src/webview/App.svelte')]);
    expect(impact.tests.map((item) => item.command)).toContain('npm run test:webview');
  });

  it('覆盖生成物、调试代码、截断、不可读和跳过状态', async () => {
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const value = String(filePath);
      if (value.endsWith('secret.ts')) return `${'x'.repeat(160_010)}\n-----BEGIN PRIVATE KEY-----` as never;
      if (value.endsWith('debug.ts')) return 'line1\nconsole.debug("visible line");\n' as never;
      if (value.endsWith('unreadable.ts')) throw new Error('denied');
      return 'ok' as never;
    });
    const excluded = { ...candidate('dist/generated.ts'), generatedDecision: 'exclude' as const };
    const deleted = { ...candidate('src/deleted.ts'), status: 'deleted' as const };
    const missing = { ...candidate('src/missing.ts'), status: 'missing' as const };
    const blocked = { ...candidate('src/blocked.ts'), selection: 'blocked' as const };
    const binary = { ...candidate('assets/icon.bin'), fileType: 'bin' };
    const review = await buildLocalChangeReview([
      excluded, deleted, missing, blocked, binary,
      candidate('src/secret.ts'), candidate('src/debug.ts'), candidate('src/unreadable.ts'),
      { ...candidate('tests/unit/a.test.ts'), templateGroup: 'other' }
    ]);
    expect(review.findings.some((item) => item.category === 'generated')).toBe(true);
    expect(review.findings.some((item) => item.category === 'debug' && item.line === 2)).toBe(true);
    expect(review.warnings.some((item) => item.includes('截断'))).toBe(true);
    expect(review.privacy.files).toBeGreaterThan(0);
  });

  it('表达空范围、各影响区风险、删除观察点和三类测试建议', async () => {
    const empty = await buildLocalChangeReview([]);
    expect(empty.state).toBe('empty');
    const many = Array.from({ length: 8 }, (_, index) => candidate(`src/extension/f${index}.ts`));
    const impact = buildLocalImpactAnalysis([
      ...many,
      { ...candidate('src/webview/App.svelte'), status: 'missing' },
      candidate('tests/webview/App.spec.ts'),
      candidate('docs/guide.md'),
      candidate('root.json')
    ]);
    expect(impact.areas.find((item) => item.id === 'src/extension')?.risk).toBe('high');
    expect(impact.areas.find((item) => item.id === 'src/webview')?.title).toBe('Svelte Webview');
    expect(impact.areas.find((item) => item.id === 'tests')?.title).toBe('自动化测试');
    expect(impact.areas.find((item) => item.id === 'docs')?.title).toBe('产品与开发文档');
    expect(impact.tests.map((item) => item.command)).toEqual(expect.arrayContaining(['npm run check && npm run test:unit', 'npm run test:webview', 'npm run test:extension']));
    expect(impact.observations.some((item) => item.includes('包含删除项'))).toBe(true);
    expect(buildLocalImpactAnalysis([]).warnings).toHaveLength(1);
  });
});
