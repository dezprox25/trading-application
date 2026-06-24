import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/token";
import redis from "../config/redis";

// Custom request interface to append authenticated user context
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
  };
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Access denied. No token provided." });
    }

    const token = authHeader.split(" ")[1];

    // Check if token is blacklisted in Redis (logged-out tokens)
    let isBlacklisted = null;
    try {
      isBlacklisted = await redis.get(`blacklist:${token}`);
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        throw err;
      }
      console.warn("[Auth Middleware] Failed to check token blacklist in Redis (Redis may be offline). Proceeding without blacklist check.");
    }
    if (isBlacklisted) {
      return res
        .status(401)
        .json({ error: "Session revoked. Please log in again." });
    }

    const decoded = verifyAccessToken(token);
    req.user = { id: decoded.userId };
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired access token." });
  }
};
