import type { Region } from "./wow/regions.ts";
import { parseRegion } from "./wow/regions.ts";

let warnedInvalidRegion = false;

export const config = {
  get clientId(): string {
    return (process.env.WCL_CLIENT_ID ?? "").trim();
  },
  get clientSecret(): string {
    return (process.env.WCL_CLIENT_SECRET ?? "").trim();
  },
  oauthUrl: "https://www.warcraftlogs.com/oauth/token",
  graphqlUrl: "https://www.warcraftlogs.com/api/v2/client",
  get region(): Region {
    const raw = process.env.BMPL_REGION;
    const parsed = parseRegion(raw);
    if (parsed) return parsed;
    if (raw !== undefined && raw !== "" && !warnedInvalidRegion) {
      warnedInvalidRegion = true;
      console.error(`bmpl: ignoring BMPL_REGION="${raw}": expected one of eu, us, kr, tw`);
    }
    return "eu";
  },
};

export const hasCredentials = (): boolean =>
  Boolean(config.clientId && config.clientSecret);

export const requireCredentials = (): void => {
  if (!hasCredentials()) {
    throw new Error(
      "Missing WCL_CLIENT_ID / WCL_CLIENT_SECRET. Fill them in .env, " +
        "or run `bmpl serve` for a guided setup.",
    );
  }
};
