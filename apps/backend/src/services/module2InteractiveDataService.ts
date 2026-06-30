export type Module2DataSource = "LIVE_INTERACTIVE_API" | "UNAVAILABLE";

const isPlaceholder = (value?: string) =>
  !value || value.includes("your-") || value.includes("placeholder");

export const getModule2MissingInteractiveConfig = () => {
  const missing: string[] = [];

  if (isPlaceholder(process.env.MOD2_API_KEY)) missing.push("MOD2_API_KEY");
  if (isPlaceholder(process.env.MOD2_API_SECRET)) missing.push("MOD2_API_SECRET");
  if (isPlaceholder(process.env.AETRAM_MARKETDATA_API_BASE_URL)) missing.push("AETRAM_MARKETDATA_API_BASE_URL");
  if (isPlaceholder(process.env.AETRAM_MARKETDATA_AUTH_URL)) missing.push("AETRAM_MARKETDATA_AUTH_URL");

  return missing;
};

export const getModule2DataSource = (): Module2DataSource =>
  getModule2MissingInteractiveConfig().length === 0 ? "LIVE_INTERACTIVE_API" : "UNAVAILABLE";

export const logModule2InteractiveStatus = () => {
  const missing = getModule2MissingInteractiveConfig();
  if (missing.length === 0) {
    console.log("[Module2] MarketData API configured.");
    return;
  }
  console.log(`[Module2] MarketData API not fully configured — missing: ${missing.join(", ")}`);
};
