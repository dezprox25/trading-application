import mongoose from "mongoose";

export const connectDB = async (): Promise<void> => {
  const mongoUri =
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017/stock_dashboard";

  mongoose.set("bufferCommands", false);

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 1500,
  });

  console.log("MongoDB connected successfully to:", mongoUri);
};