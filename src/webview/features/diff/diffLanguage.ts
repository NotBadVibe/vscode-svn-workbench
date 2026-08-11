import type { SupportedLanguages } from "@pierre/diffs";

/*
 * Shiki 语言子集（v0.0.4 规划 §10 默认清单，阶段 0 Spike 已按此构建验证）：
 * ts/js、java、python、c/cpp、go、rust、xml、json、yaml、properties、shell、sql、diff。
 * 主构建通过 src/webview/vite.config.mts 的 resolve.alias 把 "shiki" 根模块
 * 替换为 vendor/shiki-subset-shim.ts，bundledLanguages 只注册下列 loader，
 * 语言 chunk 保持懒加载；清单变化时必须与 vendor shim 同步。
 */
export const DIFF_LANGUAGE_SUBSET = [
  "typescript",
  "javascript",
  "java",
  "python",
  "c",
  "cpp",
  "go",
  "rust",
  "xml",
  "json",
  "yaml",
  "properties",
  "shell",
  "sql",
  "diff",
] as const;

export type DiffSubsetLanguage = (typeof DIFF_LANGUAGE_SUBSET)[number];

const SUBSET = new Set<string>(DIFF_LANGUAGE_SUBSET);

/*
 * Host 端 inferLanguage 可能返回规范名（typescript）、别名（ts）或原始扩展名
 * （rs、sh、yml……）；统一归一到子集规范名，未覆盖的一律回退 "text"（纯文本，
 * 不做语法高亮），保证任何输入都能得到稳定渲染。
 */
const LANGUAGE_ALIASES: Record<string, DiffSubsetLanguage> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cc: "cpp",
  cxx: "cpp",
  rs: "rust",
  yml: "yaml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  patch: "diff",
};

function normalize(value: string | undefined): DiffSubsetLanguage | undefined {
  if (value == null) return undefined;
  const lowered = value.trim().toLowerCase();
  if (lowered === "") return undefined;
  if (SUBSET.has(lowered)) return lowered as DiffSubsetLanguage;
  return LANGUAGE_ALIASES[lowered];
}

/**
 * 把 DiffSnapshot.language（Host 推断）映射到 Shiki 子集语言；
 * language 无法映射时再用文件扩展名兜底，最终回退 "text"。
 */
export function mapToDiffLanguage(
  language: string,
  relativePath: string,
): SupportedLanguages {
  const fromLanguage = normalize(language);
  if (fromLanguage != null) return fromLanguage;
  const extension = relativePath.includes(".")
    ? relativePath.slice(relativePath.lastIndexOf(".") + 1)
    : "";
  const fromExtension = normalize(extension);
  return fromExtension ?? "text";
}
