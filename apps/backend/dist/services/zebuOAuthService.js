"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZebuOAuthStatus = exports.resolveZebuSessionToken = exports.getCachedZebuSessionToken = exports.buildZebuAuthorizeUrl = exports.hasZebuOAuthConfig = exports.getZebuOAuthMissingConfig = exports.setZebuAuthCode = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const sha256 = (text) => {
    return crypto_1.default.createHash("sha256").update(text).digest("hex");
};
let inMemorySessionToken = null;
let inMemoryAuthCode = null;
const isPlaceholder = (value) => !value || value.includes("your-") || value.includes("placeholder");
const getClientId = () => process.env.ZEBU_CLIENT_ID || "";
const getUserId = () => process.env.ZEBU_USER_ID || getClientId();
const getApiKey = () => process.env.MOD1_API_KEY || process.env.BROKER_API_KEY || "";
const getApiSecret = () => process.env.MOD1_API_SECRET || process.env.BROKER_API_SECRET || "";
const getRedirectUrl = () => process.env.ZEBU_REDIRECT_URL || process.env.REDIRECT_URL || "";
const getTokenUrl = () => process.env.ZEBU_OAUTH_TOKEN_URL || "";
const getAuthorizeUrl = () => process.env.ZEBU_OAUTH_AUTHORIZE_URL || "";
const getAuthCode = () => inMemoryAuthCode || process.env.ZEBU_AUTH_CODE || "";
const setZebuAuthCode = (code) => {
    inMemoryAuthCode = code;
};
exports.setZebuAuthCode = setZebuAuthCode;
const getZebuOAuthMissingConfig = () => {
    const missing = [];
    if (isPlaceholder(getClientId()))
        missing.push("ZEBU_CLIENT_ID");
    if (isPlaceholder(getApiKey()))
        missing.push("MOD1_API_KEY or BROKER_API_KEY");
    if (isPlaceholder(getApiSecret()))
        missing.push("MOD1_API_SECRET or BROKER_API_SECRET");
    if (isPlaceholder(getRedirectUrl()))
        missing.push("ZEBU_REDIRECT_URL or REDIRECT_URL");
    if (isPlaceholder(getTokenUrl()))
        missing.push("ZEBU_OAUTH_TOKEN_URL");
    if (isPlaceholder(getAuthCode()))
        missing.push("ZEBU_AUTH_CODE or callback code");
    return missing;
};
exports.getZebuOAuthMissingConfig = getZebuOAuthMissingConfig;
const hasZebuOAuthConfig = () => (0, exports.getZebuOAuthMissingConfig)().length === 0;
exports.hasZebuOAuthConfig = hasZebuOAuthConfig;
const buildZebuAuthorizeUrl = () => {
    const authorizeUrl = getAuthorizeUrl();
    if (isPlaceholder(authorizeUrl))
        return null;
    const url = new URL(authorizeUrl);
    url.searchParams.set("client_id", getClientId());
    url.searchParams.set("userid", getUserId());
    url.searchParams.set("redirect_uri", getRedirectUrl());
    url.searchParams.set("response_type", "code");
    return url.toString();
};
exports.buildZebuAuthorizeUrl = buildZebuAuthorizeUrl;
const extractSessionToken = (payload) => payload?.susertoken ||
    payload?.sessionToken ||
    payload?.session_token ||
    payload?.access_token ||
    payload?.token ||
    payload?.data?.susertoken ||
    payload?.data?.sessionToken ||
    payload?.data?.access_token;
const getCachedZebuSessionToken = () => inMemorySessionToken;
exports.getCachedZebuSessionToken = getCachedZebuSessionToken;
const resolveZebuSessionToken = async () => {
    if (inMemorySessionToken)
        return inMemorySessionToken;
    const envToken = process.env.ZEBU_SUSERTOKEN || process.env.ZEBU_SESSION_TOKEN;
    if (!isPlaceholder(envToken)) {
        inMemorySessionToken = envToken;
        return inMemorySessionToken;
    }
    // 1. Try QuickAuth Direct Login first if credentials exist
    const uid = (process.env.ZEBU_USER_ID || process.env.ZEBU_CLIENT_ID || "").trim();
    const pwd = (process.env.ZEBU_PASSWORD || "").trim();
    const factor2 = (process.env.ZEBU_FACTOR2 || "").trim();
    const vc = (process.env.ZEBU_VENDOR_CODE || "").trim();
    const appkey = (process.env.MOD1_API_KEY || process.env.BROKER_API_KEY || "").trim();
    const loginUrl = (process.env.ZEBU_LOGIN_URL || "").trim();
    if (uid && pwd && factor2 && vc && appkey && loginUrl) {
        try {
            console.log("[ZebuAuth] Attempting direct QuickAuth login...");
            const pwdHash = sha256(pwd);
            const appkeyHash = sha256(`${uid}|${appkey}`);
            const payload = {
                apkversion: "1.0.0",
                uid,
                pwd: pwdHash,
                factor2,
                imei: (process.env.ZEBU_IMEI || "abc1234").trim(),
                source: "API",
                vc,
                appkey: appkeyHash
            };
            const dataString = `jData=${JSON.stringify(payload)}`;
            const response = await axios_1.default.post(loginUrl, dataString, {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            });
            if (response.data && response.data.stat === "Ok" && response.data.susertoken) {
                console.log("[ZebuAuth] QuickAuth login successful.");
                inMemorySessionToken = response.data.susertoken;
                return inMemorySessionToken;
            }
            else {
                console.warn("[ZebuAuth] QuickAuth login failed, response:", response.data);
            }
        }
        catch (err) {
            console.error("[ZebuAuth] QuickAuth login error:", err?.message || err);
        }
    }
    if (!(0, exports.hasZebuOAuthConfig)())
        return null;
    const brokerApiKey = `${getUserId()}:::${getClientId()}`;
    const response = await axios_1.default.post(getTokenUrl(), {
        code: getAuthCode(),
        redirect_uri: getRedirectUrl(),
        grant_type: "authorization_code",
        client_id: getClientId(),
        api_key: getApiKey(),
        broker_api_key: brokerApiKey,
    }, {
        headers: {
            "Content-Type": "application/json",
            "x-api-key": getApiKey(),
            "x-api-secret": getApiSecret(),
            "x-broker-api-key": brokerApiKey,
            "x-broker-api-secret": getApiSecret(),
        },
    });
    const token = extractSessionToken(response.data);
    if (!token || typeof token !== "string") {
        throw new Error("Zebu OAuth token response did not include a session token.");
    }
    inMemorySessionToken = token;
    return inMemorySessionToken;
};
exports.resolveZebuSessionToken = resolveZebuSessionToken;
const getZebuOAuthStatus = () => ({
    hasCachedSessionToken: Boolean(inMemorySessionToken),
    authorizeUrl: (0, exports.buildZebuAuthorizeUrl)(),
    missing: (0, exports.getZebuOAuthMissingConfig)(),
});
exports.getZebuOAuthStatus = getZebuOAuthStatus;
