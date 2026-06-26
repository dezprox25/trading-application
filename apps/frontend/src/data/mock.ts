import {
  OHLCBar, DashboardRow,
  clientPivot4Bar, classicPivot, mma, tla,
  computeRsiSeries, nearestFibLabel, smcNearest, aggregateRating,
} from "../calc";

// ── Master data (mock, with realistic delay) ───────────────────────────────────

const INSTRUMENTS: Record<string, string[]> = {
  NSE: ["NIFTY", "BANKNIFTY", "FINNIFTY"],
  BSE: ["SENSEX", "BANKEX"],
};

const SYMBOLS: Record<string, string[]> = {
  NIFTY:     ["NIFTY 26JUN", "NIFTY 31JUL"],
  BANKNIFTY: ["BANKNIFTY 26JUN"],
  FINNIFTY:  ["FINNIFTY 26JUN"],
  SENSEX:    ["SENSEX 26JUN"],
  BANKEX:    ["BANKEX 26JUN"],
};

const STRIKES = Array.from({ length: 21 }, (_, i) => 23000 + i * 50);

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export const fetchExchanges  = async (): Promise<string[]> => { await delay(rnd(200, 400)); return ["NSE", "BSE"]; };
export const fetchInstruments = async (exchange: string): Promise<string[]> => { await delay(rnd(200, 400)); return INSTRUMENTS[exchange] ?? []; };
export const fetchSymbols    = async (instrument: string): Promise<string[]> => { await delay(rnd(200, 400)); return SYMBOLS[instrument] ?? []; };
export const fetchStrikes    = async (_symbol: string): Promise<number[]> => { await delay(rnd(200, 400)); return STRIKES; };

// ── MockFeed ──────────────────────────────────────────────────────────────────

class MockFeed {
  private callClose  = 130;
  private putClose   = 110;
  private futureClose = 23520;
  private spotClose  = 23500;
  private prevRsiCloses: number[] = [];
  private pdh = 23580;
  private pdl = 23420;
  private barCount = 0;
  private barTimer:  ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  // Small random walk — open = previous close; high/low padded
  private nextBar(prevClose: number, volatility: number, t: number): OHLCBar {
    const pct   = (rnd(0.005, 0.015)) * (Math.random() > 0.5 ? 1 : -1);
    const close = Math.max(0.5, prevClose * (1 + pct * volatility));
    const open  = prevClose;
    const high  = Math.max(open, close) + Math.abs(prevClose * rnd(0.001, 0.003));
    const low   = Math.min(open, close) - Math.abs(prevClose * rnd(0.001, 0.003));
    return { t, o: +open.toFixed(2), h: +high.toFixed(2), l: +low.toFixed(2), c: +close.toFixed(2) };
  }

  private buildRow(t: number): DashboardRow {
    const callBar   = this.nextBar(this.callClose,   1, t);
    const putBar    = this.nextBar(this.putClose,    1, t);
    const futureBar = this.nextBar(this.futureClose, 1, t);
    const spotBar   = this.nextBar(this.spotClose,   1, t);

    this.callClose   = callBar.c;
    this.putClose    = putBar.c;
    this.futureClose = futureBar.c;
    this.spotClose   = spotBar.c;

    this.prevRsiCloses.push(callBar.c);

    const cpClient  = clientPivot4Bar(callBar);
    const cpClassic = classicPivot(callBar);
    const ppClient  = clientPivot4Bar(putBar);
    const ppClassic = classicPivot(putBar);

    const callMMA = mma(cpClient.pp, callBar.h);
    const callTLA = tla(cpClient.pp, callBar.l);
    const putMMA  = mma(ppClient.pp, putBar.h);
    const putTLA  = tla(ppClient.pp, putBar.l);

    // RSI on call closes
    const rsiSeries = computeRsiSeries(this.prevRsiCloses);
    const rsiVal = rsiSeries[rsiSeries.length - 1] ?? null;

    // SMC & Fib use sliding window of all closes so far (approximated by current bar)
    const swHigh = callBar.h;
    const swLow  = callBar.l;
    const smcStr = smcNearest(callBar.c, swHigh, swLow, this.pdh, this.pdl);
    const fibStr = nearestFibLabel(callBar.c, swHigh, swLow) ?? "—";

    // RSI vote: rising = prevRsiCloses[-2] < rsiVal
    const prevRsi = rsiSeries.length >= 2 ? rsiSeries[rsiSeries.length - 2] : null;
    const rsiVote = rsiVal !== null
      ? rsiVal < 30 && (prevRsi === null || rsiVal > prevRsi) ? 1
      : rsiVal > 70 && (prevRsi === null || rsiVal < prevRsi) ? -1
      : 0
      : 0;
    const ppVote   = callBar.c > cpClient.pp ? 1 : callBar.c < cpClient.pp ? -1 : 0;
    const bandVote = callBar.c > callMMA ? 1 : callBar.c < callTLA ? -1 : 0;
    const rating = aggregateRating([rsiVote, ppVote, bandVote]);

    this.barCount++;

    return {
      t,
      call: callBar,
      put:  putBar,
      futureLtp: futureBar.c,
      spotLtp:   spotBar.c,
      callPP:        cpClient.pp,
      putPP:         ppClient.pp,
      callPPClassic: cpClassic.pp,
      putPPClassic:  ppClassic.pp,
      callMMA, callTLA, putMMA, putTLA,
      smc: smcStr, fib: fibStr,
      rsi: rsiVal !== null ? +rsiVal.toFixed(1) : null,
      rating,
    };
  }

  generateHistory(n: number): DashboardRow[] {
    const TF_MS = 5 * 60 * 1000; // 5-minute bars
    const now   = Date.now();
    const rows: DashboardRow[] = [];
    for (let i = n; i >= 1; i--) {
      rows.push(this.buildRow(now - i * TF_MS));
    }
    return rows;
  }

  start(
    onRow: (row: DashboardRow) => void,
    onTickUpdate: (partial: Partial<DashboardRow>) => void,
  ): void {
    this.stop();

    // Tick update (500ms) — updates live close of the active bar
    this.tickTimer = setInterval(() => {
      const callC   = +(this.callClose   * (1 + (Math.random() - 0.5) * 0.002)).toFixed(2);
      const putC    = +(this.putClose    * (1 + (Math.random() - 0.5) * 0.002)).toFixed(2);
      const futureC = +(this.futureClose * (1 + (Math.random() - 0.5) * 0.001)).toFixed(2);
      const spotC   = +(this.spotClose   * (1 + (Math.random() - 0.5) * 0.001)).toFixed(2);
      onTickUpdate({
        futureLtp: futureC,
        spotLtp:   spotC,
        call: { t: Date.now(), o: this.callClose, h: Math.max(this.callClose, callC), l: Math.min(this.callClose, callC), c: callC },
        put:  { t: Date.now(), o: this.putClose,  h: Math.max(this.putClose,  putC),  l: Math.min(this.putClose,  putC),  c: putC  },
      });
    }, 500);

    // New bar (2000ms)
    this.barTimer = setInterval(() => {
      onRow(this.buildRow(Date.now()));
    }, 2000);
  }

  stop(): void {
    if (this.barTimer)  { clearInterval(this.barTimer);  this.barTimer  = null; }
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }
}

export const mockFeed = new MockFeed();
