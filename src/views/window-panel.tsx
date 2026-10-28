// window-panel 命令：主菜单（原面板 6 项，重载配置按 PLAN 删除）
//   当前窗口布局 / 自动排布 → 推入子列表（Navigation）；其余执行型动作直接执行；记忆设置打开扩展偏好
import {
  Action,
  ActionPanel,
  List,
  Toast,
  getFrontmostApplication,
  openExtensionPreferences,
  showToast,
} from "@raycast/api";
import { useNavigation } from "@raycast/api";
import { LayoutList } from "./layout-list";
import { ArrangePicker } from "./arrange-picker";
import { MemoriesList } from "./memories-list";
import { forgetWindowCommand, quickArrangeAction, replayAppCommand, saveWindowCommand, resolveTarget } from "../services/actions";
import { notify } from "./feedback";
import type { ActionResult } from "../services/action-result";
import { panelActionIcons, panelIcons } from "./icons";

function exec(action: () => Promise<ActionResult>) {
  return async () => {
    const result = await action();
    await notify(result, { close: result.ok });
  };
}

/** 重放当前 App：身份解析从「读焦点窗口全属性」降为 Raycast 前台 App 查询（不再先扫全量窗口再匹配） */
async function replayCurrentApp(): Promise<ActionResult> {
  const toast = await showToast({ style: Toast.Style.Animated, title: "正在重放当前 App…" });
  try {
    const app = await getFrontmostApplication();
    if (!app || app.bundleId === "com.raycast.macos" || app.name === "Raycast") {
      return { ok: false, message: "没有焦点 App" };
    }
    if (app.bundleId) return await replayAppCommand(app.bundleId, app.name);
    // 无 bundle id 的 App（极少）：退回按焦点窗口解析身份，保持旧语义
    const target = await resolveTarget();
    if (!target) return { ok: false, message: "没有焦点窗口" };
    return await replayAppCommand(target.bundleId, target.appName);
  } finally {
    await toast.hide();
  }
}

export default function Command() {
  const { push } = useNavigation();

  return (
    <List navigationTitle="窗口操作面板" searchBarPlaceholder="搜索操作（中/英/拼音）">
      <List.Item
        title="当前窗口布局"
        subtitle="仅调整当前窗口，不影响其他窗口"
        icon={panelIcons.windowLayout}
        actions={
          <ActionPanel>
            <Action title="展开布局列表" icon={panelActionIcons.expand} onAction={() => push(<LayoutList />)} />
          </ActionPanel>
        }
      />
      <List.Item
        title="自动排布"
        subtitle="↵ 上次样式直接排; → 模板 + 保存/重放「我的布局」"
        icon={panelIcons.arrange}
        actions={
          <ActionPanel>
            <Action title="按上次样式排布" icon={panelActionIcons.execute} onAction={exec(quickArrangeAction)} />
            <Action title="展开模板选择器" icon={panelActionIcons.expand} onAction={() => push(<ArrangePicker />)} />
          </ActionPanel>
        }
      />
      <List.Item
        title="重放当前 App"
        subtitle="恢复焦点 App 所有已记忆窗口"
        icon={panelIcons.replayApp}
        actions={
          <ActionPanel>
            <Action title="重放当前 App" icon={panelActionIcons.execute} onAction={exec(replayCurrentApp)} />
          </ActionPanel>
        }
      />
      <List.Item
        title="记忆当前窗口"
        subtitle="保存位置+大小, 成为自动排布的规则"
        icon={panelIcons.rememberWindow}
        actions={
          <ActionPanel>
            <Action title="记忆当前窗口" icon={panelActionIcons.execute} onAction={exec(saveWindowCommand)} />
          </ActionPanel>
        }
      />
      <List.Item
        title="解除当前记忆"
        subtitle="删除该窗口记忆, 自动排布不再保护"
        icon={panelIcons.forgetWindow}
        actions={
          <ActionPanel>
            <Action title="解除当前记忆" icon={panelActionIcons.execute} onAction={exec(forgetWindowCommand)} />
          </ActionPanel>
        }
      />
      <List.Item
        title="已记忆窗口"
        subtitle="按 App 查看、重放和删除保存的窗口布局"
        icon={panelIcons.memories}
        actions={
          <ActionPanel>
            <Action title="查看已记忆窗口" icon={panelActionIcons.expand} onAction={() => push(<MemoriesList />)} />
          </ActionPanel>
        }
      />
      <List.Item
        title="记忆设置"
        subtitle="打开扩展偏好（记录到此 App / 数据文件路径）"
        icon={panelIcons.settings}
        actions={
          <ActionPanel>
            <Action title="打开扩展偏好" icon={panelActionIcons.settings} onAction={openExtensionPreferences} />
          </ActionPanel>
        }
      />
    </List>
  );
}