import { describe, expect, test } from "bun:test";
import { ANGLES_DEG, RADAR_VIEWBOX, axisLabelPos, axisPoint, polygonPoints, ringPoints } from "./radar.ts";

describe("radar geometry", () => {
  test("angles", () => {
    expect(ANGLES_DEG).toEqual([-90, -30, 30, 90, 150, 210]);
  });
  test("viewBox has side room for labels", () => {
    expect(RADAR_VIEWBOX).toBe("-70 -5 440 310");
  });
  test("axisPoint", () => {
    expect(axisPoint(0, 100)).toEqual([150, 40]);
    expect(axisPoint(1, 61)).toEqual([208.1, 116.5]);
    expect(axisPoint(3, null)).toEqual([150, 150]);
    expect(axisPoint(3, 0)).toEqual([150, 150]);
  });
  test("polygon for the canvas sample", () => {
    expect(polygonPoints([82, 61, 88, null, 55, 74])).toBe("150,59.8 208.1,116.5 233.8,198.4 150,150 97.6,180.3 79.5,109.3");
    expect(polygonPoints([100, 71, 66, 72, 38, 58])).toBe("150,40 217.6,111 212.9,186.3 150,229.2 113.8,170.9 94.7,118.1");
  });
  test("rings", () => {
    expect(ringPoints(100)).toBe("150,40 245.3,95 245.3,205 150,260 54.7,205 54.7,95");
    expect(ringPoints(25)).toBe("150,122.5 173.8,136.3 173.8,163.8 150,177.5 126.2,163.8 126.2,136.3");
  });
  test("label anchors by quadrant", () => {
    expect(axisLabelPos(0)).toEqual({ x: 150, y: 18, anchor: "middle" });
    expect(axisLabelPos(1)).toEqual({ x: 264.3, y: 84, anchor: "start" });
    expect(axisLabelPos(3)).toEqual({ x: 150, y: 282, anchor: "middle" });
    expect(axisLabelPos(4)).toEqual({ x: 35.7, y: 216, anchor: "end" });
  });
});
