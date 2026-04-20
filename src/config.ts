const required = (key: string): string => {
  const v = process.env[key];
  if (!v || v.trim() === "") {
    throw new Error(`Missing env var ${key}. Copy .env.example → .env and fill it in.`);
  }
  return v.trim();
};

export const config = {
  clientId: required("WCL_CLIENT_ID"),
  clientSecret: required("WCL_CLIENT_SECRET"),
  oauthUrl: "https://www.warcraftlogs.com/oauth/token",
  graphqlUrl: "https://www.warcraftlogs.com/api/v2/client",
  region: "EU" as const,
};
