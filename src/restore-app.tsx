// restore-app 命令（view，增强版）：列出所有有记忆的 App，选择后重放其全部已记忆窗口
import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { loadLayouts, notify, rememberedApps, replayAppCommand, shortAppName } from "./actions";

export default function Command() {
  const [rows, setRows] = useState<Array<{ bundleId: string; count: number }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(rememberedApps(loadLayouts()));
  }, []);

  const run = async (bundleId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await replayAppCommand(bundleId, shortAppName(bundleId));
      await notify(result, { close: result.ok });
    } finally {
      setBusy(false);
    }
  };

  return (
    <List isLoading={busy} searchBarPlaceholder="搜索有记忆的 App" navigationTitle="重放 App">
      {rows.map((row) => (
        <List.Item
          key={row.bundleId}
          title={shortAppName(row.bundleId)}
          subtitle={row.bundleId}
          accessories={[{ text: `${row.count} 个记忆窗口` }]}
          icon={{ source: Icon.AppWindow, tintColor: { light: "#bd4f8b", dark: "#bd4f8b", adjustContrast: false } }}
          actions={
            <ActionPanel>
              <Action title="重放全部记忆窗口" icon={Icon.RotateClockwise} onAction={() => run(row.bundleId)} />
            </ActionPanel>
          }
        />
      ))}
      {rows.length === 0 ? (
        <List.EmptyView
          icon={Icon.MemoryChip}
          title="还没有任何记忆"
          description="使用「记忆当前窗口」保存第一个窗口"
        />
      ) : null}
    </List>
  );
}