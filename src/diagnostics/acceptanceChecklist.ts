export interface AcceptanceChecklistItem {
  id: string;
  title: string;
  description: string;
  steps: string[];
  expected: string[];
}

export interface AcceptanceChecklistSection {
  id: string;
  title: string;
  items: AcceptanceChecklistItem[];
}

export interface AcceptanceChecklistSummary {
  sections: number;
  items: number;
  steps: number;
  expectedResults: number;
}

export const acceptanceChecklistSections: AcceptanceChecklistSection[] = [
  {
    id: 'environment',
    title: '环境与安装',
    items: [
      {
        id: 'environment-check',
        title: '命令面板环境检查',
        description: '确认扩展在当前 VS Code 用户环境中可以读取 SVN、工作区和 AI 配置状态。',
        steps: [
          '打开命令面板。',
          '执行 SVN：检查环境。',
          '打开 SVN 工作台输出面板。'
        ],
        expected: [
          '输出面板显示操作系统、CPU 架构、VS Code 版本、SVN CLI、工作区和 AI 配置。',
          '未找到 SVN CLI 时显示失败；缺少工作区或 AI 配置时显示提醒。'
        ]
      },
      {
        id: 'installed-extension',
        title: '扩展安装状态',
        description: '确认 VSIX 安装后扩展可被 VS Code 枚举。',
        steps: [
          '在终端执行 code --list-extensions --show-versions。',
          '搜索 local.svn-workbench@0.0.1。'
        ],
        expected: [
          '扩展列表包含 local.svn-workbench@0.0.1。'
        ]
      }
    ]
  },
  {
    id: 'explorer',
    title: '资源管理器入口',
    items: [
      {
        id: 'explorer-task-routing',
        title: '右键直达具体任务',
        description: '验证 Explorer 和编辑器右键按常用、AI、恢复、更多 SVN 操作、设置与诊断分组，并直接打开当前任务。',
        steps: [
          '在 SVN 工作副本内分别右键文件和文件夹。',
          '展开“SVN 工作台”并检查常用操作与四个任务分组。',
          '分别打开更新、历史、属性和清理任务。'
        ],
        expected: [
          '文件和文件夹均显示“SVN 工作台”，文件额外显示差异入口。',
          '常用操作位于首层；AI 助手、冲突与恢复、更多 SVN 操作、设置与诊断最多再展开一级。',
          '每个命令直接进入对应模块或子任务，不先显示仓库工具大首页。'
        ]
      },
      {
        id: 'explorer-folder-commit',
        title: '右键文件夹提交当前范围',
        description: '验证用户右键某个文件夹时，提交页只处理当前文件夹范围内的内容。',
        steps: [
          '打开 SVN 工作副本。',
          '在资源管理器中右键一个子文件夹。',
          '执行 SVN：提交当前范围。'
        ],
        expected: [
          '提交页标题显示当前范围。',
          '候选文件只来自所选文件夹内部。',
          '范围外路径不会进入提交计划。'
        ]
      },
      {
        id: 'explorer-conflict-center',
        title: '右键打开冲突中心',
        description: '验证冲突中心可以从资源管理器当前范围打开。',
        steps: [
          '在 SVN 工作副本或冲突文件夹上右键。',
          '执行 SVN：打开冲突中心。'
        ],
        expected: [
          '冲突中心 Webview 打开。',
          '没有冲突时显示空状态；有冲突时显示冲突文件列表。'
        ]
      },
      {
        id: 'explorer-ai-actions',
        title: '右键 AI 操作入口',
        description: '验证 AI 审查、影响分析、智能拆分和受控代理可以从资源管理器当前范围触发。',
        steps: [
          '在资源管理器中右键 SVN 工作副本内的文件或文件夹。',
          '展开“SVN 工作台”中的“AI 助手”。',
          '分别确认 AI 变更审查、影响与测试、变更集与智能拆分、受控 AI 任务代理入口。',
          '从“设置与诊断”打开 AI 模型设置。'
        ],
        expected: [
          '四个 AI 入口直接打开对应任务，并遵守右键文件或文件夹范围。',
          'AI 模型设置独立于日常 AI 任务；未配置模型时基础 SVN 功能仍可使用。'
        ]
      }
    ]
  },
  {
    id: 'chinese-ux',
    title: '中文用户体验',
    items: [
      {
        id: 'chinese-terminology',
        title: '中文术语、时间与数量',
        description: '确认主要信息层级使用一致的简体中文，必要技术名词、路径和命令保留原文。',
        steps: [
          '依次打开变更、提交、历史、冲突、仓库操作、设置与诊断。',
          '检查相同文件状态、风险和操作名称。',
          '检查更新时间、修订时间、文件数、冲突数与字符预算。'
        ],
        expected: [
          '白名单外没有纯英文业务标题、状态或主要按钮。',
          '时间使用中文 24 小时制；数量使用“个文件”“条修订”等中文量词。',
          '路径、URL、属性名、revision、CLI 命令和代码内容保持原文。'
        ]
      },
      {
        id: 'chinese-ime-path',
        title: '中文输入法与特殊路径',
        description: '验证中文输入候选不会误触发执行，中文及带空格符号的路径可以完整处理。',
        steps: [
          '使用中文输入法在提交说明和 AI 任务目标中输入多段文字。',
          '在输入法候选阶段按 Enter，再使用界面提示的 Ctrl/⌘ + Enter。',
          '搜索并打开名称包含中文、空格、括号和 # 的文件。'
        ],
        expected: [
          '输入法组合阶段的 Enter 只确认候选，不触发提交、确认或 AI 执行。',
          '显式快捷键只在组合结束后生效。',
          '特殊路径可显示、筛选、复制并作为安全参数执行，不出现截断或 shell 拼接。'
        ]
      },
      {
        id: 'chinese-risk-recovery',
        title: '危险操作与错误恢复文案',
        description: '确认风险和失败信息能让中文用户理解对象、后果与下一步。',
        steps: [
          '生成还原、删除、切换或合并预览，但不要确认执行。',
          '查看认证、证书、代理、离线、工作副本锁和 SVN CLI 缺失状态。'
        ],
        expected: [
          '危险操作展示精确目标、影响、可恢复性和独立确认。',
          '错误先给出中文分类和恢复动作，原始 stderr 只作为补充证据。'
        ]
      },
      {
        id: 'chinese-ai-privacy',
        title: 'AI 外发范围与本地降级',
        description: '确认 AI 在调用前解释外发内容，并且失败时不阻断 SVN 主流程。',
        steps: [
          '打开 AI 审查、提交说明与影响分析。',
          '检查模型、文件数、数据类型、字符预算和历史范围。',
          '关闭或清空 AI 配置后重复基础 SVN 浏览、Diff、历史与提交预览。'
        ],
        expected: [
          '调用前用中文显示数据范围，提交历史默认不包含。',
          'AI 不能扩大右键范围、自动提交或自动标记冲突解决。',
          'AI 未配置或失败时保留本地规则和手动 SVN 流程。'
        ]
      }
    ]
  },
  {
    id: 'layout-scroll',
    title: '页面布局与局部滚动',
    items: [
      {
        id: 'local-scroll-regions',
        title: '局部滚动与末项可达',
        description: '确认长列表和小区域拥有明确滚动归属，不依赖浏览器整页滚动。',
        steps: [
          '在长数据工作副本中打开变更、提交、历史、冲突、变更集、属性、设置和诊断。',
          '使用鼠标滚轮或触控板滚动每个局部区域到末项。',
          '聚焦滚动区域后使用 PageDown 和 End。'
        ],
        expected: [
          '溢出区域显示可辨识的滚动条或边界反馈，最后一项和底部主操作可到达。',
          '多栏页面各 Pane 独立滚动，不出现三级同向嵌套滚动。',
          '代码、命令或 Diff 可以局部横向滚动，页面本身无水平滚动。'
        ]
      },
      {
        id: 'keyboard-scroll-focus',
        title: '键盘滚动与焦点逃逸',
        description: '确认 ScrollArea 可以键盘操作且不会形成焦点陷阱。',
        steps: [
          '按 Tab 聚焦一个有溢出的列表或详情区域。',
          '使用 PageDown、End、Home 验证滚动位置。',
          '继续按 Tab 移动到区域后的按钮或控件。'
        ],
        expected: [
          '键盘操作会改变正确局部区域的滚动位置。',
          '焦点框清楚，用户可以离开滚动区域。'
        ]
      },
      {
        id: 'compact-zoom',
        title: '720×480 与 200% 缩放',
        description: '验证小编辑器区域和高缩放下关键上下文与操作不会永久裁切。',
        steps: [
          '将编辑器区域调整为约 720×480。',
          '分别切换 100%、125%、150% 和 200% 缩放。',
          '检查范围、风险、错误恢复、主操作和左侧模块导航。'
        ],
        expected: [
          '内容可转为单列或紧凑布局，但范围、风险和主操作始终可达。',
          'Rail 的设置和诊断入口可通过滚动到达。',
          '页面无永久裁切和页面级水平滚动。'
        ]
      },
      {
        id: 'theme-accessibility',
        title: '三主题与无障碍表达',
        description: '抽查 Light、Dark、High Contrast 下的边界、焦点、状态与危险提示。',
        steps: [
          '依次切换浅色、深色和高对比度主题。',
          '检查 ScrollArea、焦点框、状态徽标、禁用态和危险确认。',
          '使用键盘打开和关闭 Svelte 文件右键菜单。'
        ],
        expected: [
          '三主题下文字、边界、滚动反馈和危险状态均可辨识。',
          '状态不只依赖颜色，交互控件具有可理解名称和焦点顺序。'
        ]
      }
    ]
  },
  {
    id: 'commit',
    title: '提交页',
    items: [
      {
        id: 'commit-filters',
        title: '候选筛选与批量选择',
        description: '验证日常提交时最常用的筛选、模板和生成物隐藏能力。',
        steps: [
          '打开提交页。',
          '分别使用状态、文件类型、模板分类、AI 决策筛选。',
          '切换隐藏生成物。',
          '使用只选当前筛选、加入当前筛选、移除当前筛选。'
        ],
        expected: [
          '列表与计数随筛选实时变化。',
          'bin、obj、dist、日志等生成物默认被排除或进入待确认。',
          '批量选择只影响当前筛选结果。'
        ]
      },
      {
        id: 'commit-plan',
        title: '提交计划预览与安全拦截',
        description: '验证提交前的路径边界、生成物、缺失文件和提交说明校验。',
        steps: [
          '选择一组候选文件。',
          '填写提交说明。',
          '执行预览提交计划。'
        ],
        expected: [
          '预览展示将执行的 add、remove、commit 路径。',
          '范围外路径、阻止项和无效提交说明会阻止提交。'
        ]
      },
      {
        id: 'commit-ai',
        title: 'AI 选择、拆分与提交说明',
        description: '验证 AI 辅助不会绕过本地路径边界和提交安全规则。',
        steps: [
          '执行 AI 筛选。',
          '执行 AI 拆分提交。',
          '执行 AI 生成说明或 AI 补全模板。'
        ],
        expected: [
          'AI 返回的范围外路径会被过滤。',
          '拆分队列可预览、套用、提交、重试。',
          '提交说明符合团队模板和规范。'
        ]
      }
    ]
  },
  {
    id: 'update',
    title: '更新页能力',
    items: [
      {
        id: 'update-preview',
        title: '更新预览与风险确认',
        description: '验证更新前能看到本地变更、远端变更和重叠风险。',
        steps: [
          '在提交页点击预览更新。',
          '查看远端更新检查结果。',
          '点击更新当前范围。'
        ],
        expected: [
          '预览展示本地未提交摘要、远端变更摘要、风险等级和建议。',
          '执行更新前弹出风险感知确认框。'
        ]
      },
      {
        id: 'update-after-refresh',
        title: '更新后候选刷新与冲突入口',
        description: '验证更新完成后页面候选状态不会停留在旧状态。',
        steps: [
          '执行更新当前范围。',
          '观察更新结果面板。',
          '如果产生冲突，点击打开冲突中心。'
        ],
        expected: [
          '更新成功后自动刷新提交候选。',
          '候选刷新失败时仅提示后续刷新失败，不误报 SVN 更新失败。',
          '检测到冲突时显示打开冲突中心按钮。'
        ]
      }
    ]
  },
  {
    id: 'conflict',
    title: '冲突中心',
    items: [
      {
        id: 'conflict-ai-advice',
        title: '冲突列表与 AI 建议',
        description: '验证冲突中心能收集 SVN 冲突，并给出受边界约束的 AI 建议。',
        steps: [
          '打开存在冲突的工作副本。',
          '执行 SVN：打开冲突中心。',
          '对冲突文件请求 AI 建议。'
        ],
        expected: [
          '冲突文件列表正确展示。',
          'AI 建议只给出决策、摘要、理由和风险，不自动改写文件。',
          '用户仍然负责最终冲突处理决策。'
        ]
      },
      {
        id: 'conflict-resolve',
        title: '冲突解决后刷新',
        description: '验证冲突解决动作和状态刷新链路。',
        steps: [
          '在冲突中心选择使用工作副本解决。',
          '刷新冲突列表。'
        ],
        expected: [
          'SVN resolve 成功后冲突列表更新。',
          'SCM 状态同步刷新。'
        ]
      }
    ]
  },
  {
    id: 'cross-platform',
    title: '跨平台一致性',
    items: [
      {
        id: 'windows-acceptance',
        title: 'Windows 安装与流程',
        description: '验证 Windows 用户环境下 VSIX 安装和核心流程。',
        steps: [
          '安装 VSIX。',
          '执行环境检查。',
          '走提交、更新、冲突中心核心流程。'
        ],
        expected: [
          'SVN CLI 命中 svn.exe、TortoiseSVN、SlikSVN、VisualSVN 或用户配置路径。',
          '页面功能与文案符合统一标准。'
        ]
      },
      {
        id: 'macos-acceptance',
        title: 'macOS 安装与流程',
        description: '验证 macOS 用户环境下 VSIX 安装和核心流程。',
        steps: [
          '安装 VSIX。',
          '执行环境检查。',
          '走提交、更新、冲突中心核心流程。'
        ],
        expected: [
          'SVN CLI 命中 svn、/opt/homebrew/bin/svn、/usr/local/bin/svn、/usr/bin/svn 或用户配置路径。',
          '页面功能与统一验收标准一致。'
        ]
      },
      {
        id: 'linux-acceptance',
        title: 'Linux 安装与流程',
        description: '验证 Linux 用户环境下 VSIX 安装和核心流程。',
        steps: [
          '安装 VSIX。',
          '执行环境检查。',
          '走提交、更新、冲突中心核心流程。'
        ],
        expected: [
          'SVN CLI 命中 PATH 中的 svn 或用户配置路径。',
          '页面功能与统一验收标准一致。'
        ]
      }
    ]
  }
];

export function summarizeAcceptanceChecklist(
  sections: AcceptanceChecklistSection[] = acceptanceChecklistSections
): AcceptanceChecklistSummary {
  return {
    sections: sections.length,
    items: sections.reduce((sum, section) => sum + section.items.length, 0),
    steps: sections.reduce((sum, section) => sum + section.items.reduce((inner, item) => inner + item.steps.length, 0), 0),
    expectedResults: sections.reduce(
      (sum, section) => sum + section.items.reduce((inner, item) => inner + item.expected.length, 0),
      0
    )
  };
}

export function formatAcceptanceChecklistMarkdown(
  sections: AcceptanceChecklistSection[] = acceptanceChecklistSections
): string {
  const summary = summarizeAcceptanceChecklist(sections);
  const lines = [
    '# SVN 工作台 UI 验收清单',
    '',
    `共 ${summary.sections} 个分组，${summary.items} 个验收项。`,
    ''
  ];

  for (const section of sections) {
    lines.push(`## ${section.title}`, '');
    for (const item of section.items) {
      lines.push(`### ${item.title}`, '', item.description, '', '步骤：');
      for (const step of item.steps) {
        lines.push(`- [ ] ${step}`);
      }
      lines.push('', '期望结果：');
      for (const expected of item.expected) {
        lines.push(`- ${expected}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
}
