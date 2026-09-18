import { describe, expect, test } from "bun:test";
import { ESTIMATE_DEEPDIVE, ESTIMATE_RANKINGS, ESTIMATE_RUN, PointsMeter } from "../../src/wcl/meter.ts";
import type { UsageSink } from "../../src/wcl/meter.ts";

const rl = (spent: number, resetIn = 1800) => ({ limitPerHour: 3600, pointsSpentThisHour: spent, pointsResetIn: resetIn });

function setup(start = 1_000_000) {
  let t = start;
  const adds: Array<[number, number, number]> = [];
  const usage: UsageSink = { add: (userId, at, points) => { adds.push([userId, at, points]); } };
  const meter = new PointsMeter({ usage, now: () => t });
  return { meter, adds, tick: (ms: number) => { t += ms; }, now: () => t };
}

describe("PointsMeter", () => {
  test("estimates are the documented constants", () => {
    expect([ESTIMATE_RANKINGS, ESTIMATE_RUN, ESTIMATE_DEEPDIVE]).toEqual([10, 10, 3]);
  });

  test("the first observation primes; later deltas are charged to the running request and its user", async () => {
    const { meter, adds, now } = setup();
    meter.observe(rl(100));
    expect(adds).toEqual([]);
    expect(meter.snapshot()?.pointsSpentThisHour).toBe(100);
    const spent = await meter.run(7, async () => {
      meter.observe(rl(110));
      meter.observe(rl(112.5));
      return meter.charge()!.spent;
    });
    expect(spent).toBe(12.5);
    expect(adds).toEqual([[7, now(), 10], [7, now(), 2.5]]);
    expect(meter.charge()).toBeUndefined();
  });

  test("an unattributed run (userId null) charges the request but not the usage sink", async () => {
    const { meter, adds } = setup();
    meter.observe(rl(0));
    const spent = await meter.run(null, async () => { meter.observe(rl(3)); return meter.charge()!.spent; });
    expect(spent).toBe(3);
    expect(adds).toEqual([]);
  });

  test("observations outside any run update the snapshot without charging anyone", () => {
    const { meter, adds } = setup();
    meter.observe(rl(0));
    meter.observe(rl(40));
    expect(adds).toEqual([]);
    expect(meter.snapshot()?.pointsSpentThisHour).toBe(40);
  });

  test("concurrent requests are attributed separately", async () => {
    const { meter, adds } = setup();
    meter.observe(rl(0));
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const a = meter.run(1, async () => { meter.observe(rl(10)); await gate; meter.observe(rl(25)); return meter.charge()!.spent; });
    const b = meter.run(2, async () => { meter.observe(rl(20)); return meter.charge()!.spent; });
    expect(await b).toBe(10);
    release();
    expect(await a).toBe(15); // 10 then 25−20
    expect(adds).toEqual([[1, 1_000_000, 10], [2, 1_000_000, 10], [1, 1_000_000, 5]]);
  });

  test("a late, lower counter in the same window charges nothing and does not lower the baseline", async () => {
    const { meter, adds } = setup();
    meter.observe(rl(50));
    await meter.run(1, async () => {
      meter.observe(rl(45)); // response that started before the 50 one, arriving late
      meter.observe(rl(52));
    });
    expect(adds).toEqual([[1, 1_000_000, 2]]);
    expect(meter.snapshot()?.pointsSpentThisHour).toBe(52);
  });

  test("a new WCL window starts when the previous resetIn has elapsed: the whole counter is new spend", async () => {
    const { meter, adds, tick, now } = setup();
    meter.observe(rl(3000, 60));
    tick(61_000);
    await meter.run(1, async () => { meter.observe(rl(8, 3599)); });
    expect(adds).toEqual([[1, now(), 8]]);
    expect(meter.snapshot()).toEqual({ ...rl(8, 3599), observedAt: now(), windowEnd: now() + 3_599_000 });
  });

  test("charges are rounded to a tenth of a point", async () => {
    const { meter } = setup();
    meter.observe(rl(0));
    const spent = await meter.run(1, async () => { meter.observe(rl(0.1 + 0.2)); meter.observe(rl(0.6)); return meter.charge()!.spent; });
    expect(spent).toBe(0.6);
  });

  test("wrap() observes every response that carries rateLimitData and ignores the others", async () => {
    const { meter, adds } = setup();
    meter.observe(rl(0));
    const fake = async <T,>(query: string) => (query === "ping" ? ({ rateLimitData: rl(4) } as unknown as T) : ({ rateLimitData: rl(9), reportData: {} } as unknown as T));
    const gql = meter.wrap(fake);
    await meter.run(3, async () => {
      expect(await gql<{ rateLimitData: unknown }>("ping")).toEqual({ rateLimitData: rl(4) });
      await gql("deepdive");
      await meter.wrap(async <T,>() => ({ worldData: {} } as T))("zones"); // no rateLimitData → ignored
    });
    expect(adds).toEqual([[3, 1_000_000, 4], [3, 1_000_000, 5]]);
  });
});
