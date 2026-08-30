/**
 * 冲突结果编辑快捷键单一来源（V012-E）。
 * - 查找经 Editor keymap 绑定到内部命令 `openSearchPanel` 间接启用（Pierre 无程序化打开 API）。
 * - 替换（`openSearchReplacePanel`）已延期：输入框无 isComposing 保护 + 面板英文硬编码 UI + 只能 keymap 间接打开，不满足中文界面/IME 约束。
 * - 查找面板的英文 placeholder 为第三方库内部 UI，属已知限制，可接受但须如实说明。
 * - 编辑区 keydown 的 IME 守卫由适配层自实现。
 */

import type { EditorKeymap } from "@pierre/diffs/edit";

/** 快捷键定义（单一来源，按钮 title 与帮助面板共用） */
export const CONFLICT_SHORTCUTS = {
  undo: {
    id: "undo" as const,
    label: "撤销",
    display: "Ctrl/Cmd+Z",
    title: "撤销（Ctrl/Cmd+Z）",
    keys: ["Ctrl+Z", "Cmd+Z"] as const,
  },
  redo: {
    id: "redo" as const,
    label: "重做",
    display: "Ctrl/Cmd+Shift+Z / Ctrl+Y",
    title: "重做（Ctrl/Cmd+Shift+Z / Ctrl+Y）",
    keys: ["Ctrl+Shift+Z", "Cmd+Shift+Z", "Ctrl+Y"] as const,
  },
  find: {
    id: "find" as const,
    label: "查找",
    display: "Ctrl/Cmd+F",
    title: "查找（Ctrl/Cmd+F）",
    keys: ["Ctrl+F", "Cmd+F"] as const,
  },
  saveCheckpoint: {
    id: "saveCheckpoint" as const,
    label: "保存检查点",
    display: "Ctrl/Cmd+S",
    // 明确不写入工作副本（V012-E 3）
    title: "保存检查点（Ctrl/Cmd+S，不写入工作副本）",
    keys: ["Ctrl+S", "Cmd+S"] as const,
  },
  prevBlock: {
    id: "prevBlock" as const,
    label: "上一个块",
    display: "Alt+↑",
    title: "上一个块（Alt+↑）",
    keys: ["Alt+ArrowUp"] as const,
  },
  nextBlock: {
    id: "nextBlock" as const,
    label: "下一个块",
    display: "Alt+↓",
    title: "下一个块（Alt+↓）",
    keys: ["Alt+ArrowDown"] as const,
  },
  help: {
    id: "help" as const,
    label: "快捷键帮助",
    display: "?",
    title: "快捷键帮助（?）",
    keys: ["?"] as const,
  },
} as const;

export type ConflictShortcutId = keyof typeof CONFLICT_SHORTCUTS;

/** 列表形式，便于帮助面板遍历 */
export const CONFLICT_SHORTCUT_LIST = Object.values(CONFLICT_SHORTCUTS);

/** 替换延期结论（须在界面或文档中如实说明） */
export const REPLACE_DEFERRED_NOTE =
  "替换（replace）已延期：查找面板替换功能因输入框无 IME 保护、面板英文硬编码、仅能经 keymap 间接打开，不满足中文界面/IME 约束；查找面板的英文 placeholder 为第三方库内部 UI，属已知限制。";

/**
 * Pierre Editor 查找 keymap（V012-E）。
 * 通过 EditorOptions.keymap 注入 `openSearchPanel`，优雅降级：绑定失败不报错。
 * 仅交付查找，不交付 `openSearchReplacePanel`。
 */
export const CONFLICT_EDITOR_FIND_KEYMAP: EditorKeymap = [
  {
    bindings: {
      "cmdOrCtrl+f": "openSearchPanel",
    },
  },
] as EditorKeymap;

/** 中文 IME 组合中判定（与 src/webview/i18n/keyboard.ts 一致，本地轻量复用避免循环依赖） */
export function isImeComposingEvent(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
): boolean {
  return Boolean(event.isComposing || event.keyCode === 229);
}
