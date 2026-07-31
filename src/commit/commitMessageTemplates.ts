export interface CommitMessageTemplate {
  id: string;
  label: string;
  body: string;
}

export interface CommitMessageValidation {
  valid: boolean;
  issues: string[];
}

export const defaultCommitMessageTemplates: CommitMessageTemplate[] = [
  {
    id: 'feature',
    label: '需求开发',
    body: '需求: \n\n范围: \n影响: '
  },
  {
    id: 'bugfix',
    label: '问题修复',
    body: '修复: \n\n原因: \n影响: '
  },
  {
    id: 'config',
    label: '配置调整',
    body: '配置: \n\n原因: \n影响: '
  },
  {
    id: 'docs',
    label: '文档更新',
    body: '文档: \n\n范围: '
  },
  {
    id: 'refactor',
    label: '重构优化',
    body: '重构: \n\n范围: \n风险: '
  }
];

export function applyCommitMessageTemplate(templateId: string): string {
  return defaultCommitMessageTemplates.find((template) => template.id === templateId)?.body ?? '';
}

export function validateCommitMessage(message: string): CommitMessageValidation {
  const issues: string[] = [];
  const normalized = message.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (!normalized) {
    issues.push('提交说明不能为空。');
  }

  if (normalized.length > 2000) {
    issues.push('提交说明不能超过 2000 个字符。');
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
