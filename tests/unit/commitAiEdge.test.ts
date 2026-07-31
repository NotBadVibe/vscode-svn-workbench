import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCommitMessageAiRequest,
  createMockCommitMessageResult,
  mergeCommitMessagePreservingUserContent,
  normalizeCommitMessageResult
} from '../../src/ai/commitMessageAiGenerator';
import {
  buildCommitSplitAiRequest,
  createLocalCommitSplitResult,
  normalizeCommitSplitResult,
  validateCommitSplitResult
} from '../../src/ai/commitSplitAi';
import type { CommitCandidate } from '../../src/commit/commitCandidateCollector';
import type { OperationScope } from '../../src/scope/operationScope';

const root = path.resolve('/repo');
const absolute = (relativePath: string) => path.resolve(root, relativePath);
const scope: OperationScope = {
  id: 'scope', repositoryRoot: root, source: 'workspace',
  roots: [{ absolutePath: root, relativePath: '.', kind: 'folder' }],
  allowExpandScope: false, includeExternals: false, includeNestedWorkingCopies: false, createdAt: 0
};
const candidate = (relativePath: string, overrides: Partial<CommitCandidate> = {}): CommitCandidate => ({
  absolutePath: absolute(relativePath), relativePath, status: 'modified', fileType: 'ts',
  templateGroup: 'frontend', generatedDecision: 'keep', selection: 'selected', reason: 'change', ...overrides
});
const convention = (overrides = {}) => ({
  enabled: true, requiredIssueId: false, issueIdPattern: '[A-Z]+-\\d+', requiredModule: true,
  allowedModules: ['order'], requiredPrefix: true, allowedPrefixes: ['feat'], hint: '', ...overrides
});

describe('提交说明 AI 边界', () => {
  it('仅携带用户允许的最多 20 条历史上下文', () => {
    const request = buildCommitMessageAiRequest(scope, [candidate('src/a.ts')], [absolute('src/a.ts')], [], {
      recentHistory: Array.from({ length: 25 }, (_, index) => ({ revision: String(index + 1), summary: `history ${index + 1}` }))
    });
    expect(request.recentHistory).toHaveLength(20);
    expect(request.recentHistory?.[0]).toEqual({ revision: '1', summary: 'history 1' });
  });

  it('限制 80 个文件、关联 Diff，并覆盖零选择与省略告警', () => {
    const candidates = Array.from({ length: 82 }, (_, index) => candidate(`src/f${index}.ts`));
    const request = buildCommitMessageAiRequest(scope, candidates, candidates.map((item) => item.absolutePath), [{
      absolutePath: candidates[0].absolutePath, relativePath: candidates[0].relativePath,
      addedLines: 2, deletedLines: 1, hunks: 1, binary: false, truncated: false, error: 'partial'
    }]);
    expect(request.files).toHaveLength(80);
    expect(request.omittedFileCount).toBe(2);
    expect(request.files[0].diff).toEqual(expect.objectContaining({ addedLines: 2, error: 'partial' }));
    expect(createMockCommitMessageResult(request).warnings[0]).toContain('前 80 个');
    expect(createMockCommitMessageResult({ ...request, selectedFileCount: 0, files: [] }).message).toBe('');
  });

  it('覆盖规范标题的前缀、模块、两者和无规范分支', () => {
    const base = buildCommitMessageAiRequest(scope, [candidate('src/order/a.ts')], [absolute('src/order/a.ts')]);
    expect(createMockCommitMessageResult(base).message).toMatch(/^变更：/);
    expect(createMockCommitMessageResult({ ...base, convention: convention() }).message).toMatch(/^feat\(order\):/);
    expect(createMockCommitMessageResult({ ...base, convention: convention({ requiredModule: false }) }).message).toMatch(/^feat:/);
    expect(createMockCommitMessageResult({ ...base, convention: convention({ requiredPrefix: false }) }).message).toMatch(/^变更\(order\)：/);
    const warnings = createMockCommitMessageResult({ ...base, convention: convention({ requiredIssueId: true, hint: '团队提示' }) }).warnings;
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('工单号'), '团队提示']));
  });

  it('补全所有模板字段且不覆盖用户内容，并规范化坏响应', () => {
    const request = buildCommitMessageAiRequest(scope, [candidate('config/a.json', { templateGroup: 'config' })], [absolute('config/a.json')], [], {
      mode: 'completeTemplate', currentMessage: '需求: 用户标题\n修复:\n范围:\n原因:\n影响:\n风险:\n自定义:\n无冒号行'
    });
    const message = createMockCommitMessageResult(request).message;
    expect(message).toContain('需求: 用户标题');
    expect(message).toContain('范围:.，1 个文件');
    expect(message).toContain('自定义:根据本次变更补充');
    expect(mergeCommitMessagePreservingUserContent('', ' generated ')).toBe('generated');
    expect(mergeCommitMessagePreservingUserContent('plain line', '字段: value')).toBe('plain line');
    expect(normalizeCommitMessageResult({ message: 1 as never, summary: ' a\n b ', warnings: [' ok ', 2 as never, ''] })).toEqual({ message: '', summary: 'a b', warnings: ['ok'] });
    expect(normalizeCommitMessageResult({}).summary).toContain('草稿');
  });
});

describe('提交拆分 AI 边界', () => {
  it('过滤 excluded/blocked、限制 120 个并按模块或模板拆分', () => {
    const candidates = [
      ...Array.from({ length: 121 }, (_, index) => candidate(`src/order/f${index}.ts`)),
      candidate('docs/a.md', { templateGroup: 'document', fileType: 'md' }),
      candidate('dist/a.js', { selection: 'excluded' }),
      candidate('src/blocked.ts', { selection: 'blocked' })
    ];
    const selected = candidates.map((item) => item.absolutePath);
    const request = buildCommitSplitAiRequest(scope, candidates, selected, { convention: convention() });
    expect(request.files).toHaveLength(120);
    expect(request.selectedFileCount).toBe(122);
    expect(createLocalCommitSplitResult(request).warnings.some((item) => item.includes('前 120'))).toBe(true);
    const byTemplate = buildCommitSplitAiRequest(scope, [candidate('root.ts'), candidate('guide.md', { templateGroup: 'document', fileType: 'md' })], [absolute('root.ts'), absolute('guide.md')]);
    expect(createLocalCommitSplitResult(byTemplate).splits).toHaveLength(2);
    expect(createLocalCommitSplitResult({ ...byTemplate, selectedFileCount: 0, files: [] }).warnings[0]).toContain('没有可拆分');
  });

  it('覆盖风险、规范回退、坏响应及重复/越界路径剔除', () => {
    const files = [
      candidate('src/order/missing.ts', { status: 'missing' }),
      candidate('src/order/new.zip', { status: 'unversioned', fileType: 'zip', templateGroup: 'asset' })
    ];
    const request = buildCommitSplitAiRequest(scope, files, files.map((item) => item.absolutePath), {
      convention: convention({ allowedPrefixes: ['fix'], allowedModules: ['other'] })
    });
    const local = createLocalCommitSplitResult(request);
    expect(local.splits.flatMap((item) => item.risks)).toHaveLength(3);
    expect(local.splits.every((item) => /^fix\(other\):/.test(item.message))).toBe(true);
    const normalized = normalizeCommitSplitResult({
      splits: [{ id: 1, title: 2, paths: [' a ', 3, ''], risks: 'bad' } as never, { paths: [] } as never],
      warnings: [' w ', 2 as never]
    });
    expect(normalized).toEqual(expect.objectContaining({ warnings: ['w'], splits: [expect.objectContaining({ title: '拆分建议', paths: ['a'] })] }));
    expect(normalizeCommitSplitResult({ splits: 'bad' as never, warnings: null as never })).toEqual({ splits: [], warnings: [] });
    const validated = validateCommitSplitResult(scope, {
      splits: [
        { id: '', title: 'a', summary: '', message: '', paths: ['src/a.ts', 'src/a.ts', '../outside'], reason: '', risks: [] },
        { id: 'b', title: 'b', summary: '', message: '', paths: [absolute('src/a.ts'), 'src/b.ts'], reason: '', risks: [] }
      ], warnings: []
    }, [absolute('src/a.ts'), absolute('src/b.ts')]);
    expect(validated.splits).toEqual([
      expect.objectContaining({ id: 'split-1', paths: [absolute('src/a.ts')] }),
      expect.objectContaining({ id: 'b', paths: [absolute('src/b.ts')] })
    ]);
  });
});
