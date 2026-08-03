import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/svelte";
import { afterEach } from "vitest";

// 仓库任务视图按需加载；Windows CI 首次解析 Svelte 分块时可能超过默认 1 秒。
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => cleanup());
