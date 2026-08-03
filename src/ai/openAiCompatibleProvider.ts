import {
  AiCommitSplitRequest,
  AiCommitSplitResult,
  AiCommitMessageRequest,
  AiCommitMessageResult,
  AiConflictAdvice,
  AiConflictRequest,
  AiModelInfo,
  AiProvider,
  AiProviderConfig,
  AiSelectionRequest,
  AiSelectionResult,
  AiTeamRulesRecommendation,
  AiTeamRulesRequest,
} from "./aiProvider";
import { normalizeCommitMessageResult } from "./commitMessageAiGenerator";
import { normalizeCommitSplitResult } from "./commitSplitAi";
import { normalizeConflictAdvice } from "./conflictAiAdvisor";
import { normalizeAiSelectionResult } from "./aiResultValidator";
import { normalizeTeamRulesRecommendation } from "./teamRulesAiRecommender";

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly config: AiProviderConfig) {}

  async testConnection(): Promise<void> {
    await this.complete('Reply with JSON: {"ok":true}');
  }

  async listModels(): Promise<AiModelInfo[]> {
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/models`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `读取 AI 模型列表失败：${response.status} ${response.statusText}`,
      );
    }

    return parseModelListResponse(await response.json());
  }

  async selectFiles(request: AiSelectionRequest): Promise<AiSelectionResult> {
    const content = [
      "You are helping select SVN commit files for a Chinese software team.",
      "Only choose from the provided files array. Do not invent paths.",
      "Return the exact path value from each chosen file item.",
      "Respect generatedDecision and defaultSelection. Generated files should usually be excluded unless clearly intentional.",
      "Return strict JSON with keys recommended, excluded, needsReview, blocked.",
      "Each item must contain path and reason.",
      JSON.stringify(request),
    ].join("\n\n");
    const text = await this.complete(content);
    return parseJsonResult(text);
  }

  async generateCommitMessage(
    request: AiCommitMessageRequest,
  ): Promise<AiCommitMessageResult> {
    const content = [
      "You are helping generate a concise SVN commit message for a Chinese software team.",
      "Use Simplified Chinese. Do not invent changes beyond the provided file metadata.",
      "Diff fields are lightweight statistics only: added lines, deleted lines, hunks, binary and truncation flags.",
      "If mode is completeTemplate, preserve all non-empty user-written fields in currentMessage and only fill empty fields.",
      "If convention is provided, follow it. Do not invent a real issue id; ask the user to fill it when it is required but absent.",
      "recentHistory, when present, contains user-approved sanitized commit summaries. Use it only as wording/style context, never as evidence of the current change.",
      "Return strict JSON only with keys message, summary, warnings.",
      "message should be ready to paste into svn commit and may use multiple lines.",
      JSON.stringify(request),
    ].join("\n\n");
    const text = await this.complete(content);
    return normalizeCommitMessageResult(
      parseJsonObject(text) as Partial<AiCommitMessageResult>,
    );
  }

  async suggestCommitSplits(
    request: AiCommitSplitRequest,
  ): Promise<AiCommitSplitResult> {
    const content = [
      "You are helping split SVN changes into smaller commits for a Chinese software team.",
      "Use Simplified Chinese. Only use paths from the provided files array. Do not invent paths.",
      "Each split should be independently commit-worthy and should avoid mixing unrelated business modules.",
      "Do not suggest committing generated or blocked files unless they are explicitly present in the provided files.",
      "The user makes the final decision and no commit will be executed automatically.",
      "Return strict JSON only with keys splits and warnings.",
      "Each split must contain id, title, summary, message, paths, reason, risks.",
      "message should be ready to paste into svn commit.",
      JSON.stringify(request),
    ].join("\n\n");
    const text = await this.complete(content);
    return normalizeCommitSplitResult(
      parseJsonObject(text) as Partial<AiCommitSplitResult>,
    );
  }

  async recommendTeamRules(
    request: AiTeamRulesRequest,
  ): Promise<AiTeamRulesRecommendation> {
    const content = [
      "You are helping configure SVN team commit rules for a Chinese software team.",
      "Use repository directories and sample files to recommend practical commitConvention settings.",
      "Do not invent business modules that are not supported by directory or file evidence.",
      "Return strict JSON only with keys commitConvention, summary, reasons, warnings, confidence.",
      "commitConvention must contain enabled, requiredIssueId, issueIdPattern, requiredModule, allowedModules, requiredPrefix, allowedPrefixes, hint.",
      "Use confidence low, medium, or high.",
      JSON.stringify(request),
    ].join("\n\n");
    const text = await this.complete(content);
    return normalizeTeamRulesRecommendation(
      parseJsonObject(text) as Partial<AiTeamRulesRecommendation>,
    );
  }

  async adviseConflict(request: AiConflictRequest): Promise<AiConflictAdvice> {
    const content = [
      "You are helping a developer decide how to resolve an SVN text conflict.",
      "Do not modify files. Do not invent unseen code. The user will make the final decision.",
      "Return strict JSON only with keys recommendation, confidence, summary, risks, steps.",
      "recommendation must be one of acceptWorking, acceptMine, acceptTheirs, manualMerge, noSafeSuggestion.",
      "confidence must be low, medium, or high.",
      JSON.stringify(request),
    ].join("\n\n");
    const text = await this.complete(content);
    return normalizeConflictAdvice(
      parseJsonObject(text) as Partial<AiConflictAdvice>,
    );
  }

  private async complete(content: string): Promise<string> {
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: "user", content }],
          temperature: 0.1,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`AI 请求失败：${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("AI 响应中没有消息正文。");
    }
    return text;
  }
}

export function parseModelListResponse(data: unknown): AiModelInfo[] {
  const value = data as { data?: Array<{ id?: unknown; owner?: unknown }> };
  if (!Array.isArray(value.data)) {
    return [];
  }

  return value.data
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      owner: typeof item.owner === "string" ? item.owner : undefined,
    }))
    .filter((item) => item.id.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function parseJsonResult(text: string): AiSelectionResult {
  return normalizeAiSelectionResult(
    parseJsonObject(text) as Partial<AiSelectionResult>,
  );
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim()
    : trimmed;
  return JSON.parse(jsonText);
}
