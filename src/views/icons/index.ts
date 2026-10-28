import { Icon, type Image } from "@raycast/api";

/** 主菜单配色：浅色/深色模式保持一致，禁用 Raycast 自动调色。 */
const palette = {
  layout: "#3478f6",
  replay: "#bd4f8b",
  remember: "#24996f",
  forget: "#c93f4e",
  settings: "#687386",
} as const;

function tinted(source: Icon, color: string): Image.ImageLike {
  return {
    source,
    tintColor: { light: color, dark: color, adjustContrast: false },
  };
}

/** 按业务语义命名；菜单只引用这里，不直接管理图标形状和颜色。 */
export const panelIcons = {
  windowLayout: tinted(Icon.AppWindowSidebarLeft, palette.layout),
  arrange: tinted(Icon.AppWindowGrid2x2, palette.layout),
  replayApp: tinted(Icon.ArrowClockwise, palette.replay),
  rememberWindow: tinted(Icon.Bookmark, palette.remember),
  forgetWindow: tinted(Icon.MinusCircle, palette.forget),
  memories: tinted(Icon.AppWindowList, palette.remember),
  settings: tinted(Icon.Gear, palette.settings),
} as const;

/** 主菜单 ActionPanel 使用的通用图标。 */
export const panelActionIcons = {
  expand: Icon.ChevronRight,
  execute: Icon.Checkmark,
  delete: Icon.Trash,
  settings: Icon.Gear,
} as const;
