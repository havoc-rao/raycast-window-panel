// 独立命令与主面板共用的已记忆窗口管理页。
import { Action, ActionPanel, Alert, Icon, List, confirmAlert } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { deleteMemoryCommand, replayMemoryCommand } from "../services/actions";
import { loadLayouts } from "../services/storage/repository";
import { notify } from "./feedback";
import { shortAppName } from "../utils/app-name";
import { panelActionIcons, panelIcons } from "./icons";
import type { Frame } from "../domain/types";

interface Row {
  key: string;
  bundleId: string;
  title: string;
  frame: Frame;
}

const rounded = (n: number) => Math.round(n);

export function MemoriesList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const data = loadLayouts();
    setRows(Object.entries(data.windows).map(([key, rec]) => ({
      key, bundleId: rec.bundleID, title: rec.title || "未命名窗口", frame: rec.frame,
    })).sort((a, b) => a.bundleId.localeCompare(b.bundleId) || a.title.localeCompare(b.title)));
  }, [refresh]);

  const groups = useMemo(() => {
    const result = new Map<string, Row[]>();
    for (const row of rows) {
      const group = result.get(row.bundleId) ?? [];
      group.push(row);
      result.set(row.bundleId, group);
    }
    return [...result.entries()];
  }, [rows]);

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
        title: "删除这条窗口记忆？",
        message: `${shortAppName(row.bundleId)} · ${row.title}\n仅删除保存的布局，不会关闭窗口；以后自动排布将不再跳过它。`,
        primaryAction: { title: "删除记忆", style: Alert.ActionStyle.Destructive },
        dismissAction: { title: "取消" },
      });
      if (!confirmed) return;
      const result = await deleteMemoryCommand(row.key);
      await notify(result);
      if (result.ok) setRefresh((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <List isLoading={busy} isShowingDetail={rows.length > 0} searchBarPlaceholder="搜索已记忆窗口（App / 标题 / Bundle ID）" navigationTitle={`已记忆窗口 · ${rows.length} 条`}>
      {groups.map(([bundleId, items]) => (
        <List.Section key={bundleId} title={shortAppName(bundleId)} subtitle={`${items.length} 个窗口`}>
          {items.map((row) => (
            <List.Item
              key={row.key}
              id={row.key}
              title={row.title}
              keywords={[row.bundleId, shortAppName(row.bundleId)]}
              icon={panelIcons.rememberWindow}
              detail={
                <List.Item.Detail
                  markdown="### 已保存的窗口布局\n\n重放会将对应的已打开窗口恢复到保存的位置和尺寸；不会启动 App 或重新打开已关闭的窗口。\n\n**自动排布会跳过有记忆的窗口。** 删除记忆后，该窗口可重新参与自动排布。"
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="App" text={shortAppName(row.bundleId)} />
                      <List.Item.Detail.Metadata.Label title="Bundle ID" text={row.bundleId || "未知"} />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label title="宽 × 高" text={`${rounded(row.frame.w)} × ${rounded(row.frame.h)} pt`} />
                      <List.Item.Detail.Metadata.Label title="位置 X / Y" text={`${rounded(row.frame.x)} / ${rounded(row.frame.y)} pt`} />
                      <List.Item.Detail.Metadata.Label title="自动排布" text="跳过此窗口" />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action title="重放这条记忆" icon={panelIcons.replayApp} onAction={() => replay(row)} />
                  <Action.CopyToClipboard title="复制窗口记忆" content={JSON.stringify({ bundleID: row.bundleId, title: row.title, frame: row.frame }, null, 2)} />
                  <Action title="刷新列表" icon={panelIcons.replayApp} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={() => { if (!busy) setRefresh((n) => n + 1); }} />
                  <Action title="删除记忆" icon={panelActionIcons.delete} style={Action.Style.Destructive} shortcut={{ modifiers: ["ctrl"], key: "x" }} onAction={() => remove(row)} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
      <List.EmptyView icon={Icon.Bookmark} title={rows.length ? "没有匹配的窗口记忆" : "还没有已记忆窗口"} description={rows.length ? "试试搜索 App 名称、窗口标题或 Bundle ID" : "返回主面板，使用「记忆当前窗口」保存第一个布局"} />
    </List>
  );
}

export default MemoriesList;
