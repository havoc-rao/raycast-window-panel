/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** 布局数据文件路径 - window-layouts.json 的路径（~ 自动展开）。默认使用本扩展独立数据目录 */
  "layoutsPath": string,
  /** 记录到此 App - 关闭后 save-window 不写盘（沿用原面板顶部开关） */
  "memoryTargetEnabled": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `window-panel` command */
  export type WindowPanel = ExtensionPreferences & {}
  /** Preferences accessible in the `window-layout` command */
  export type WindowLayout = ExtensionPreferences & {}
  /** Preferences accessible in the `arrange` command */
  export type Arrange = ExtensionPreferences & {}
  /** Preferences accessible in the `arrange-last` command */
  export type ArrangeLast = ExtensionPreferences & {}
  /** Preferences accessible in the `save-window` command */
  export type SaveWindow = ExtensionPreferences & {}
  /** Preferences accessible in the `forget-window` command */
  export type ForgetWindow = ExtensionPreferences & {}
  /** Preferences accessible in the `restore-app` command */
  export type RestoreApp = ExtensionPreferences & {}
  /** Preferences accessible in the `manage-memories` command */
  export type ManageMemories = ExtensionPreferences & {}
  /** Preferences accessible in the `import-from-hammerspoon` command */
  export type ImportFromHammerspoon = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `window-panel` command */
  export type WindowPanel = {}
  /** Arguments passed to the `window-layout` command */
  export type WindowLayout = {}
  /** Arguments passed to the `arrange` command */
  export type Arrange = {}
  /** Arguments passed to the `arrange-last` command */
  export type ArrangeLast = {}
  /** Arguments passed to the `save-window` command */
  export type SaveWindow = {}
  /** Arguments passed to the `forget-window` command */
  export type ForgetWindow = {}
  /** Arguments passed to the `restore-app` command */
  export type RestoreApp = {}
  /** Arguments passed to the `manage-memories` command */
  export type ManageMemories = {}
  /** Arguments passed to the `import-from-hammerspoon` command */
  export type ImportFromHammerspoon = {}
}

