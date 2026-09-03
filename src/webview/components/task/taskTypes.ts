/**
 * v0.1.5 V015-B：共享任务骨架组件的公共动作类型。
 *
 * - 结果 / 空态 / 错误态的动作只描述“显示什么、透传什么”，不持有 Host
 *   安全状态，不拼接协议 action 名称。
 * - `action` 为不透明标识，组件原样经 `onAction(action, data)` 透传给页面，
 *   由页面决定映射到哪个 Host 动作。
 */

/** 任务骨架通用动作（结果 / 空态 / 错误态共用形状）。 */
export interface TaskActionItem {
  /** 按钮显示文案（来自页面 props 或 terminology，不在组件内生造）。 */
  label: string;
  /** 不透明动作标识：组件只透传，不解释、不拼接。 */
  action: string;
  /** 透传给页面的附加数据。 */
  data?: Record<string, unknown>;
  /** 主次：每个组件最多 1 个 primary，其余为 secondary。 */
  kind?: "primary" | "secondary";
  /** 可选 codicon 类名后缀（如 `codicon-refresh`），纯装饰并 `aria-hidden`。 */
  icon?: string;
}

/** 主操作栏单个按钮（primary 与 secondary 同型）。 */
export interface TaskBarAction {
  /** 按钮显示文案，必须写明动作与对象（如“确认还原 3 个文件”）。 */
  label: string;
  /** 点击回调：由页面接线到预览 / 确认 / Host 动作。 */
  onClick: () => void;
  /** 禁用态（busy / stale 会强制禁用 primary，无需页面重复设置）。 */
  disabled?: boolean;
  /** 禁用原因：渲染为 `title`，读屏可经可访问名称获知。 */
  disabledReason?: string;
  /** 可选 codicon 类名后缀，纯装饰并 `aria-hidden`。 */
  icon?: string;
}
