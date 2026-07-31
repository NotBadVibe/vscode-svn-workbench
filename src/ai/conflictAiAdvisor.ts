import * as fs from 'node:fs/promises';
import { SvnConflictItem } from '../conflict/conflictCollector';
import {
  AiConflictAdvice,
  AiConflictFileContent,
  AiConflictRecommendation,
  AiConflictRequest,
  AiConfidence
} from './aiProvider';

const DEFAULT_MAX_CHARS_PER_FILE = 8000;
const RECOMMENDATIONS: AiConflictRecommendation[] = [
  'acceptWorking',
  'acceptMine',
  'acceptTheirs',
  'manualMerge',
  'noSafeSuggestion'
];
const CONFIDENCES: AiConfidence[] = ['low', 'medium', 'high'];

export async function buildConflictAiRequest(
  item: SvnConflictItem,
  maxCharsPerFile = DEFAULT_MAX_CHARS_PER_FILE
): Promise<AiConflictRequest> {
  return {
    relativePath: item.relativePath,
    operation: item.operation,
    type: item.type,
    sourceLeftRevision: item.sourceLeftRevision,
    sourceRightRevision: item.sourceRightRevision,
    contents: {
      base: await readConflictFile(item.baseFile, maxCharsPerFile),
      mine: await readConflictFile(item.mineFile, maxCharsPerFile),
      theirs: await readConflictFile(item.theirsFile, maxCharsPerFile),
      working: await readConflictFile(item.workingFile, maxCharsPerFile)
    }
  };
}

export function createMockConflictAdvice(request: AiConflictRequest): AiConflictAdvice {
  const working = request.contents.working?.content ?? '';
  const mine = request.contents.mine?.content;
  const theirs = request.contents.theirs?.content;

  if (containsSvnConflictMarkers(working)) {
    return {
      recommendation: 'manualMerge',
      confidence: 'low',
      summary: '工作副本文件仍包含 SVN 冲突标记，当前不能安全自动选择某一侧。',
      risks: [
        '直接标记已解决会把冲突标记提交到仓库。',
        '需要人工确认业务语义后再保存工作副本内容。'
      ],
      steps: [
        '先打开“我的版本 ↔ 对方版本”或“对方版本 ↔ 工作副本”对比。',
        '整理工作副本文件，删除 <<<<<<<、=======、>>>>>>> 标记。',
        '确认编译或关键逻辑后，再执行标记已解决。'
      ]
    };
  }

  if (mine && theirs && normalizeText(mine) === normalizeText(theirs)) {
    return {
      recommendation: 'acceptWorking',
      confidence: 'high',
      summary: '我的版本与对方版本内容一致，工作副本内容可作为解决结果继续确认。',
      risks: ['仍建议检查工作副本是否包含本地额外改动。'],
      steps: ['打开工作副本内容核对。', '确认无误后标记已解决。']
    };
  }

  if (working.trim().length > 0) {
    return {
      recommendation: 'acceptWorking',
      confidence: 'medium',
      summary: '工作副本文件已经不包含 SVN 冲突标记，可作为候选解决结果。',
      risks: ['本地规则无法判断业务语义是否完整。'],
      steps: ['查看“对方版本 ↔ 工作副本”对比。', '确认业务逻辑后标记已解决。']
    };
  }

  return {
    recommendation: 'noSafeSuggestion',
    confidence: 'low',
    summary: '缺少足够文本内容，无法给出安全建议。',
    risks: ['可能是二进制文件、读取失败或内容被截断。'],
    steps: ['手动打开相关文件检查。', '必要时使用 SVN CLI 或外部工具解决。']
  };
}

export function normalizeConflictAdvice(value: Partial<AiConflictAdvice>): AiConflictAdvice {
  const recommendation = RECOMMENDATIONS.includes(value.recommendation as AiConflictRecommendation)
    ? value.recommendation as AiConflictRecommendation
    : 'noSafeSuggestion';
  const confidence = CONFIDENCES.includes(value.confidence as AiConfidence)
    ? value.confidence as AiConfidence
    : 'low';

  return {
    recommendation,
    confidence,
    summary: toSingleLine(value.summary) || 'AI 未返回明确摘要。',
    risks: toStringList(value.risks),
    steps: toStringList(value.steps)
  };
}

export function containsSvnConflictMarkers(content: string): boolean {
  return /^<{7}/m.test(content) && /^={7}$/m.test(content) && /^>{7}/m.test(content);
}

async function readConflictFile(
  filePath: string | undefined,
  maxChars: number
): Promise<AiConflictFileContent | undefined> {
  if (!filePath) {
    return undefined;
  }

  try {
    const buffer = await fs.readFile(filePath);
    if (buffer.includes(0)) {
      return {
        path: filePath,
        truncated: false,
        readError: 'binary-or-null-byte-content'
      };
    }

    const content = buffer.toString('utf8');
    return {
      path: filePath,
      content: content.length > maxChars ? content.slice(0, maxChars) : content,
      truncated: content.length > maxChars
    };
  } catch (error) {
    return {
      path: filePath,
      truncated: false,
      readError: error instanceof Error ? error.message : String(error)
    };
  }
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => toSingleLine(item)).filter((item) => item.length > 0);
}

function toSingleLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}
