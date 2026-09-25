// manage-memories 命令（view，增强版）：全量记忆列表，单条重放 / 删除
import { Action, ActionPanel, Alert, Icon, List, confirmAlert } from "@raycast/api";
import { useEffect, useState } from "react";
import { deleteMemoryCommand, loadLayouts, notify, replayMemoryCommand, shortAppName } from "./actions";

interface Row {
  key: string;
  bundleId: string;
  title: string;
  frameText: string;
}

export default function Command() {
  const [rows, setRows] = useState<Row[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const data = loadLayouts();
    setRows(
      Object.entries(data.windows).map(([key, rec]) => ({
        key,
        bundleId: rec.bundleID,
        title: rec.title || key,
        frameText: `${Math.floor(rec.frame.w + 0.5)}×${Math.floor(rec.frame.h + 0.5)} @ ${Math.floor(rec.frame.x)},${Math.floor(rec.frame.y)}`,
      }))
    );
  }, [refresh]);

  const replay = async (row: Row) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await replayMemoryCommand(row.key);
      await notify(result, { close: result.ok });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: Row) => {
    if (busy) return;
    setBusy(true);
    try {
      const confirmed = await confirmAlert({
        title: "删除这条记忆?",
        message: `${shortAppName(row.bundleId)} · ${row.title}（${row.frameText}）`,
        primaryAction: { title: "删除", style: Alert.ActionStyle.Destructive },
        dismissAction: { title: "取消" },
      });
      if (!confirmed) return;
      const result = await deleteMemoryCommand(row.key);
      await notify(result);
      setRefresh((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <List isLoading={busy} searchBarPlaceholder="搜索记忆（App / 标题）" navigationTitle="管理记忆">
      {rows.map((row) => (
        <List.Item
          key={row.key}
          title={row.title}
          subtitle={shortAppName(row.bundleId)}
          accessories={[{ text: row.frameText }]}
          icon={{ source: Icon.Bookmark, tintColor: { light: "#24996f", dark: "#24996f", adjustContrast: false } }}
          actions={
            <ActionPanel>
              <Action title="重放这条记忆" icon={Icon.RotateClockwise} onAction={() => replay(row)} />
              <Action title="删除" icon={Icon.Trash} style={Action.Style.Destructive} onAction={() => remove(row)} />
            </ActionPanel>
          }
        />
      ))}
      {rows.length === 0 ? (
        <List.EmptyView icon={Icon.MemoryChip} title="还没有任何记忆" description="使用「记忆当前窗口」保存第一个窗口" />
      ) : null}
    </List>
  );
}