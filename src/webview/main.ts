import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/global.css";

const target = document.getElementById("app");
if (!target) {
  throw new Error("未找到 SVN 工作台根元素。");
}

mount(App, { target });
