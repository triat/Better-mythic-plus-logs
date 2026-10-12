import { describe, expect, test } from "bun:test";
import { AXIS_ORDER } from "./verdict.ts";
import { ANGLES_DEG, RADAR_VIEWBOX, axisLabelPos, axisPoint, polygonPoints, ringPoints } from "./radar.ts";

describe("radar geometry", () => {
  test("angles", () => {
    expect(ANGLES_DEG).toEqual([-90, -18, 54, 126, 198]);
    expect(ANGLES_DEG.length).toBe(AXIS_ORDER.length);
  });
  test("viewBox has side room for labels", () => {
    expect(RADAR_VIEWBOX).toBe("-70 -5 440 310");
  });
  test("axisPoint", () => {
    expect(axisPoint(0, 100)).toEqual([150, 40]);
    expect(axisPoint(1, 61)).toEqual([213.8, 129.3]);
    expect(axisPoint(3, null)).toEqual([150, 150]);
    expect(axisPoint(3, 0)).toEqual([150, 150]);
  });
  test("polygon for the canvas sample", () => {
    expect(polygonPoints([82, 61, 88, null, 55])).toBe("150,59.8 213.8,129.3 206.9,228.3 150,150 92.5,131.3");
    expect(polygonPoints([100, 71, 66, 72, 38])).toBe("150,40 224.3,125.9 192.7,208.7 103.4,214.1 110.2,137.1");
  });
  test("rings", () => {
    expect(ringPoints(100)).toBe("150,40 254.6,116 214.7,239 85.3,239 45.4,116");
    expect(ringPoints(25)).toBe("150,122.5 176.2,141.5 166.2,172.2 133.8,172.2 123.8,141.5");
  });
  test("label anchors by quadrant", () => {
    expect(axisLabelPos(0)).toEqual({ x: 150, y: 18, anchor: "middle" });
    expect(axisLabelPos(1)).toEqual({ x: 275.5, y: 109.2, anchor: "start" });
    expect(axisLabelPos(3)).toEqual({ x: 72.4, y: 256.8, anchor: "end" });
    expect(axisLabelPos(4)).toEqual({ x: 24.5, y: 109.2, anchor: "end" });
  });
});
