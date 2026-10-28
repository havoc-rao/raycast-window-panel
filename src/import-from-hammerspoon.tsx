// Raycast no-view 入口：导入服务返回结果，命令负责展示反馈。
import { importFromHammerspoon } from "./services/import-hammerspoon";
import { notify } from "./views/feedback";
// 保持原命令装载时的后端预热时机。
import "./services/windows/provider";

export default async function Command() {
  await notify(await importFromHammerspoon());
}
