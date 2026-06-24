import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretjwtkeyforstockdashboardintraday2026";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "anotherrefreshsecretjwtkeyforstockdashboardintraday2026";

export interface TokenPayload {
  userId: string;
}

export const generateAccessToken = (userId: string): string => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "15m" });
};

export const generateRefreshToken = (userId: string): string => {
  return jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: "7d" });
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
};

export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
};
