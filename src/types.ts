// 纯 TS 核心类型（零 Raycast 依赖，供 vitest 与命令层共用）

/** 窗口/帧几何：位置 + 尺寸（与 hs.geometry 的 x/y/w/h 语义一致） */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 屏幕可用区域（整屏 frame，原版用 screen:frame()） */
export interface Region extends Frame {}

/** 屏幕（clampFrame 安全网与多屏区域用） */
export interface Screen {
  frame: Frame;
}

/** 单窗口记忆记录（数据模型 v2 的 windows 表条目） */
export interface WindowRecord {
  /** 会话内窗口句柄：本实现写入 "pid|index"；读入的旧 Hammerspoon 数据为数字 CGWindowID（兼容保留） */
  id?: string | number;
  bundleID: string;
  title: string;
  frame: Frame;
}

/** 整屏快照（纯槽位，不含 App 身份） */
export interface Snapshot {
  savedAt: number;
  count: number;
  frames: Frame[];
}

/** 数据文件布局（window-layouts.json，schema 沿用原版 v2） */
export interface LayoutsData {
  windows: Record<string, WindowRecord>;
  snapshot?: Snapshot;
}

/** Provider 暴露的窗口对象（windows.ts 接口的返回类型） */
export interface TargetWindow {
  /** 稳定句柄：进程 unix id + 窗口索引（如 "12345|1"） */
  id: string;
  appName: string;
  bundleId: string;
  title: string;
  bounds: Frame;
  fullScreen: boolean;
  positionable: boolean;
  resizable: boolean;
}

/** 排布模板（layoutTemplates 注册表条目；special 为「我的布局」特殊项） */
export interface Template {
  id: string;
  name: string;
  eng: string;
  keywords: string;
  minN?: number;
  maxN?: number;
  order: number;
  accent?: string;
  subText?: string;
  special?: "save" | "replay";
  group?: string;
  fn?: (n: number, region: Region) => Frame[];
}

export interface KVStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}