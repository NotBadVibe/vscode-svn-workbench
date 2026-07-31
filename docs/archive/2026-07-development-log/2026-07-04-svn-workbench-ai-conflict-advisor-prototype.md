# SVN Workbench AI 冲突建议原型记录

日期：2026-07-04

阶段：开发

> 目标：把冲突中心从“手动对比 + 手动标记已解决”推进到“AI 辅助决策”，但 AI 只给建议，不直接修改文件，不直接标记已解决。

## 本轮实现范围

新增 AI 冲突建议最小闭环：

1. 冲突中心每个冲突项增加 `AI 建议` 按钮。
2. 点击后读取该冲突项的 `Base / Mine / Theirs / Working` 文本片段。
3. 生成结构化建议：
   - recommendation
   - confidence
   - summary
   - risks
   - steps
4. 优先调用用户配置的 OpenAI-compatible 模型。
5. 模型未配置或调用失败时，回退到本地规则建议，并在页面展示 fallback 原因。
6. AI 结果只展示，不写文件、不执行 resolve、不扩大操作范围。

## 涉及文件

```text
src/ai/aiProvider.ts
src/ai/conflictAiAdvisor.ts
src/ai/openAiCompatibleProvider.ts
src/conflict/conflictCenterPanel.ts
src/extension.ts
src/test/suite/index.ts
```

## AI 请求结构

```ts
interface AiConflictRequest {
  relativePath: string;
  operation?: string;
  type?: string;
  sourceLeftRevision?: string;
  sourceRightRevision?: string;
  contents: {
    base?: AiConflictFileContent;
    mine?: AiConflictFileContent;
    theirs?: AiConflictFileContent;
    working?: AiConflictFileContent;
  };
}
```

每个文件内容默认最多采样 8000 个字符，避免一次把大文件塞给模型。

如果文件包含空字节，会按疑似二进制处理，不把内容交给模型。

## AI 返回结构

```ts
interface AiConflictAdvice {
  recommendation:
    | 'acceptWorking'
    | 'acceptMine'
    | 'acceptTheirs'
    | 'manualMerge'
    | 'noSafeSuggestion';
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  risks: string[];
  steps: string[];
}
```

模型返回会经过归一化校验：

- recommendation 不在白名单内时，降级为 `noSafeSuggestion`。
- confidence 不在白名单内时，降级为 `low`。
- risks / steps 必须是字符串数组，否则置空。
- summary 会压成单行，避免 UI 被异常格式撑破。

## 本地规则 fallback

当前本地规则用于无模型配置或模型失败时保持功能可演示：

| 场景 | 建议 |
| --- | --- |
| Working 仍包含 `<<<<<<< / ======= / >>>>>>>` | manualMerge / low |
| Mine 与 Theirs 内容一致 | acceptWorking / high |
| Working 无冲突标记且有内容 | acceptWorking / medium |
| 缺少可读内容 | noSafeSuggestion / low |

## 冲突中心交互

冲突项当前按钮：

- 打开 Working
- Base <-> Mine
- Base <-> Theirs
- Mine <-> Theirs
- Theirs <-> Working
- AI 建议
- 预览解决命令
- 标记已解决(Working)

AI 建议结果展示：

```text
来源: configured-model / local-rule / local-rule-fallback
Fallback: 可选，仅模型调用失败时展示

摘要: ...

风险:
- ...

建议步骤:
- ...
```

## 安全边界

本轮没有实现自动合并文件。

本轮没有让 AI 自动执行 `svn resolve`。

本轮没有把 AI 建议直接转成提交内容。

原因：

1. 冲突解决是高风险写操作，必须先建立可解释、可撤销、可确认的交互。
2. SVN 冲突文件可能包含业务语义，不适合让模型直接覆盖。
3. 现阶段优先做“辅助决策”，再推进“生成候选合并结果”。

## 后续可推进

下一步可以进入 AI 冲突候选结果：

1. AI 生成候选 Working 内容。
2. 候选内容进入只读预览区。
3. 用户点击“应用到 Working”前展示 diff。
4. 应用后仍不自动 resolve。
5. 用户确认文件无冲突标记后，再点“标记已解决”。

也可以增加国产模型配置页面：

- 模型厂商预设：DeepSeek、通义千问、智谱、月之暗面、OpenAI-compatible 自定义。
- baseUrl / model / apiKey 分开配置。
- apiKey 后续迁移到 VS Code SecretStorage。
- 支持测试连接、模型延迟、最近错误提示。
