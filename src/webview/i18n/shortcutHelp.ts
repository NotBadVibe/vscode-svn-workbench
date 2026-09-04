/**
 * V017-B 上下文快捷帮助中文文案（i18n 收口）。
 * - 区域标题、触发按钮、关闭/忽略动作与提示条说明收口此处，
 *   组件内不得另写同义文案。
 * - 按键本身（label/display/title）以 `src/webview/keyboard/shortcuts.ts`
 *   集中 keymap 为单一来源，此处不复制。
 */

import type { ShortcutRegion } from "../keyboard/shortcuts";

/** 区域帮助标题（`?` 面板只显示当前区域绑定）。 */
export const shortcutHelpRegionTitles: Record<ShortcutRegion, string> = {
  list: "列表快捷键",
  search: "搜索快捷键",
  commitMessage: "提交说明快捷键",
  filterPreset: "筛选预设快捷键",
  diff: "差异快捷键",
  conflicts: "冲突快捷键",
  dialog: "对话框快捷键",
};

/** 帮助触发与面板通用文案。 */
export const shortcutHelpLabels = {
  /** `?` 触发按钮可见文本。 */
  trigger: "?",
  /** 触发按钮无障碍名称（含按键，hover 与 focus 双通道可感知）。 */
  triggerName: "快捷键帮助（?）",
  close: "关闭",
  /** 紧凑提示条忽略按钮（仅会话内记忆，不持久化到磁盘）。 */
  dismissHint: "不再提示",
  dismissHintName: "不再显示本区域键盘提示（仅本次会话）",
  /** 紧凑提示条补充说明：触摸/鼠标用户可忽略。 */
  hintNote: "键盘提示，可忽略，不影响鼠标与触摸操作",
  hintRegion: "键盘提示",
} as const;

/** 替换延期的如实说明（原冲突帮助单一来源文案，收口至 i18n）。 */
export const replaceDeferredNote =
  "替换（replace）已延期：查找面板替换功能因输入框无 IME 保护、面板英文硬编码、仅能经 keymap 间接打开，不满足中文界面/IME 约束；查找面板的英文 placeholder 为第三方库内部 UI，属已知限制。";

/** 提交说明编辑区快捷键说明（与 keymap `commitMessage/preview` 同义）。 */
export const commitMessageShortcutHint = "按 Ctrl/⌘ + Enter 生成提交预览";
