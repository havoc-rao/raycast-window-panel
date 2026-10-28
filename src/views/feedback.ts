// Raycast 展示反馈；服务层只返回 ActionResult，不依赖这里。
import { closeMainWindow, showToast, Toast } from "@raycast/api";
import type { ActionResult } from "../services/action-result";

export async function notify(result: ActionResult, opts?: { close?: boolean; title?: string }): Promise<void> {
  await showToast({
    style: result.ok ? Toast.Style.Success : Toast.Style.Failure,
    title: opts?.title ?? result.message,
  });
  if (result.ok && opts?.close) await closeMainWindow();
}
