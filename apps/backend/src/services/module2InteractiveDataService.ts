export type Module2DataSource = "LIVE_INTERACTIVE_API" | "UNAVAILABLE";

const isPlaceholder = (value?: string) =>
  !value || value.includes("your-") || value.includes("placeholder");

const getInteractiveBaseUrl = () =>
  process.env.AETRAM_INTERACTIVE_API_BASE_URL || process.env.MOD2_INTERACTIVE_API_BASE_URL || "";

const getInteractiveAuthUrl = () =>
  process.env.AETRAM_INTERACTIVE_AUTH_URL || process.env.MOD2_INTERACTIVE_AUTH_URL || "";

export const getModule2MissingInteractiveConfig = () => {
  const missing: string[] = [];

  const key = process.env.MOD2_INTERACTIVE_API_KEY || process.env.MOD2_API_KEY;
  const secret = process.env.MOD2_INTERACTIVE_API_SECRET || process.env.MOD2_API_SECRET;

  if (isPlaceholder(key)) missing.push("MOD2_INTERACTIVE_API_KEY");
  if (isPlaceholder(secret)) missing.push("MOD2_INTERACTIVE_API_SECRET");
  if (isPlaceholder(getInteractiveBaseUrl())) {
    missing.push("AETRAM_INTERACTIVE_API_BASE_URL or MOD2_INTERACTIVE_API_BASE_URL");
  }
  if (isPlaceholder(getInteractiveAuthUrl())) {
    missing.push("AETRAM_INTERACTIVE_AUTH_URL or MOD2_INTERACTIVE_AUTH_URL");
  }

  return missing;
};

export const getModule2DataSource = (): Module2DataSource =>
  getModule2MissingInteractiveConfig().length === 0 ? "LIVE_INTERACTIVE_API" : "UNAVAILABLE";

export const logModule2InteractiveStatus = () => {
  console.log("[Module2] Authenticating with Interactive Data API");

  const missing = getModule2MissingInteractiveConfig();
  if (missing.length === 0) {
    console.log("[Module2] Live data connected");
    return;
  }

  console.log(`[Module2] Live data unavailable: missing ${missing.join(", ")}`);
};
