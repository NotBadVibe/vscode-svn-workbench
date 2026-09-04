/**
 * V017-C 中文 IME 组合中判定（唯一来源）。
 * - 候选阶段判定：`isComposing || keyCode === 229`（后者覆盖
 *   仅上报 keyCode 的输入法实现，平台无关）。
 * - 历史位置 `src/webview/i18n/keyboard.ts` 保留为兼容重导出；
 *   `features/conflicts/conflictShortcuts.ts` 的本地副本已合并到此。
 * - 所有 Enter/Esc 快捷键守卫必须复用本函数，不得另写
 *   `event.isComposing` 单条件判断。
 */
export function isImeComposing(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
): boolean {
  return event.isComposing || event.keyCode === 229;
}
