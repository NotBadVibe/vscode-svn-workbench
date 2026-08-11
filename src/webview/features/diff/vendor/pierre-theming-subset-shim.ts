/*
 * @pierre/theming 主题子集 shim（v0.0.4 阶段 1，移植自
 * tests/spike/src/pierre-theming-subset-shim.ts）。
 *
 * @pierre/diffs 的 shared_highlighter 会注册 @pierre/theming/themes 暴露的
 * 全部 pierre + shiki 主题描述符，每个主题一个懒加载 chunk，合计约 1.6 MB。
 * 本项目只用 pierre-dark / pierre-light 两个主题（适配层按宿主 color-scheme
 * 切换），本 shim 通过 src/webview/vite.config.mts 的 resolve.alias 精确替换
 * "@pierre/theming/themes"，仅保留这两个描述符；shikiThemes 保留接口但返回空
 * （主题解析链路对未注册名称才会访问它）。
 *
 * createTheme 行为与原版一致：loader 结果经 normalizeTheme 归一化
 * （原版见 @pierre/theming/dist/modules/createTheme.js）。
 */
import { normalizeTheme } from "shiki/core";

/*
 * token 色对比度自适应（axe color-contrast 门禁，WCAG AA 4.5:1）。
 *
 * pierre 调色板的部分 token 前景色（深色的标点/注释 #636363、#737373，
 * 浅色的亮橙/亮青等彩色 token）在 VS Code 编辑器背景上不足 4.5:1；
 * 叠加增删行背景（组件会把行背景 override 色与编辑器背景按 80/88% 混合）
 * 与词级强调底色后，有效背景亮度进一步偏移，比值还会继续下降。
 * 本函数把对比度不足的 token 前景色按二分搜索向白（深色主题）或黑
 * （浅色主题）同比例混合（保持色相，只降/升明度），直到达到目标比值；
 * 已达标的颜色不动。目标取 6:1（深）/ 7:1（浅），为行背景与强调底色
 * （diff-theme.css 的 12% 透明混合）叠色预留余量，实测三主题全部
 * 文本 ≥4.5:1。只改 tokenColors，不碰 workbench colors。
 */
const CONTRAST_TARGET_DARK = 6;
const CONTRAST_TARGET_LIGHT = 7;
/* 参考背景：深色主题按 VS Code 常见暗背景 #262626（更暗背景下比值只会更高），
 * 浅色主题按 #ffffff。 */
const DARK_REFERENCE_BG = "#262626";
const LIGHT_REFERENCE_BG = "#ffffff";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHexColor(value: string): Rgb | undefined {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
  if (match == null) return undefined;
  const hex = match[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  if (fg == null || bg == null) return Number.POSITIVE_INFINITY;
  const first = relativeLuminance(fg);
  const second = relativeLuminance(bg);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mixChannel(color: Rgb, target: number, amount: number): string {
  return toHex({
    r: color.r + (target - color.r) * amount,
    g: color.g + (target - color.g) * amount,
    b: color.b + (target - color.b) * amount,
  });
}

function ensureContrast(
  foreground: string,
  background: string,
  lighten: boolean,
  target: number,
): string {
  const rgb = parseHexColor(foreground);
  if (rgb == null || contrastRatio(foreground, background) >= target) {
    return foreground;
  }
  const mixTarget = lighten ? 255 : 0;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (
      contrastRatio(mixChannel(rgb, mixTarget, middle), background) >= target
    ) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return mixChannel(rgb, mixTarget, high);
}

interface TokenColorEntry {
  settings?: { foreground?: string };
}

/** 调整主题 tokenColors 中对比度不足的 token 前景色；返回调整后的新对象。 */
export function adjustThemeTokenContrast(theme: unknown): unknown {
  const candidate = theme as {
    colors?: Record<string, string>;
    tokenColors?: TokenColorEntry[];
  };
  if (!Array.isArray(candidate.tokenColors)) return theme;
  const type = (theme as { type?: string }).type;
  const lighten = type !== "light";
  const referenceBg = lighten ? DARK_REFERENCE_BG : LIGHT_REFERENCE_BG;
  const target = lighten ? CONTRAST_TARGET_DARK : CONTRAST_TARGET_LIGHT;
  const tokenColors = candidate.tokenColors.map((entry) => {
    const foreground = entry.settings?.foreground;
    if (foreground == null) return entry;
    const adjusted = ensureContrast(foreground, referenceBg, lighten, target);
    if (adjusted === foreground) return entry;
    return {
      ...entry,
      settings: { ...entry.settings, foreground: adjusted },
    };
  });
  return { ...candidate, tokenColors };
}

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
    load: async () =>
      normalizeTheme(
        adjustThemeTokenContrast(unwrapDefault(await load())) as never,
      ),
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
