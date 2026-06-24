// Core mathematical formulas for rendering historical signals in grid rows

export interface CalculatedPivots {
  p: number;
  r1: number;
  r2: number;
  r3: number;
  r4?: number;
  s1: number;
  s2: number;
  s3: number;
  s4?: number;
}

export const getClassicPivots = (H: number, L: number, C: number): CalculatedPivots => {
  const p = (H + L + C) / 3;
  return {
    p,
    r1: 2 * p - L,
    r2: p + (H - L),
    r3: H + 2 * (p - L),
    s1: 2 * p - H,
    s2: p - (H - L),
    s3: L - 2 * (H - p),
  };
};

export const getCamarillaPivots = (H: number, L: number, C: number): CalculatedPivots => {
  const range = H - L;
  return {
    p: C,
    r4: C + (range * 1.1) / 2,
    r3: C + (range * 1.1) / 4,
    r2: C + (range * 1.1) / 6,
    r1: C + (range * 1.1) / 12,
    s1: C - (range * 1.1) / 12,
    s2: C - (range * 1.1) / 6,
    s3: C - (range * 1.1) / 4,
    s4: C - (range * 1.1) / 2,
  };
};

export const getFibonacciPivots = (H: number, L: number, C: number): CalculatedPivots => {
  const p = (H + L + C) / 3;
  const range = H - L;
  return {
    p,
    r1: p + 0.382 * range,
    r2: p + 0.618 * range,
    r3: p + 1.000 * range,
    s1: p - 0.382 * range,
    s2: p - 0.618 * range,
    s3: p - 1.000 * range,
  };
};

export const getCallState = (ltp: number, p: number, r1: number, s1: number, spotLtp: number): string => {
  const div = (Math.abs(spotLtp - ltp) / spotLtp) * 100;
  if (div > 0.5) return "DIVERGENCE_WARNING";
  if (ltp > r1) return "CALL_BULLISH";
  if (ltp > r1 * 0.998) return "CALL_NEAR_RESISTANCE";
  if (ltp > p) return "CALL_POSITIVE_BIAS";
  if (Math.abs(ltp - p) / p < 0.001) return "CALL_NEUTRAL";
  if (ltp > s1) return "CALL_BEARISH_BIAS";
  return "CALL_BEARISH";
};

export const getPutState = (ltp: number, p: number, r1: number, s1: number, spotLtp: number): string => {
  const div = (Math.abs(spotLtp - ltp) / spotLtp) * 100;
  if (div > 0.5) return "SENTIMENT_ALERT";
  if (ltp < s1) return "PUT_BULLISH";
  if (ltp < s1 * 1.002) return "PUT_NEAR_SUPPORT";
  if (ltp < p) return "PUT_POSITIVE_BIAS";
  if (Math.abs(ltp - p) / p < 0.001) return "PUT_NEUTRAL";
  if (ltp < r1) return "PUT_BEARISH_BIAS";
  return "PUT_BEARISH";
};
