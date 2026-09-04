// 中文注释：V017-C 收敛——唯一实现迁入 `src/webview/keyboard/ime.ts`，
// 此处保留兼容重导出，调用方无需改动导入路径。
export { isImeComposing } from "../keyboard/ime";
import { isImeComposing } from "../keyboard/ime";

export function isExplicitSubmitShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "isComposing" | "keyCode"
  >,
): boolean {
  return (
    !isImeComposing(event) &&
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey)
  );
}
