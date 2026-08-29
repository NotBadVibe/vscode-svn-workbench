/*
 * v0.1.0（V010-E）Diff 渲染与编辑会话的结构化错误分类。
 *
 * 每种状态必须回答“发生了什么 / 可能原因 / 现在能做什么”，
 * 文案只在本文件维护，DiffView 适配层与 DiffModule 降级界面共用，
 * 不在页面各自拼字符串。
 */

export type DiffErrorKind =
  /** Pierre 实例创建或渲染失败。 */
  | "pierre-mount-failed"
  /** patch 解析为空或失败。 */
  | "patch-parse-empty"
  /** 语法高亮资源加载失败。 */
  | "highlight-load-failed"
  /** CSP/样式注入失败。 */
  | "csp-style-failed"
  /** Editor attach 失败。 */
  | "editor-attach-failed"
  /** 内容为二进制。 */
  | "content-binary"
  /** 内容被截断或超过大小上限。 */
  | "content-truncated"
  /** 无 BASE 可供比较。 */
  | "no-base"
  /** 非法编码。 */
  | "invalid-encoding"
  /** 文件/范围/revision 已过期。 */
  | "target-stale";

export interface DiffErrorInfo {
  readonly kind: DiffErrorKind;
  /** 发生了什么。 */
  readonly what: string;
  /** 可能原因。 */
  readonly cause: string;
  /** 现在能做什么。 */
  readonly recovery: string;
}

const DIFF_ERROR_TEXTS: Record<DiffErrorKind, Omit<DiffErrorInfo, "kind">> = {
  "pierre-mount-failed": {
    what: "差异视图渲染失败，已切换到简化视图。",
    cause: "差异组件在初始化或渲染时发生异常。",
    recovery: "可以点击“重试渲染”重新加载，或继续使用简化视图完成审阅。",
  },
  "patch-parse-empty": {
    what: "无法解析该修订比较的差异内容，已按原始文本显示。",
    cause: "差异内容为空，或不是可识别的统一差异格式。",
    recovery: "可以刷新状态后重试，或在编辑器中打开文件直接查看。",
  },
  "highlight-load-failed": {
    what: "语法高亮资源加载失败，已按纯文本渲染。",
    cause: "高亮语言资源加载超时或网络异常。",
    recovery: "可以点击“重试”重新加载高亮；不影响差异内容与编辑。",
  },
  "csp-style-failed": {
    what: "差异视图样式注入被安全策略拦截，已切换到简化视图。",
    cause: "Webview 内容安全策略阻止了组件的内联样式。",
    recovery: "可以点击“重试渲染”；若反复出现，请复制诊断信息并反馈。",
  },
  "editor-attach-failed": {
    what: "页内编辑器初始化失败，已回到只读审阅。",
    cause: "编辑会话附加到差异视图时发生异常。",
    recovery: "可以点击“页内编辑”重试；未保存的草稿仍保留在本窗口。",
  },
  "content-binary": {
    what: "二进制文件无法进行文本对比。",
    cause: "文件内容不是可解码的文本。",
    recovery: "可以在编辑器中打开文件，或查看 SVN 属性与历史。",
  },
  "content-truncated": {
    what: "文件过大，差异内容已被截断。",
    cause: "内容超过工作台的大小上限（5 MB）。",
    recovery: "可以使用“在编辑器中打开”查看完整文件。",
  },
  "no-base": {
    what: "没有可比较的 BASE 版本。",
    cause: "该文件是新增文件，或工作副本缺少 BASE 记录。",
    recovery: "可以在编辑器中打开文件查看当前内容。",
  },
  "invalid-encoding": {
    what: "文件编码不是有效的 UTF-8，无法进行文本对比。",
    cause: "文件使用了其他编码或包含非法字节序列。",
    recovery: "可以在编辑器中打开文件，或先转换编码后再查看差异。",
  },
  "target-stale": {
    what: "当前差异目标已过期。",
    cause: "文件、范围或修订版本在显示期间发生了变化。",
    recovery: "请刷新状态后重新打开差异。",
  },
};

export function diffErrorInfo(kind: DiffErrorKind): DiffErrorInfo {
  return { kind, ...DIFF_ERROR_TEXTS[kind] };
}

/** 适配层内部用于标记失败阶段的异常（message 保留原始原因供诊断）。 */
export class DiffStageError extends Error {
  readonly stage: "patch-parse" | "mount" | "editor-attach";
  constructor(
    stage: "patch-parse" | "mount" | "editor-attach",
    message: string,
    options?: { cause: unknown },
  ) {
    super(message, options);
    this.name = "DiffStageError";
    this.stage = stage;
  }
}

/**
 * 把适配层抛出的异常分类为结构化错误。
 * DiffStageError 按标记阶段精确分类；其余异常按信息启发式归类，
 * 默认归为 Pierre 挂载失败。
 */
export function classifyDiffRenderError(error: unknown): DiffErrorInfo {
  if (error instanceof DiffStageError) {
    switch (error.stage) {
      case "patch-parse":
        return diffErrorInfo("patch-parse-empty");
      case "editor-attach":
        return diffErrorInfo("editor-attach-failed");
      case "mount":
        return diffErrorInfo("pierre-mount-failed");
    }
  }
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  if (message.includes("style") || message.includes("csp")) {
    return diffErrorInfo("csp-style-failed");
  }
  return diffErrorInfo("pierre-mount-failed");
}
