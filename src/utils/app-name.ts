/** 记忆数据不保存 App 名称，用 Bundle ID 的最后一节生成短名。 */
export function shortAppName(bundleId: string): string {
  const seg = bundleId.split(".").filter(Boolean);
  const last = seg[seg.length - 1] ?? bundleId;
  return last.charAt(0).toUpperCase() + last.slice(1);
}
