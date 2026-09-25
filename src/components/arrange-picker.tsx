// 自动排布模板选择器（arrange 命令与 window-panel 子菜单共用）
// 结构：特殊项（保存/重放我的布局）置顶 + 该弹性窗口数适用的模板（最近用过置前）；
// 「重放我的布局」附两步删除（Alert 确认）；重放副标题动态显示上次槽位数。
import { Action, ActionPanel, Alert, Icon, List, confirmAlert } from "@raycast/api";
import { useEffect, useState } from "react";
import { deleteMyLayout, getProvider, loadLayouts, memory, notify, runArrange } from "../actions";
import { makeArrangeContext } from "../engine";
import { defaultTemplateFor, templatesForOrdered, templateById } from "../templates";

export interface ArrangePickerContext {
  count: number;
  targetName: string;
  hasSnapshot: boolean;
  snapshotCount: number;
}

export function ArrangePicker() {
  const [ctx, setCtx] = useState<ArrangePickerContext | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getProvider();
        const target = await p.getActiveWindow();
        const region = target ? await p.getScreenRegion(target) : null;
        const others = target ? await p.listWindowsOnActiveDesktop(target) : [];
        const screens = await p.getAllScreens();
        const data = loadLayouts();
        const ctx = target && region ? makeArrangeContext(target, others, data, region, screens) : null;
        if (cancelled) return;
        setCtx({
          count: ctx ? ctx.fluid.length : 0,
          targetName: target ? target.appName : "未找到目标窗口",
          hasSnapshot: !!(data.snapshot && data.snapshot.frames.length > 0),
          snapshotCount: data.snapshot?.frames.length ?? 0,
        });
      } catch {
        if (!cancelled) setCtx({ count: 0, targetName: "?", hasSnapshot: false, snapshotCount: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    memory.arrangeRecent((id) => {
      const t = templateById(id);
      return !!t && !t.special;
    }).then(setRecent);
  }, []);

  const defaultId = ctx ? defaultTemplateFor(ctx.count)?.id : undefined;

  const orderedTemplates = ctx ? templatesForOrdered(ctx.count, recent).ordered : [];

  const run = async (tmplId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await runArrange(tmplId);
      await notify(result, { close: result.ok });
      if (tmplId === "save-layout" && result.ok) {
        setCtx((c) => (c ? { ...c, hasSnapshot: true, snapshotCount: c.count } : c));
      }
      if (result.ok) {
        memory.arrangeRecent((id) => !!templateById(id) && !templateById(id)!.special).then(setRecent);
      }
    } finally {
      setBusy(false);
    }
  };

  const deleteSnap = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const confirmed = await confirmAlert({
        title: "删除「我的布局」?",
        message: "将删除上次保存的整屏摆放，此操作不可撤销。",
        primaryAction: { title: "删除", style: Alert.ActionStyle.Destructive },
        dismissAction: { title: "取消" },
      });
      if (!confirmed) return;
      const result = await deleteMyLayout();
      await notify(result);
      setRefresh((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  if (!ctx) {
    return <List isLoading />;
  }

  return (
    <List isLoading={busy} navigationTitle="自动排布" searchBarPlaceholder="搜索模板（如：分屏、网格、叠放）">
      <List.Section title="用户自设方案">
        <List.Item
          key="save-layout"
          title="保存当前布局"
          subtitle="记录现在的摆放, 之后按槽位顺序重放"
          icon={{ source: Icon.SaveDocument, tintColor: { light: "#8e5cf6", dark: "#8e5cf6", adjustContrast: false } }}
          actions={
            <ActionPanel>
              <Action title="保存当前布局" icon={Icon.SaveDocument} onAction={() => run("save-layout")} />
            </ActionPanel>
          }
        />
        {ctx.hasSnapshot ? (
          <List.Item
            key="replay-layout"
            title="重放我的布局"
            subtitle={`上次 ${ctx.snapshotCount} 窗的摆放, 按窗口顺序简单套用`}
            icon={{ source: Icon.RotateClockwise, tintColor: { light: "#c67424", dark: "#c67424", adjustContrast: false } }}
            actions={
              <ActionPanel>
                <Action title="重放我的布局" icon={Icon.RotateClockwise} onAction={() => run("replay-layout")} />
                <Action
                  title="删除「我的布局」"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={deleteSnap}
                />
              </ActionPanel>
            }
          />
        ) : null}
      </List.Section>
      <List.Section title="默认方案">
        {orderedTemplates.map((t) => (
          <List.Item
            key={t.id}
            title={t.name}
            subtitle={
              (recent.includes(t.id) ? "最近 · " : "") + (t.id === defaultId ? "默认" : "") + ` · ${ctx.count} 窗`
            }
            icon={{ source: Icon.AppWindowGrid2x2, tintColor: { light: "#3478f6", dark: "#3478f6", adjustContrast: false } }}
            actions={
              <ActionPanel>
                <Action title="套用模板" icon={Icon.Checkmark} onAction={() => run(t.id)} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      {orderedTemplates.length === 0 ? (
        <List.EmptyView title="没有适用的模板" description="当前弹性窗口数没有匹配的排布模板" />
      ) : null}
    </List>
  );
}