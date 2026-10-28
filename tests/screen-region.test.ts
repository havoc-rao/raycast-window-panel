import { expect, it } from "vitest";
import { screenRegionForWindow } from "../src/utils/geometry";

const primary = { frame: { x: 0, y: 0, w: 1440, h: 900 } };
const external = { frame: { x: -1920, y: -300, w: 1920, h: 1080 }, visibleFrame: { x: -1920, y: -275, w: 1920, h: 1055 } };
it("selects the largest overlap even when window center lies in a gap", () => {
  expect(screenRegionForWindow({ x: -1800, y: -700, w: 1600, h: 800 }, [primary, external])).toEqual(external.visibleFrame);
});
it("uses current primary for a window left behind by a disconnected display", () => {
  expect(screenRegionForWindow({ x: -1800, y: -200, w: 800, h: 600 }, [primary])).toEqual(primary.frame);
});
it("fails closed when no real display measurement exists", () => {
  expect(screenRegionForWindow(primary.frame, [])).toBeNull();
});
it("returns a defensive copy", () => {
  const region = screenRegionForWindow(external.frame, [primary, external])!;
  region.w = 1;
  expect(external.visibleFrame.w).toBe(1920);
});
