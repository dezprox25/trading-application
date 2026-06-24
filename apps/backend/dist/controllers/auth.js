"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.me = exports.logout = exports.refresh = exports.login = exports.register = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = require("../models/User");
const Watchlist_1 = require("../models/Watchlist");
const shared_1 = require("@stock/shared");
const token_1 = require("../utils/token");
const redis_1 = __importDefault(require("../config/redis"));
// Helper to parse cookies manually from raw header
const getCookie = (req, name) => {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader)
        return null;
    const cookies = cookieHeader.split(";").reduce((acc, curr) => {
        const [k, v] = curr.split("=");
        if (k && v) {
            acc[k.trim()] = decodeURIComponent(v.trim());
        }
        return acc;
    }, {});
    return cookies[name] || null;
};
// Local in-memory users store for when MongoDB is offline
const inMemoryUsers = new Map();
// Pre-seed a default guest user so the user doesn't strictly have to register
bcrypt_1.default.hash("password123", 12).then(hashed => {
    inMemoryUsers.set("60c72b2f9b1d8a0015f8e567", {
        _id: "60c72b2f9b1d8a0015f8e567",
        username: "guest",
        password: hashed,
        name: "Guest User",
        status: "active"
    });
});
// User Registration — saves user active, no OTP
const register = async (req, res) => {
    try {
        const parseResult = shared_1.RegisterSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
        }
        const { username, password, name } = parseResult.data;
        let existingUser = null;
        try {
            existingUser = await User_1.User.findOne({ username });
        }
        catch (dbErr) {
            console.warn("[Auth] MongoDB offline. Checking in-memory users.");
            existingUser = Array.from(inMemoryUsers.values()).find(u => u.username === username);
        }
        if (existingUser) {
            return res.status(409).json({ error: "Username is already registered" });
        }
        const hashedPassword = await bcrypt_1.default.hash(password, 12);
        let newUser;
        try {
            newUser = await User_1.User.create({
                username,
                password: hashedPassword,
                name: name || username,
                status: "active",
            });
            await Watchlist_1.Watchlist.create({
                user_id: newUser._id,
                symbols_json: [],
                column_prefs_json: {},
            });
        }
        catch (dbErr) {
            console.warn("[Auth] MongoDB offline. Registering user in memory.");
            const mockId = "mock-user-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
            newUser = {
                _id: mockId,
                username: password ? hashedPassword : "", // just for safety
                password: hashedPassword,
                name: name || username,
                status: "active",
            };
            // Keep it in both locations
            newUser.username = username;
            inMemoryUsers.set(mockId, newUser);
        }
        // Auto-login with JWT
        const accessToken = (0, token_1.generateAccessToken)(newUser._id.toString());
        const refreshToken = (0, token_1.generateRefreshToken)(newUser._id.toString());
        res.cookie("refresh", refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
        return res.status(201).json({
            message: "Account created successfully!",
            accessToken,
            user: {
                id: newUser._id,
                username: newUser.username,
                name: newUser.name || newUser.username,
            },
        });
    }
    catch (error) {
        console.error("Registration Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.register = register;
// User Login — checks username and password, returns JWT
const login = async (req, res) => {
    try {
        const parseResult = shared_1.LoginSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
        }
        const { username, password } = parseResult.data;
        let user = null;
        try {
            user = await User_1.User.findOne({ username });
        }
        catch (dbErr) {
            console.warn("[Auth] MongoDB offline. Authenticating via in-memory users.");
            user = Array.from(inMemoryUsers.values()).find(u => u.username === username);
        }
        if (!user) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const match = await bcrypt_1.default.compare(password, user.password);
        if (!match || user.status === "inactive") {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const accessToken = (0, token_1.generateAccessToken)(user._id.toString());
        const refreshToken = (0, token_1.generateRefreshToken)(user._id.toString());
        res.cookie("refresh", refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
        return res.status(200).json({
            accessToken,
            user: {
                id: user._id,
                username: user.username,
                name: user.name || user.username,
            },
        });
    }
    catch (error) {
        console.error("Login Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.login = login;
// Token Refresh
const refresh = async (req, res) => {
    try {
        const refreshToken = getCookie(req, "refresh");
        if (!refreshToken) {
            return res.status(401).json({ error: "Refresh token not provided" });
        }
        const decoded = (0, token_1.verifyRefreshToken)(refreshToken);
        let user = null;
        try {
            user = await User_1.User.findById(decoded.userId);
        }
        catch (dbErr) {
            console.warn("[Auth] MongoDB offline. Finding user in-memory for refresh.");
            user = inMemoryUsers.get(decoded.userId);
        }
        if (!user || user.status === "inactive") {
            return res.status(401).json({ error: "User is no longer active" });
        }
        const newAccessToken = (0, token_1.generateAccessToken)(user._id.toString());
        return res.status(200).json({
            accessToken: newAccessToken,
            user: {
                id: user._id,
                username: user.username,
                name: user.name || user.username,
            },
        });
    }
    catch (error) {
        console.error("Token Refresh Error:", error);
        return res.status(401).json({ error: "Invalid or expired refresh token" });
    }
};
exports.refresh = refresh;
// User Logout
const logout = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.split(" ")[1];
            try {
                const decoded = jsonwebtoken_1.default.decode(token);
                if (decoded && decoded.exp) {
                    const ttl = Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
                    if (ttl > 0) {
                        await redis_1.default.setex(`blacklist:${token}`, ttl, "1");
                    }
                }
            }
            catch (_) { }
        }
        res.clearCookie("refresh", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
        });
        return res.status(200).json({ message: "Logged out successfully" });
    }
    catch (error) {
        console.error("Logout Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.logout = logout;
// GET /api/auth/me
const me = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        let user = null;
        try {
            user = await User_1.User.findById(userId);
        }
        catch (dbErr) {
            console.warn("[Auth] MongoDB offline. Finding user in-memory for me.");
            user = inMemoryUsers.get(userId);
        }
        if (!user || user.status === "inactive") {
            return res.status(404).json({ error: "User not found or inactive" });
        }
        return res.status(200).json({
            user: {
                id: user._id,
                username: user.username,
                name: user.name || user.username,
            },
        });
    }
    catch (error) {
        console.error("Get Me Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};
exports.me = me;
