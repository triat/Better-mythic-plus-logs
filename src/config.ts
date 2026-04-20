export const config = {
  get clientId(): string {
    return (process.env.WCL_CLIENT_ID ?? "").trim();
  },
  get clientSecret(): string {
    return (process.env.WCL_CLIENT_SECRET ?? "").trim();
  },
  oauthUrl: "https://www.warcraftlogs.com/oauth/token",
  graphqlUrl: "https://www.warcraftlogs.com/api/v2/client",
  region: "EU" as const,
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
