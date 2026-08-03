import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CommitCandidate } from "../commit/commitCandidateCollector";
import type {
  AiReviewSnapshot,
  ImpactSnapshot,
} from "../protocol/workbenchProtocol";

const MAX_FILE_CHARACTERS = 160_000;
const MAX_TOTAL_CHARACTERS = 2_000_000;
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".svelte",
  ".vue",
  ".py",
  ".java",
  ".cs",
  ".go",
  ".rs",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".css",
  ".scss",
  ".md",
  ".txt",
  ".env",
  ".properties",
]);

export async function buildLocalChangeReview(
  candidates: CommitCandidate[],
): Promise<AiReviewSnapshot> {
  const findings: AiReviewSnapshot["findings"] = [];
  const warnings: string[] = [];
  let characters = 0;
  let files = 0;

  for (const candidate of candidates) {
    if (
      candidate.status === "deleted" ||
      candidate.status === "missing" ||
      candidate.selection === "blocked"
    )
      continue;
    if (characters >= MAX_TOTAL_CHARACTERS) break;

    if (candidate.generatedDecision === "exclude") {
      findings.push(
        finding(
          candidate.relativePath,
          "warning",
          "generated",
          "检测到生成物或构建产物",
          "文件规则将其标记为默认排除。",
          "确认该文件是否应进入版本控制；若不需要，请补充 ignore 规则。",
          "high",
        ),
      );
    }

    const extension = path.extname(candidate.absolutePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    let text: string;
    try {
      const content = await fs.readFile(candidate.absolutePath, "utf8");
      text = content.slice(
        0,
        Math.min(MAX_FILE_CHARACTERS, MAX_TOTAL_CHARACTERS - characters),
      );
      if (content.length > text.length)
        warnings.push(`${candidate.relativePath} 内容已按隐私预算截断。`);
    } catch {
      continue;
    }
    characters += text.length;
    files += 1;
    scanSensitive(candidate.relativePath, text, findings);
    scanDebug(candidate.relativePath, text, findings);
  }

  const sourceChanges = candidates.filter((item) =>
    isSourceFile(item.relativePath),
  );
  const testChanges = candidates.filter((item) =>
    isTestFile(item.relativePath),
  );
  if (sourceChanges.length > 0 && testChanges.length === 0) {
    findings.push({
      id: "testing-no-related-change",
      severity: "note",
      category: "testing",
      title: "未检测到测试文件变更",
      evidence: `${sourceChanges.length} 个源代码文件发生变化，当前范围没有测试文件。`,
      recommendation: "根据影响分析补充或执行对应回归测试。",
      confidence: "medium",
    });
  }

  const summary = {
    critical: findings.filter((item) => item.severity === "critical").length,
    warning: findings.filter((item) => item.severity === "warning").length,
    note: findings.filter((item) => item.severity === "note").length,
  };
  return {
    kind: "ai-review",
    state: candidates.length === 0 ? "empty" : "ready",
    source: "local-rule",
    generatedAt: new Date().toISOString(),
    privacy: {
      files,
      characters,
      maxCharacters: MAX_TOTAL_CHARACTERS,
      historyIncluded: false,
      model: "本地规则引擎",
    },
    summary,
    findings,
    warnings,
  };
}

export function buildLocalImpactAnalysis(
  candidates: CommitCandidate[],
): ImpactSnapshot {
  const byArea = new Map<string, string[]>();
  for (const candidate of candidates) {
    const normalized = candidate.relativePath.replace(/\\/g, "/");
    const [first, second] = normalized.split("/");
    const area =
      first === "src" && second ? `src/${second}` : first || "repository-root";
    byArea.set(area, [...(byArea.get(area) ?? []), candidate.relativePath]);
  }
  const areas = [...byArea.entries()].map(([id, paths]) => ({
    id,
    title: humanizeArea(id),
    detail: `${paths.length} 个变更文件；${paths.slice(0, 3).join("、")}${paths.length > 3 ? " 等" : ""}`,
    paths,
    risk:
      paths.length >= 8
        ? ("high" as const)
        : paths.length >= 3
          ? ("medium" as const)
          : ("low" as const),
  }));
  const tests: ImpactSnapshot["tests"] = [];
  if (
    candidates.some((item) =>
      /package\.json$|\.svelte$|\.(ts|js)x?$/.test(item.relativePath),
    )
  ) {
    tests.push({
      title: "类型与组件回归",
      reason: "检测到 TypeScript / Svelte / JavaScript 变更。",
      command: "npm run check && npm run test:unit",
    });
  }
  if (
    candidates.some((item) =>
      /webview|\.svelte$|\.css$/.test(item.relativePath),
    )
  ) {
    tests.push({
      title: "Webview 浏览器验收",
      reason: "UI、样式或 Webview 逻辑发生变化。",
      command: "npm run test:webview",
    });
  }
  if (
    candidates.some((item) =>
      /svn|commit|conflict|update|extension/i.test(item.relativePath),
    )
  ) {
    tests.push({
      title: "真实 SVN 集成",
      reason: "SVN 命令、提交、冲突或扩展宿主链路可能受影响。",
      command: "npm run test:extension",
    });
  }
  return {
    kind: "impact",
    source: "local-rule",
    generatedAt: new Date().toISOString(),
    changedFiles: candidates.length,
    areas,
    tests,
    observations: [
      "发布前观察 Extension Host 输出中的 SVN 命令耗时与错误分类。",
      "UI 改动需抽查 Light、Dark、High Contrast 与 720px 窄宽度。",
      ...(candidates.some(
        (item) => item.status === "deleted" || item.status === "missing",
      )
        ? ["包含删除项，确认调用方、配置或文档没有残留引用。"]
        : []),
    ],
    warnings:
      candidates.length === 0 ? ["当前范围没有变更，无法生成影响分析。"] : [],
  };
}

function scanSensitive(
  relativePath: string,
  text: string,
  findings: AiReviewSnapshot["findings"],
): void {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\n]{8,}["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    findings.push({
      ...finding(
        relativePath,
        "critical",
        "security",
        "疑似敏感信息",
        "检测到疑似凭据或私钥，具体值已隐藏。",
        "从提交范围移除并轮换相关凭据；使用 SecretStorage 或环境变量。",
        "high",
      ),
      line: lineOf(text, match.index),
    });
    break;
  }
}

function scanDebug(
  relativePath: string,
  text: string,
  findings: AiReviewSnapshot["findings"],
): void {
  const pattern = /\bdebugger\s*;|console\.(?:log|debug)\s*\(/;
  const match = pattern.exec(text);
  if (!match) return;
  findings.push({
    ...finding(
      relativePath,
      "warning",
      "debug",
      "检测到调试代码",
      safeLine(text, match.index),
      "确认调试输出是否应保留；避免向扩展输出泄漏文件内容或凭据。",
      "high",
    ),
    line: lineOf(text, match.index),
  });
}

function finding(
  relativePath: string,
  severity: "critical" | "warning" | "note",
  category: AiReviewSnapshot["findings"][number]["category"],
  title: string,
  evidence: string,
  recommendation: string,
  confidence: "low" | "medium" | "high",
): AiReviewSnapshot["findings"][number] {
  return {
    id: `${category}:${relativePath}:${title}`,
    severity,
    category,
    relativePath,
    title,
    evidence,
    recommendation,
    confidence,
  };
}

function safeLine(text: string, index: number): string {
  const value = text
    .slice(
      text.lastIndexOf("\n", index - 1) + 1,
      text.indexOf("\n", index) < 0 ? text.length : text.indexOf("\n", index),
    )
    .trim();
  return value.slice(0, 140);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function isSourceFile(filePath: string): boolean {
  return (
    /\.(?:ts|tsx|js|jsx|svelte|vue|py|java|cs|go|rs)$/i.test(filePath) &&
    !isTestFile(filePath)
  );
}

function isTestFile(filePath: string): boolean {
  return /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(
    filePath.replace(/\\/g, "/"),
  );
}

function humanizeArea(area: string): string {
  if (area === "src/webview") return "Svelte Webview";
  if (area === "src/extension") return "Extension Host";
  if (area === "tests") return "自动化测试";
  if (area === "docs") return "产品与开发文档";
  return area;
}
