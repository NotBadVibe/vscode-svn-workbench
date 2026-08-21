import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/svelte";
import { afterEach } from "vitest";

/*
 * jsdom（30.x）未实现 <dialog> 的 show/showModal/close。
 * v0.0.13 冲突草稿三选一守卫等组件依赖 showModal 打开对话框，
 * 未打开的 <dialog> 不在可访问树中，testing-library 无法按 role 查询。
 * 这里以 open 属性为最小行为填充，仅补齐测试环境缺失的 API。
 */
if (
  typeof HTMLDialogElement !== "undefined" &&
  !HTMLDialogElement.prototype.showModal
) {
  HTMLDialogElement.prototype.show = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
}

// 仓库任务视图按需加载；Windows CI 首次解析 Svelte 分块时可能超过默认 1 秒。
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => cleanup());
