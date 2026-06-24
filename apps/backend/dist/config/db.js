"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const maskMongoUri = (uri) => {
    try {
        // Replace user:password@ with ***:***@ to avoid leaking credentials in logs
        return uri.replace(/:\/\/([^:@]+)(:[^@]+)?@/, "://***:***@");
    }
    catch {
        return "[configured]";
    }
};
const connectDB = async () => {
    const mongoUri = process.env.MONGODB_URI ||
        "mongodb://127.0.0.1:27017/stock_dashboard";
    mongoose_1.default.set("bufferCommands", false);
    await mongoose_1.default.connect(mongoUri, {
        serverSelectionTimeoutMS: 10000,
    });
    console.log("[DB] MongoDB connected:", maskMongoUri(mongoUri));
};
exports.connectDB = connectDB;
