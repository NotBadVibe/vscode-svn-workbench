import { expect, test } from "@playwright/test";
import { openModule } from "./navigation";

// V020-R07：设置页配置草稿与测试反馈分离。
// 修改地址/模型 → 测试成功 → 保存，Mock 持久化新值；测试/模型列表返回、
// 继续编辑均不覆盖草稿；旧结果标过期；放弃修改才回到已保存值。
test("V020-R07 settings draft survives test and list-models, save persists", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "设置");
  await expect(
    page.getByRole("heading", { name: "设置与团队规范" }),
  ).toBeVisible();

  const baseUrl = page.getByLabel("接口地址（Base URL）");
  const model = page.getByLabel("默认模型", { exact: true });
  const apiKey = page.getByLabel("API 密钥", { exact: true });
  await expect(baseUrl).toHaveValue("https://api.deepseek.com");

  await baseUrl.fill("https://new.example/v1");
  await model.fill("model-new");
  await apiKey.fill("e2e-typed-secret");

  // 测试连接返回成功快照：草稿保持新值，新密钥不被清空。
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("连接成功，模型返回了有效响应。")).toBeVisible();
  await expect(baseUrl).toHaveValue("https://new.example/v1");
  await expect(model).toHaveValue("model-new");
  await expect(apiKey).toHaveValue("e2e-typed-secret");
  await expect(page.getByText("有未保存的修改")).toBeVisible();

  // 读取模型列表同样不覆盖草稿。
  await page.getByRole("button", { name: "读取模型列表" }).click();
  await expect(page.getByText("读取到 1 个可用模型。")).toBeVisible();
  await expect(baseUrl).toHaveValue("https://new.example/v1");
  await expect(model).toHaveValue("model-new");

  // 继续编辑后旧结果标为过期。
  await model.fill("model-newer");
  await expect(page.getByText(/已过期/)).toBeVisible();
  await expect(baseUrl).toHaveValue("https://new.example/v1");

  // 保存：Mock 持久化新值，快照确认后密钥输入清空、未保存提示消失。
  await model.fill("model-new");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(
    page.getByText("AI 模型配置已保存，密钥仍仅存于 SecretStorage。"),
  ).toBeVisible();
  await expect(baseUrl).toHaveValue("https://new.example/v1");
  await expect(model).toHaveValue("model-new");
  await expect(apiKey).toHaveValue("");
  await expect(page.getByText("有未保存的修改")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "放弃修改" })).toHaveCount(0);

  // 修改后放弃：回到已保存值。
  await baseUrl.fill("https://dirty.example/v1");
  await expect(page.getByText("有未保存的修改")).toBeVisible();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(baseUrl).toHaveValue("https://new.example/v1");

  // 密钥从不明文出现在页面快照文本中。
  await expect(page.getByText("e2e-typed-secret")).toHaveCount(0);
});
