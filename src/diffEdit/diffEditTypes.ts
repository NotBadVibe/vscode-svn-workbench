/**
 * v0.0.6 页内编辑的 Host 领域类型（不依赖 vscode API，可单测）。
 *
 * Webview 只提交 Host 签发的不透明 targetId + 单次 editToken + 递增
 * draftRevision + expectedContentHash + content；绝不提交可写绝对路径。
 */

/** 保存被拒绝的结构化原因（协议 §7）。 */
export type DiffSaveRejectReason =
  | "tokenExpired"
  | "scopeChanged"
  | "diskChanged"
  | "documentDirty"
  | "targetMoved"
  | "tooLarge"
  | "unsupportedEncoding"
  | "writeFailed";

export interface DiffEditTargetContext {
  /** 规范化后的目标绝对路径（realpath 解析，位于工作副本与 scope 内）。 */
  absolutePath: string;
  /** BASE 内容（svn cat -r BASE），用于展示与绑定。 */
  baseContents: string;
  baseRevision: string;
  baseHash: string;
  /** 磁盘原始完整字节 hash（编辑打开与每次保存前复验）。 */
  rawHash: string;
  /** Working Copy 当前内容（编辑器文本模型：剥离 BOM、统一 \n）。 */
  workingContents: string;
  isRegularFile: boolean;
  sizeBytes: number;
}

export interface OpenDiffEditInput {
  repositoryRoot: string;
  repositoryUuid: string;
  scopeHash: string;
  sessionId: string;
  targetPath: string;
  baseContents: string;
  baseRevision: string;
  baseHash: string;
  rawHash: string;
  /**
   * Host 注入的 SVN 绑定探测（svn info/cat）：打开与每次保存复验仓库
   * UUID、工作副本归属（拒绝 external/嵌套 WC）与当前 BASE hash。
   */
  probeSvnBinding?: (targetPath: string) => Promise<DiffSvnBindingProbeResult>;
}

/** Host 侧 SVN 绑定探测结果（svn info --show-item + svn cat -r BASE）。 */
export interface DiffSvnBindingProbe {
  ok: true;
  /** 目标当前所属仓库 UUID。 */
  repositoryUuid: string;
  /** 目标所属工作副本根（嵌套 WC / external 与原主 WC 不同）。 */
  workingCopyRoot: string;
  /** 当前 BASE 完整字节 hash。 */
  baseHash: string;
  /** 目标是 svn:externals 文件引用（同仓库 file external 的唯一可靠标记）。 */
  fileExternal: boolean;
}

export type DiffSvnBindingProbeResult =
  DiffSvnBindingProbe | { ok: false; code: "noSvnInfo" | "noBase" };

export interface DiffSaveWorkingInput {
  sessionId: string;
  moduleId: "diff";
  taskId: "diff/working";
  repositoryUuid: string;
  scopeHash: string;
  targetId: string;
  editToken: string;
  draftRevision: number;
  expectedContentHash: string;
  content: string;
  /** 保存前复验 UUID/归属/BASE（Host 注入；见 OpenDiffEditInput）。 */
  probeSvnBinding?: (targetPath: string) => Promise<DiffSvnBindingProbeResult>;
}

export interface DiffSaveAcceptedResult {
  ok: true;
  acceptedRevision: number;
  newContentHash: string;
  newEditToken: string;
  snapshotVersion: number;
}

export interface DiffSaveRejectedResult {
  ok: false;
  reason: DiffSaveRejectReason;
  /** 中文说明（发生了什么 → 可能原因 → 恢复动作）。 */
  message: string;
  recoverable: boolean;
  /** 保存失败时草稿保留；客户端用其恢复。 */
  draftRevision?: number;
}

export type DiffSaveWorkingResult =
  DiffSaveAcceptedResult | DiffSaveRejectedResult;

/** 保存前 Host 对磁盘现状的复验结果。 */
export interface DiffTargetFreshness {
  /** 目标是否仍存在。 */
  exists: boolean;
  /** 是否仍为普通文件（非 symlink/junction/目录/设备）。 */
  isRegularFile: boolean;
  /** 解析后路径（检测目标移动/换链）。 */
  realPath: string;
  /** 当前磁盘原始字节 hash。 */
  rawHash: string;
  /** 当前字节数。 */
  sizeBytes: number;
}
