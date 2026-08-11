/*
 * @pierre/theming 主题子集 shim（体积验证用）。
 *
 * @pierre/diffs 的 shared_highlighter 会注册 @pierre/theming/themes 暴露的
 * 全部 pierre + shiki 主题描述符（dist/highlighter/shared_highlighter.js），
 * 每个主题一个懒加载 chunk，合计约 1.6 MB。Spike 与规划场景只用
 * pierre-dark / pierre-light 两个主题，本 shim 通过 Vite resolve.alias
 * 精确替换 "@pierre/theming/themes"，仅保留这两个描述符；
 * shikiThemes 保留接口但返回空（主题解析链路对未注册名称才会访问它，
 * 见 dist/highlighter/themes/themeResolution.js）。
 *
 * createTheme 行为与原版一致：loader 结果经 normalizeTheme 归一化
 * （原版见 @pierre/theming/dist/modules/createTheme.js）。
 */
import { normalizeTheme } from "shiki/core";

type ThemeColorScheme = "light" | "dark";

interface ThemeDescriptor {
  name: string;
  colorScheme: ThemeColorScheme;
  collection: string;
  displayName: string;
  load: () => Promise<unknown>;
}

function unwrapDefault(module: unknown): unknown {
  return (module as { default?: unknown })?.default ?? module;
}

function createTheme(descriptor: {
  name: string;
  load: () => Promise<unknown>;
  colorScheme: ThemeColorScheme;
  collection: string;
  displayName: string;
}): ThemeDescriptor {
  const { name, load, colorScheme, collection, displayName } = descriptor;
  return {
    name,
    colorScheme,
    collection,
    displayName,
    load: async () => normalizeTheme(unwrapDefault(await load()) as never),
  };
}

const PIERRE_THEMES: ThemeDescriptor[] = [
  createTheme({
    name: "pierre-dark",
    colorScheme: "dark",
    collection: "pierre",
    displayName: "Pierre Dark",
    load: () => import("@pierre/theme/pierre-dark"),
  }),
  createTheme({
    name: "pierre-light",
    colorScheme: "light",
    collection: "pierre",
    displayName: "Pierre Light",
    load: () => import("@pierre/theme/pierre-light"),
  }),
];

export const pierreThemes = {
  getThemes: (): ThemeDescriptor[] => PIERRE_THEMES,
};

export const shikiThemes = {
  getTheme: (): ThemeDescriptor | undefined => undefined,
  getThemes: (): ThemeDescriptor[] => [],
};

export { createTheme };
