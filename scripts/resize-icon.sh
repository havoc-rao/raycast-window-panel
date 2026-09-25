#!/bin/bash
# 将扩展图标缩放为 512×512（Raycast 商店发布要求）。
# 用法: ./scripts/resize-icon.sh [路径]   （默认 assets/logo.png）
# 幂等：已是 512×512 的图标会跳过，不重复处理。
set -euo pipefail

cd "$(dirname "$0")/.."
ICON="${1:-assets/logo.png}"

if [ ! -f "$ICON" ]; then
  echo "错误：未找到 $ICON" >&2
  exit 1
fi

CURRENT_W=$(sips -g pixelWidth "$ICON" | awk '/pixelWidth/{print $2}')
CURRENT_H=$(sips -g pixelHeight "$ICON" | awk '/pixelHeight/{print $2}')
echo "当前尺寸: ${CURRENT_W:-?}×${CURRENT_H:-?}"

if [ "${CURRENT_W:-0}" = "512" ] && [ "${CURRENT_H:-0}" = "512" ]; then
  echo "已是 512×512，无需处理"
  exit 0
fi

# sips -z <height> <width>：按比例之外的显式尺寸重采样（这里等比 512×512）
sips -z 512 512 "$ICON" --out "$ICON" >/dev/null

echo "已缩放为 512×512:"
sips -g pixelWidth -g pixelHeight "$ICON"
echo "文件大小: $(stat -f '%z' "$ICON") bytes"