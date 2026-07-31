import { describe, expect, it } from 'vitest';
import { formatCount, formatZhDateTime, formatZhNumber, formatZhTime } from '../../src/webview/i18n/formatters';
import { isExplicitSubmitShortcut, isImeComposing } from '../../src/webview/i18n/keyboard';
import { fileStatusLabels, findingCategoryLabels, taskLabels } from '../../src/webview/i18n/terminology';

describe('中文用户体验公共契约', () => {
  it('统一输出中文状态、任务和审查分类', () => {
    expect(fileStatusLabels.modified).toBe('已修改');
    expect(fileStatusLabels.conflicted).toBe('存在冲突');
    expect(taskLabels['repository/recovery']).toBe('清理与恢复工作副本');
    expect(findingCategoryLabels.security).toBe('安全');
  });

  it('使用中文数字、24 小时时间和符合习惯的量词', () => {
    expect(formatZhNumber(12345)).toMatch(/12[,，]345/);
    expect(formatZhTime('2026-07-30T20:05:00+08:00')).toBe('20:05');
    expect(formatZhDateTime('2026-07-30T20:05:00+08:00', '2026-07-30T22:00:00+08:00')).toBe('今天 20:05');
    expect(formatZhDateTime('2026-07-29T08:06:00+08:00', '2026-07-30T22:00:00+08:00')).toBe('昨天 08:06');
    expect(formatZhDateTime('invalid')).toBe('未知时间');
    expect(formatCount(3, '文件')).toBe('3 个文件');
    expect(formatCount(4, '修订')).toBe('4 条修订');
    expect(formatCount(2, '冲突')).toBe('2 处冲突');
  });

  it('中文输入法组合期间禁止快捷提交，并兼容 keyCode 229', () => {
    expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isExplicitSubmitShortcut({ key: 'Enter', ctrlKey: true, metaKey: false, isComposing: true, keyCode: 13 })).toBe(false);
    expect(isExplicitSubmitShortcut({ key: 'Enter', ctrlKey: true, metaKey: false, isComposing: false, keyCode: 229 })).toBe(false);
    expect(isExplicitSubmitShortcut({ key: 'Enter', ctrlKey: true, metaKey: false, isComposing: false, keyCode: 13 })).toBe(true);
  });
});
