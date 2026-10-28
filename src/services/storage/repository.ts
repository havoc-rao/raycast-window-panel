// 当前布局文件与 MRU 存储实例；统一连接偏好路径和持久化实现。
import type { LayoutsData } from "../../domain/types";
import { layoutsFilePath } from "../preferences";
import { MemoryStore, readLayoutsFile, writeLayoutsFile } from "./layouts";
import { raycastKV } from "./raycast-kv";

export const memory = new MemoryStore(raycastKV);

export function loadLayouts(): LayoutsData {
  return readLayoutsFile(layoutsFilePath());
}

export function persistLayouts(data: LayoutsData): void {
  writeLayoutsFile(layoutsFilePath(), data);
}
