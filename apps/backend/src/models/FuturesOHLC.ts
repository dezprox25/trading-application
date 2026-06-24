import { model } from "mongoose";
import { FuturesOHLCSchema } from "../schemas/FuturesOHLCSchema";

export const FuturesOHLC = model("FuturesOHLC", FuturesOHLCSchema);
