/**
 * v0.1.6 V016-B：共享帮助组件族公共动作与回执显示类型。
 *
 * - 组件只表达状态与事件：回执 token 生成/绑定/一次性消费、scope/candidate/hash
 *   校验、stale 判定、模型调用、采用复验全部留在领域模块/Host，绝不进入组件。
 * - 动作只描述“显示什么、点击后通知谁”：`onSelect` 由页面传入，组件原样调用，
 *   不拼接协议 action 名，不扩大操作范围。
 * - `kind` 区分本地动作与模型动作：模型动作点击后才展示外发说明，本地动作
 *   不弹外发回执；`adopt` 标记采用类动作，`stale` 时禁用（旧结果只能查看）。
 */

/** 帮助动作归属：本地动作不外发，模型动作需经回执确认。 */
export type AssistanceActionKind = "local" | "model";

/** 共享帮助单个动作（本地/模型共用形状）。 */
export interface AssistanceActionItem {
  /** 按钮显示文案（来自页面 props 或 terminology，不在组件内生造）。 */
  label: string;
  /** 归属：`local` 直接执行本地逻辑，`model` 点击后先展示外发说明。 */
  kind: AssistanceActionKind;
  /** 是否为采用类动作：`stale` 时强制禁用，只能查看不能采用。 */
  adopt?: boolean;
  /** 可选补充说明（如“不会外发”“需确认后外发”）。 */
  hint?: string;
  /** 点击回调：由页面接线到本地规则或回执流程。 */
  onSelect: () => void;
  /** 禁用态（页面侧收紧；`stale + adopt` 由组件强制禁用）。 */
  disabled?: boolean;
  /** 禁用原因：渲染为 `title`，读屏可经可访问名称获知。 */
  disabledReason?: string;
  /** 可选 codicon 类名后缀（如 `codicon-sparkle`），纯装饰并 `aria-hidden`。 */
  icon?: string;
}

/** 帮助来源状态：与 `sourceLabels` 键一致，如实标注不伪装。 */
export type AssistanceSourceState =
  "local-rule" | "configured-model" | "local-rule-fallback" | "unconfigured";

/** 回执内单个文件预算行（纯展示，不含路径以外的可执行信息）。 */
export interface AssistanceReceiptFileView {
  /** 文件名（展示用，断言平台无关：只做字符串展示不拼接路径）。 */
  name: string;
  /** 该文件计入的字符数。 */
  characters: number;
  /** 是否因预算/读取原因被截断。 */
  truncated: boolean;
}

/** 回执展示数据（纯展示，不含 token；确认事件由页面携带 token）。 */
export interface AssistanceReceiptView {
  /** 模型名（未配置时缺省，组件不虚构）。 */
  model?: string;
  /** 数据类型说明（如“仅文件信息”“含差异”）。 */
  dataTypes: string;
  /** 范围说明（如“当前范围 3 个文件”）。 */
  scopeText: string;
  /** 预算说明（如“单文件 6000 字符，共 40000 字符”）。 */
  budgetText: string;
  /** 是否包含历史。 */
  historyIncluded: boolean;
  /** 附加回执说明（如不会发送项、保留策略提示）。 */
  receiptNote?: string;
  /** 包含/排除文件清单（可选）。 */
  files?: AssistanceReceiptFileView[];
  /** 确认按钮文案（如“开始模型生成”）。 */
  confirmLabel: string;
  /** 放弃按钮文案（缺省“放弃”）。 */
  cancelLabel?: string;
  /** 确认回调：由页面携带一次性 token 调用 Host。 */
  onConfirm: () => void;
  /** 放弃回调：由页面放弃回执，不外发。 */
  onDiscard: () => void;
}
