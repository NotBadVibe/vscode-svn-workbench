/**
 * V017-B 紧凑提示条会话记忆（仅内存，不过磁盘）。
 * - 首次轻提示可关闭；关闭状态只在当前会话内生效，
 *   会话结束（模块重载/窗口关闭）自动恢复。
 * - 不得写入 localStorage / SecretStorage / 磁盘文件。
 */

const dismissedKeys = new Set<string>();

/** 该区域提示条是否已在本次会话内忽略。 */
export function isHintDismissed(key: string): boolean {
  return dismissedKeys.has(key);
}

/** 忽略该区域提示条（仅本次会话）。 */
export function dismissHint(key: string): void {
  dismissedKeys.add(key);
}

/** 仅测试使用：清空会话记忆。 */
export function resetHintSession(): void {
  dismissedKeys.clear();
}
