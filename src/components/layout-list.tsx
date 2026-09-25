// 12 单窗布局列表（window-layout 命令与 window-panel 子菜单共用）
// 组顺序固定（全屏类/半屏类/1/4 类），组内最近用过置前（带「最近」标记）
import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { applySingleLayout, memory, notify } from "../actions";
import { singleGroupOrder, singleLayoutById, singleLayoutTemplates, singleTemplatesOrdered } from "../templates";

const ACCENT = "#3478f6";

export function LayoutList() {
  const [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    memory.singleRecent((id) => !!singleLayoutById(id)).then((ids) => setRecent(ids));
  }, []);

  const ordered = singleTemplatesOrdered(recent).ordered;
  const recentSet = new Set(recent);

  const run = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await applySingleLayout(id);
      await notify(result, { close: result.ok });
      if (result.ok) setRecent((prev) => [id, ...prev.filter((v) => v !== id)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <List isLoading={busy} searchBarPlaceholder="搜索布局（如：半屏、1/4、居中）" navigationTitle="当前窗口布局">
      {singleGroupOrder.map((group) => (
        <List.Section key={group} title={group}>
          {ordered
            .filter((t) => t.group === group)
            .map((t) => (
              <List.Item
                key={t.id}
                title={t.name}
                subtitle={t.eng + (recentSet.has(t.id) ? "  · 最近" : "")}
                icon={{ source: Icon.Window, tintColor: { light: ACCENT, dark: ACCENT, adjustContrast: false } }}
                actions={
                  <ActionPanel>
                    <Action title="套用布局" icon={Icon.Checkmark} onAction={() => run(t.id)} />
                  </ActionPanel>
                }
              />
            ))}
        </List.Section>
      ))}
      {singleLayoutTemplates.length === 0 ? <List.EmptyView title="无可用布局" /> : null}
    </List>
  );
}