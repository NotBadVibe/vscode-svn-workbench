/**
 * v0.0.12 批次 C：冲突意图解释（纯逻辑）。
 *
 * 规划 §7 输出六段：我的修改意图 / 对方修改意图 / 共同点和冲突点 /
 * 推荐处理方式及证据 / 无法判断的业务选择 / 保存后验证。复用动作级回执
 * 与受限文本预算（buildConflictAiRequest 的逐文件预算）；结果只辅助用户
 * 编辑工作副本，保存与 Resolve 仍走既有 token/预览/确认契约。
 */

import { SvnConflictItem } from "../conflict/conflictCollector";
import {
  AiConflictAdvice,
  AiConflictRecommendation,
  AiConflictRequest,
} from "./aiProvider";
import {
  buildConflictAiRequest,
  createMockConflictAdvice,
} from "./conflictAiAdvisor";

/** v0.0.12 批次 C：冲突意图解释六段结构。 */
export interface AiConflictInterpretation {
  /** 1. 我的修改意图。 */
  myIntent: string;
  /** 2. 对方修改意图。 */
  theirIntent: string;
  /** 3. 共同点和冲突点。 */
  commonPoints: string[];
  conflictPoints: string[];
  /** 4. 推荐处理方式及对应证据（证据为工作副本内路径/修订，纯展示）。 */
  recommendedHandling: {
    summary: string;
    recommendation: AiConflictRecommendation;
    evidence: string[];
  };
  /** 5. 无法判断的业务选择（须如实列出，不得编造）。 */
  businessUnknowns: string[];
  /** 6. 保存后应运行的验证（命令仅建议，不执行）。 */
  postSaveVerification: Array<{ title: string; command?: string }>;
  warnings: string[];
}

/** 构建冲突意图解释请求（复用 buildConflictAiRequest 的受限文本预算）。 */
export function buildConflictInterpretationRequest(
  item: SvnConflictItem,
  maxCharsPerFile = 8000,
): Promise<AiConflictRequest> {
  return buildConflictAiRequest(item, maxCharsPerFile);
}

/** 本地回退：如实声明本地无法判断双方业务意图，并把未知项列入待确认。 */
export function createLocalConflictInterpretation(
  request: AiConflictRequest,
): AiConflictInterpretation {
  const advice = createMockConflictAdvice(request);
  const working = request.contents.working?.content ?? "";
  const hasMarkers = containsSvnConflictMarkers(working);
  const conflictPoints = [
    hasMarkers
      ? "工作副本文件仍包含 SVN 冲突标记（<<<<<<< / ======= / >>>>>>>）。"
      : "工作副本文件已不包含 SVN 冲突标记，但本地规则无法判断业务语义是否完整。",
    ...advice.risks,
  ];
  return {
    myIntent: "本地检查无法读取双方业务意图，需要你确认“我的版本”的改动目的。",
    theirIntent:
      "本地检查无法读取对方业务意图，需要结合修订对比确认对方改动目的。",
    commonPoints: [
      advice.recommendation === "acceptWorking" &&
      advice.confidence === "high" &&
      normalizeText(request.contents.mine?.content ?? "") ===
        normalizeText(request.contents.theirs?.content ?? "")
        ? "我的版本与对方版本内容一致。"
        : "当前仅能确认冲突两侧均在相同文件区域内修改（共同修改点）。",
    ],
    conflictPoints,
    recommendedHandling: {
      summary: advice.summary,
      recommendation: advice.recommendation,
      evidence: advice.steps,
    },
    businessUnknowns: [
      "双方业务意图（本地规则无法判断）。",
      "哪一侧修改更符合当前需求（需人工或外部业务判断）。",
      ...(hasMarkers ? [] : ["合并后是否需要保留本地额外改动。"]),
    ],
    postSaveVerification: advice.steps.map((step, index) => ({
      title: `保存后验证 ${index + 1}：${step}`,
    })),
    warnings: ["模型不可用，已使用本地规则；来源如实标记为本地回退。"],
  };
}

/** 严格规范化：畸形字段丢弃；推荐方式必须是合法枚举。 */
export function normalizeConflictInterpretation(
  value: Partial<AiConflictInterpretation>,
): AiConflictInterpretation {
  const warnings = Array.isArray(value.warnings)
    ? value.warnings
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const recommendations: AiConflictRecommendation[] = [
    "acceptWorking",
    "acceptMine",
    "acceptTheirs",
    "manualMerge",
    "noSafeSuggestion",
  ];
  const rawHandling = value.recommendedHandling;
  const handling =
    typeof rawHandling === "object" && rawHandling !== null
      ? (rawHandling as Record<string, unknown>)
      : undefined;
  const rawRecommendation = handling?.recommendation;
  const recommendation = recommendations.includes(
    rawRecommendation as AiConflictRecommendation,
  )
    ? (rawRecommendation as AiConflictRecommendation)
    : "manualMerge";
  return {
    myIntent: stringOf(value.myIntent),
    theirIntent: stringOf(value.theirIntent),
    commonPoints: stringsOf(value.commonPoints),
    conflictPoints: stringsOf(value.conflictPoints),
    recommendedHandling: {
      summary: stringOf(handling?.summary),
      recommendation,
      evidence: stringsOf(handling?.evidence),
    },
    businessUnknowns: stringsOf(value.businessUnknowns),
    postSaveVerification: Array.isArray(value.postSaveVerification)
      ? value.postSaveVerification
          .map((item) => {
            const raw = item as Record<string, unknown> | undefined;
            if (!raw || typeof raw.title !== "string") return undefined;
            return {
              title: raw.title.trim(),
              ...(typeof raw.command === "string" && raw.command.trim()
                ? { command: raw.command.trim() }
                : {}),
            };
          })
          .filter(
            (item): item is { title: string; command?: string } =>
              item !== undefined && item.title.length > 0,
          )
      : [],
    warnings,
  };
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function containsSvnConflictMarkers(content: string): boolean {
  return (
    content.includes("<<<<<<<") ||
    content.includes("=======") ||
    content.includes(">>>>>>>")
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export type { AiConflictAdvice };
