import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AiCommitConventionHint,
  AiTeamRulesRecommendation,
  AiTeamRulesRequest
} from './aiProvider';
import {
  buildCommitConventionHint,
  CommitConventionConfig,
  defaultCommitConventionConfig,
  mergeCommitConventionConfig,
  toAiCommitConventionHint,
  validateCommitConventionConfig
} from '../commit/commitConvention';

const MAX_DIRECTORIES = 160;
const MAX_SAMPLE_FILES = 120;
const MAX_SCAN_DEPTH = 4;

const IGNORED_DIRECTORIES = new Set([
  '.svn',
  '.git',
  '.idea',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'out',
  'bin',
  'obj',
  'coverage',
  'target',
  '.next',
  '.nuxt'
]);

const GENERIC_MODULE_NAMES = new Set([
  'src',
  'app',
  'apps',
  'packages',
  'pages',
  'views',
  'components',
  'common',
  'shared',
  'utils',
  'helpers',
  'services',
  'api',
  'apis',
  'assets',
  'public',
  'static',
  'styles',
  'tests',
  'test',
  '__tests__',
  'types',
  'models',
  'store',
  'stores'
]);

const RECOMMENDED_PREFIXES = ['feat', 'fix', 'config', 'docs', 'refactor', 'test', 'chore'];

export async function buildTeamRulesAiRequest(
  repositoryRoot: string,
  currentConvention: CommitConventionConfig
): Promise<AiTeamRulesRequest> {
  const scan = await scanRepository(repositoryRoot);
  return {
    repositoryName: path.basename(repositoryRoot),
    directories: scan.directories,
    sampleFiles: scan.sampleFiles,
    currentConvention: toAiCommitConventionHint(currentConvention),
    locale: 'zh-CN'
  };
}

export function createLocalTeamRulesRecommendation(request: AiTeamRulesRequest): AiTeamRulesRecommendation {
  const modules = inferModules(request);
  const config: CommitConventionConfig = mergeCommitConventionConfig(defaultCommitConventionConfig, {
    enabled: true,
    requiredPrefix: true,
    allowedPrefixes: inferPrefixes(request),
    requiredModule: true,
    allowedModules: modules.length > 0 ? modules : defaultCommitConventionConfig.allowedModules,
    requiredIssueId: true,
    issueIdPattern: request.currentConvention?.issueIdPattern || defaultCommitConventionConfig.issueIdPattern
  });
  const convention = toAiCommitConventionHint(config) ?? toAiCommitConventionHint({
    ...config,
    enabled: true
  });

  return {
    commitConvention: convention!,
    summary: `已根据 ${request.directories.length} 个目录和 ${request.sampleFiles.length} 个文件样本生成团队规则建议。`,
    reasons: [
      modules.length > 0
        ? `模块来自仓库目录结构：${modules.join(', ')}。`
        : '未识别到明显业务模块，使用默认模块列表。',
      '前缀采用常见研发团队提交类型，覆盖需求、修复、配置、文档、重构、测试和杂项。',
      '默认启用工单号校验，便于 SVN 提交与需求/缺陷系统关联。'
    ],
    warnings: [
      '这是规则建议，不会自动保存；请确认模块名符合团队习惯后再保存。',
      ...(modules.length === 0 ? ['仓库目录信号不足，建议人工补充模块。'] : [])
    ],
    confidence: modules.length >= 3 ? 'high' : modules.length > 0 ? 'medium' : 'low'
  };
}

export function normalizeTeamRulesRecommendation(value: Partial<AiTeamRulesRecommendation>): AiTeamRulesRecommendation {
  const fallback = createLocalTeamRulesRecommendation({
    repositoryName: 'repository',
    directories: [],
    sampleFiles: [],
    locale: 'zh-CN'
  });
  const rawConvention = value.commitConvention;
  const config: CommitConventionConfig = rawConvention
    ? mergeCommitConventionConfig(defaultCommitConventionConfig, {
      enabled: rawConvention.enabled,
      requiredIssueId: rawConvention.requiredIssueId,
      issueIdPattern: rawConvention.issueIdPattern,
      requiredModule: rawConvention.requiredModule,
      allowedModules: rawConvention.allowedModules,
      requiredPrefix: rawConvention.requiredPrefix,
      allowedPrefixes: rawConvention.allowedPrefixes
    })
    : aiConventionToConfig(fallback.commitConvention);

  const validation = validateCommitConventionConfig(config);
  const safeConfig = validation.valid ? config : aiConventionToConfig(fallback.commitConvention);
  const convention = toAiCommitConventionHint(safeConfig) ?? fallback.commitConvention;
  convention.hint = rawConvention?.hint?.trim() || buildCommitConventionHint(safeConfig);

  return {
    commitConvention: convention,
    summary: sanitizeText(value.summary) || fallback.summary,
    reasons: sanitizeStringArray(value.reasons).slice(0, 8),
    warnings: [
      ...sanitizeStringArray(value.warnings).slice(0, 8),
      ...validation.issues.map((issue) => `AI 返回的规则已被本地校验修正：${issue}`)
    ],
    confidence: value.confidence === 'high' || value.confidence === 'medium' || value.confidence === 'low'
      ? value.confidence
      : 'medium'
  };
}

function aiConventionToConfig(value: AiCommitConventionHint): CommitConventionConfig {
  return {
    enabled: value.enabled,
    requiredIssueId: value.requiredIssueId,
    issueIdPattern: value.issueIdPattern,
    requiredModule: value.requiredModule,
    allowedModules: value.allowedModules,
    requiredPrefix: value.requiredPrefix,
    allowedPrefixes: value.allowedPrefixes
  };
}

async function scanRepository(repositoryRoot: string): Promise<{ directories: string[]; sampleFiles: string[] }> {
  const directories: string[] = [];
  const sampleFiles: string[] = [];

  async function visit(current: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || directories.length >= MAX_DIRECTORIES || sampleFiles.length >= MAX_SAMPLE_FILES) {
      return;
    }

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      const relativePath = toPosixRelative(repositoryRoot, fullPath);
      if (entry.isDirectory()) {
        directories.push(relativePath);
        await visit(fullPath, depth + 1);
      } else if (entry.isFile() && sampleFiles.length < MAX_SAMPLE_FILES) {
        sampleFiles.push(relativePath);
      }

      if (directories.length >= MAX_DIRECTORIES && sampleFiles.length >= MAX_SAMPLE_FILES) {
        break;
      }
    }
  }

  await visit(repositoryRoot, 1);
  return {
    directories,
    sampleFiles
  };
}

function inferModules(request: AiTeamRulesRequest): string[] {
  const scores = new Map<string, number>();
  for (const directory of request.directories) {
    const parts = directory.split('/').filter(Boolean);
    for (const part of parts) {
      addModuleScore(scores, part, scoreDirectoryPart(parts, part));
    }
  }

  for (const file of request.sampleFiles) {
    const parts = file.split('/').filter(Boolean);
    for (const part of parts.slice(0, -1)) {
      addModuleScore(scores, part, 1);
    }
  }

  return Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([moduleName]) => moduleName)
    .slice(0, 8);
}

function inferPrefixes(request: AiTeamRulesRequest): string[] {
  const prefixes = new Set(RECOMMENDED_PREFIXES);
  if (!hasPathSignal(request, /docs?|readme|md$/i)) {
    prefixes.delete('docs');
  }
  if (!hasPathSignal(request, /config|conf|settings|json|ya?ml|properties/i)) {
    prefixes.delete('config');
  }
  if (!hasPathSignal(request, /test|spec|__tests__/i)) {
    prefixes.delete('test');
  }

  return Array.from(prefixes);
}

function hasPathSignal(request: AiTeamRulesRequest, pattern: RegExp): boolean {
  return [...request.directories, ...request.sampleFiles].some((item) => pattern.test(item));
}

function addModuleScore(scores: Map<string, number>, value: string, score: number): void {
  const normalized = normalizeModuleName(value);
  if (!normalized || GENERIC_MODULE_NAMES.has(normalized)) {
    return;
  }
  scores.set(normalized, (scores.get(normalized) ?? 0) + score);
}

function scoreDirectoryPart(parts: string[], part: string): number {
  const normalized = normalizeModuleName(part);
  if (normalized === 'config' || normalized === 'docs') {
    return 6;
  }
  if (parts.includes('pages') || parts.includes('views') || parts.includes('modules')) {
    return 5;
  }
  return Math.max(1, 5 - parts.length);
}

function normalizeModuleName(value: string): string {
  const normalized = value.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!normalized || normalized.length > 32 || /^\d+$/.test(normalized)) {
    return '';
  }
  return normalized;
}

function toPosixRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

function sanitizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}
