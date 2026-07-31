import type { WorkbenchFileStatus, WorkbenchTaskId } from '@protocol/workbenchProtocol';

export const fileStatusLabels: Record<WorkbenchFileStatus, string> = {
  normal: '正常',
  modified: '已修改',
  added: '已新增',
  deleted: '已删除',
  missing: '文件缺失',
  unversioned: '未版本化',
  conflicted: '存在冲突',
  ignored: '已忽略',
  external: '外部工作副本',
  obstructed: '路径受阻',
  replaced: '已替换',
  incomplete: '状态不完整',
  unknown: '未知状态'
};

export const sourceLabels = {
  'local-rule': '本地规则',
  'configured-model': '已配置模型',
  'local-rule-fallback': '本地规则降级'
} as const;

export const confidenceLabels = {
  low: '低置信度',
  medium: '中置信度',
  high: '高置信度'
} as const;

export const riskLabels = {
  low: '低风险',
  medium: '中风险',
  high: '高风险'
} as const;

export const findingCategoryLabels = {
  security: '安全',
  debug: '调试残留',
  generated: '生成文件',
  quality: '代码质量',
  testing: '测试覆盖'
} as const;

export const taskLabels: Record<WorkbenchTaskId, string> = {
  'changes/overview': '工作副本修改',
  'commit/compose': '提交当前范围',
  'diff/working': '查看本地修改',
  'history/revisions': '查看历史记录',
  'conflicts/resolve': '处理文件冲突',
  'changelists/manage': '管理变更集',
  'ai-review/review': 'AI 变更审查',
  'impact/analyze': '分析影响与测试',
  'agent/plan': '受控 AI 任务代理',
  'repository/update': '更新当前范围',
  'repository/recovery': '清理与恢复工作副本',
  'repository/browse': '浏览 SVN 仓库',
  'repository/branch': '创建 SVN 分支',
  'repository/tag': '创建 SVN 标签',
  'repository/switch': '切换工作副本',
  'repository/relocate': '重定位仓库地址',
  'repository/merge': '合并到工作副本',
  'repository/patch-shelf': '补丁与本地搁置',
  'repository/release-notes': '生成发布说明',
  'repository/properties': '查看与编辑 SVN 属性',
  'settings/ai': 'AI 模型设置',
  'settings/team': '团队提交规范',
  'settings/svn': 'SVN 安全设置',
  'diagnostics/environment': '环境诊断',
  'diagnostics/acceptance': '验收清单'
};

export function fileStatusLabel(status: WorkbenchFileStatus): string {
  return fileStatusLabels[status];
}
