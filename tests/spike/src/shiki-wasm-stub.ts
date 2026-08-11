/*
 * "shiki/wasm" 按需裁剪桩：spike 与规划场景统一使用 JavaScript Regex 引擎
 * （@pierre/diffs 默认 preferredHighlighter: "shiki-js"），Oniguruma wasm
 * 分支不会执行。替换后产物不再携带 ~600KB 的 wasm chunk。
 */
throw new Error(
  "shiki/wasm 已在按需子集构建中裁剪；请使用 JavaScript Regex 引擎（默认）。",
);
