// window-panel 命令：主菜单（原面板 6 项，重载配置按 PLAN 删除）
//   当前窗口布局 / 自动排布 → 推入子列表（Navigation）；其余执行型动作直接执行；记忆设置打开扩展偏好
import { Action, ActionPanel, Icon, List, openExtensionPreferences } from "@raycast/api";
import { useNavigation } from "@raycast/api";
import { LayoutList } from "./components/layout-list";
import { ArrangePicker } from "./components/arrange-picker";
import { forgetWindowCommand, notify, quickArrangeAction, replayAppCommand, saveWindowCommand, resolveTarget } from "./actions";
import type { ActionResult } from "./actions";

function exec(action: () => Promise<ActionResult>) {
  return async () => {
    const result = await action();
    await notify(result, { close: result.ok });
  };
}

export default function Command() {
  const { push } = useNavigation();

  return (
    <List navigationTitle="窗口操作面板" searchBarPlaceholder="搜索操作（中/英/拼音）">
      <List.Item
        title="当前窗口布局"
        subtitle="仅调整当前窗口，不影响其他窗口"
        icon={{ source: Icon.Window, tintColor: { light: "#3478f6", dark: "#3478f6", adjustContrast: false } }}
        actions={
          <ActionPanel>
            <Action title="展开布局列表" icon={Icon.ChevronRight} onAction={() => push(<LayoutList />)} />
          </ActionPanel>
        }
      />
      <List.Item
        title="自动排布"
        subtitle="↵ 上次样式直接排; → 模板 + 保存/重放「我的布局」"
        icon={{ source: Icon.AppWindowGrid2x2, tintColor: { light: "#3478f6", dark: "#3478f6", adjustContrast: false } }}
        actions={
          <ActionPanel>
            <Action title="按上次样式排布" icon={Icon.Checkmark} onAction={exec(quickArrangeAction)} />
            <Action title="展开模板选择器" icon={Icon.ChevronRight} onAction={() => push(<ArrangePicker />)} />
          </ActionPanel>
        }
      />
      <List.Item
        title="重放当前 App"
        subtitle="恢复焦点 App 所有已记忆窗口"
        icon={{ source: Icon.RotateClockwise, tintColor: { light: "#bd4f8b", dark: "#bd4f8b", adjustContrast: false } }}
        actions={
          <ActionPanel>
            <Action
              title="重放当前 App"
              icon={Icon.Checkmark}
              onAction={exec(async () => {
                const target = await resolveTarget();
                if (!target) return { ok: false, message: "没有焦点窗口" };
                return replayAppCommand(target.bundleId, target.appName);
              })}
            />
          </ActionPanel>
        }
      />
      <List.Item
        title="记忆当前窗口"
        subtitle="保存位置+大小, 成为自动排布的规则"
        icon={{ source: Icon.Plus, tintColor: { light: "#24996f", dark: "#24996f", adjustContrast: false } }}
        actions={
          <ActionPanel>
            <Action title="记忆当前窗口" icon={Icon.Checkmark} onAction={exec(saveWindowCommand)} />
          </ActionPanel>
        }
      />
      <List.Item
        title="解除当前记忆"
        subtitle="删除该窗口记忆, 自动排布不再保护"
        icon={{ source: Icon.Minus, tintColor: { light: "#c93f4e", dark: "#c93f4e", adjustContrast: false } }}
        actions={
          <ActionPanel>
            <Action title="解除当前记忆" icon={Icon.Checkmark} onAction={exec(forgetWindowCommand)} />
          </ActionPanel>
        }
      />
      <List.Item
        title="记忆设置"
        subtitle="打开扩展偏好（记录到此 App / 数据文件路径）"
        icon={{ source: Icon.Gear, tintColor: { light: "#687386", dark: "#687386", adjustContrast: false } }}
        actions={
          <ActionPanel>
            <Action title="打开扩展偏好" icon={Icon.Gear} onAction={openExtensionPreferences} />
          </ActionPanel>
        }
      />
    </List>
  );
}