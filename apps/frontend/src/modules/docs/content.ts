export type Tint = "call" | "put" | "neutral";

export interface ColRef {
  id: string;
  name: string;
  tint: Tint;
  formula?: string;
  description: string;
  howToRead: string;
}

export interface GlossaryEntry {
  term: string;
  def: string;
}

export interface Step {
  n: number;
  text: string;
}

export type DocBlock =
  | { type: "para"; content: string }
  | { type: "note"; content: string }
  | { type: "bullets"; items: string[] }
  | { type: "steps"; steps: Step[] }
  | { type: "columns"; columns: ColRef[] }
  | { type: "glossary"; glossary: GlossaryEntry[] };

export interface Subsection {
  id: string;
  heading: string;
  blocks: DocBlock[];
}

export interface Section {
  id: string;
  heading: string;
  blocks?: DocBlock[];
  subsections?: Subsection[];
}

export const SECTIONS: Section[] = [
  // ── 1. WHAT MODULE 1 IS ─────────────────────────────────────────────────────
  {
    id: "s1",
    heading: "1 — What Module 1 is",
    blocks: [
      {
        type: "para",
        content:
          "Module 1 is a live market worksheet for NIFTY options. You pick one Call option and one Put option (your chosen strike and expiry), and the screen shows their prices candle by candle — side by side with the NIFTY Future and the NIFTY Spot index — in an Excel-style table that updates by itself while the market is open.",
      },
      {
        type: "para",
        content:
          "For every candle the table also works out the special columns you asked for — MMA, TLA and Ranking — plus five well-known market indicators (SMC, FIB, RSI, EMA, VWAP). The Ranking column is the heart of the module: it tells you, candle by candle, whether the Call side or the Put side is stronger right now.",
      },
      {
        type: "para",
        content:
          "Without this screen you would need a broker terminal open on four instruments plus a spreadsheet to do the same maths by hand for every candle. Module 1 does the whole chain automatically: it connects to the broker, receives every price tick live, builds the candles, applies the formulas, and keeps the table up to date.",
      },
      {
        type: "note",
        content:
          "This is an analysis tool only. It shows prices and calculations to help you decide — it never places any order.",
      },
    ],
  },

  // ── 2. GETTING STARTED ──────────────────────────────────────────────────────
  {
    id: "s2",
    heading: "2 — Getting started (step by step)",
    blocks: [
      {
        type: "steps",
        steps: [
          {
            n: 1,
            text: "Log in to the application with your email, password and the OTP sent to you.",
          },
          {
            n: 2,
            text: "Connect your broker — enter your Zebu broker credentials once. This starts the live market feed; the Spot and Future prices at the top of the screen begin ticking immediately.",
          },
          {
            n: 3,
            text: "Make your selection in the header, left to right: Instrument → Symbol → Expiry Date → Type → Call Strike / Put Strike. Each choice unlocks the next one.",
          },
          {
            n: 4,
            text: "Generate — press the Generate button (or simply finish your selection: once live prices are confirmed, the table generates by itself). The module loads today's completed candles and starts following the live one.",
          },
          {
            n: 5,
            text: "Read the table — every row is one candle of your chosen timeframe. The newest candle sits at the top and refreshes twice per second; when its time window closes it becomes a fixed history row and a new live row starts.",
          },
          {
            n: 6,
            text: "Change anytime — pick a different timeframe, strike or expiry and the table rebuilds. Reset clears the table but keeps your selections.",
          },
        ],
      },
    ],
  },

  // ── 3. THE HEADER ───────────────────────────────────────────────────────────
  {
    id: "s3",
    heading: "3 — The header, field by field",
    subsections: [
      {
        id: "s3-1",
        heading: "3.1 Live price boxes — Spot and Future",
        blocks: [
          {
            type: "bullets",
            items: [
              "Spot — the live NIFTY 50 index level, with a green ▲ or red ▼ arrow showing the direction of the last change. Display only; you cannot edit it.",
              "Future — the live price of the nearest NIFTY futures contract, same arrow behaviour. The first Future price received is also the signal that live data is ready, which allows the table to auto-generate.",
              "Both boxes show “—” until the first live price arrives (for example before the broker is connected or before market open).",
            ],
          },
        ],
      },
      {
        id: "s3-2",
        heading: "3.2 The selection chain",
        blocks: [
          {
            type: "para",
            content:
              "The selection fields form a chain — each one depends on the one before it. If you change a field higher up the chain, everything after it clears automatically, so you can never end up with a mismatched combination.",
          },
          {
            type: "bullets",
            items: [
              "Instrument — the instrument type you want to trade, e.g. Index Options. “Index Options” is pre-selected for you.",
              "Symbol — the underlying you want to trade, e.g. NIFTY. Note: live prices currently stream for NIFTY only.",
              "Expiry Date — the exact settlement date of the option, nearest date pre-selected. For NIFTY the choices are the Tuesdays (the official weekly expiry day); dates already in the past are hidden. Hidden entirely for instruments that don't settle (Cash Index, Equity).",
              "Type — which option sides you want: “Call + Put” (both, the default), “Call” only, or “Put” only. Choosing one side hides the other side's columns entirely.",
              "Call Strike / Put Strike — the strike price of each option. The dropdown offers 11 strikes: the one closest to the current market level (called “at the money”) plus five above and five below, in 50-point steps.",
            ],
          },
        ],
      },
      {
        id: "s3-3",
        heading: "3.3 Generate and Reset",
        blocks: [
          {
            type: "bullets",
            items: [
              "Generate becomes clickable only once every required field is filled in (both strikes in Call + Put mode; just one strike in single-side mode).",
              "Auto-Generate: the first time your selection is complete and live market data is confirmed, the table generates on its own — you don't have to press anything.",
              "Reset appears after generating. It clears the table and stops the live row, but remembers your selections so you can regenerate with one click.",
            ],
          },
        ],
      },
      {
        id: "s3-4",
        heading: "3.4 Status light, Columns and Collapse",
        blocks: [
          {
            type: "bullets",
            items: [
              "Status light (in the timeframe row) — a coloured dot with a label telling you the feed state at a glance: green “Live”, amber “Interrupted” or “Auth Required”, blue “Connecting”, grey “Market Closed” or “Idle”, red “API Error” or “Connection Lost”.",
              "⛶ Columns — opens a panel where you can hide any of the 31 columns and drag them into your preferred order. Your layout is saved per user, so it is exactly as you left it next time you log in.",
              "▲ Collapse — folds the whole header into a one-line summary (Spot, Future and your selection) to give the table more room. Click again to expand.",
            ],
          },
        ],
      },
    ],
  },

  // ── 4. TIMEFRAMES ───────────────────────────────────────────────────────────
  {
    id: "s4",
    heading: "4 — Timeframes",
    subsections: [
      {
        id: "s4-1",
        heading: "4.1 What a timeframe means",
        blocks: [
          {
            type: "para",
            content:
              "A timeframe is simply how much time one row (one candle) covers. On “5m” every row summarises five minutes of trading: the price it opened at, the highest and lowest it touched, and where it closed. Twelve timeframes are available: 1m, 2m, 3m, 5m, 10m, 15m, 30m, 45m, 1h, 2h, 3h and 4h.",
          },
          {
            type: "para",
            content:
              "Candles are aligned so they make sense against the trading day. Minute-based candles snap to clean clock boundaries (a 5m candle always starts at :00, :05, :10 …), and hour-based candles are anchored to the 09:15 market open — so the first 1-hour candle runs 09:15–10:15, the first 2-hour candle 09:15–11:15, and so on.",
          },
          {
            type: "para",
            content:
              "Switching timeframe reloads the day's completed candles at the new size and restarts the live row — every column recalculates automatically.",
          },
        ],
      },
      {
        id: "s4-2",
        heading: "4.2 Custom date range",
        blocks: [
          {
            type: "para",
            content:
              "The 📅 Custom button lets you look back at a specific window instead of the live day. Pick a candle size, a From time and a To time (they default to today 09:15–15:30), then press Apply. The table fills with the stored candles for that window — as fixed history, without a live updating row.",
          },
          {
            type: "note",
            content:
              "Candle history is kept for about one trading day (25 hours), so the Custom range can reach roughly one day back. Also, candles exist only from the moment the live feed was running — the system does not download older candles from the broker.",
          },
        ],
      },
    ],
  },

  // ── 5. THE TABLE ────────────────────────────────────────────────────────────
  {
    id: "s5",
    heading: "5 — The table: all 31 columns",
    subsections: [
      {
        id: "s5-1",
        heading: "5.1 How the table is organised",
        blocks: [
          {
            type: "para",
            content:
              "The table has 31 columns arranged in 7 groups. Reading left to right: the candle's Date & Time (frozen so it never scrolls away), then a block of six columns for the Call, six for the Put, the single Ranking column, six for the Future, six for the Spot, and finally the five indicator columns. Each price block shows Open, High, Low, Close plus that instrument's MMA and TLA.",
          },
          {
            type: "para",
            content:
              "Notation used below: O = Open (first price of the candle), H = High (highest price), L = Low (lowest), C = Close (last price). “Premium” means the price of the option itself. Click any column name to expand its full explanation.",
          },
        ],
      },
      {
        id: "s5-2",
        heading: "5.2 Column reference",
        blocks: [
          {
            type: "columns",
            columns: [
              {
                id: "datetime",
                name: "Date & Time",
                tint: "neutral",
                description:
                  "The starting time of the candle, shown in Indian Standard Time (e.g. “06 Jul 10:35”). This column is frozen on the left so it stays visible while you scroll sideways.",
                howToRead:
                  "Tells you exactly which slice of the trading day the row describes. On a 5m timeframe, “10:35” covers 10:35:00 to 10:39:59.",
              },
              {
                id: "ce-ohlc",
                name: "Call — Open / High / Low / Close",
                tint: "call",
                description:
                  "The traded price (premium) of your selected Call option during that candle: where it started (Open), the highest and lowest it reached, and where it ended (Close). These are the option's own prices — never the index level.",
                howToRead:
                  "A rising Call Close from row to row means the Call is getting more expensive — usually because the market is moving up. “—” means no trade data arrived for the Call in that candle.",
              },
              {
                id: "mma-c",
                name: "Call MMA",
                tint: "call",
                formula:
                  "MMA = (Open + High + Low − Close) ÷ 4\n\nExample: O=70.70, H=76.75, L=70.15, C=75.20\nMMA = (70.70 + 76.75 + 70.15 − 75.20) ÷ 4 = 35.60",
                description:
                  "Your custom strength number for the Call, calculated fresh for every candle from that candle's own four prices. It adds Open, High and Low, subtracts the Close, and divides by four — exactly as specified in your formula sheet.",
                howToRead:
                  "You don't read MMA on its own — its job is to be compared against the Put MMA in the Ranking column. The bigger MMA wins the candle. (Because Close is subtracted, the value is roughly half the option's price — that is expected.)",
              },
              {
                id: "tla-c",
                name: "Call TLA",
                tint: "call",
                formula:
                  "TLA = (2 × MMA) − High\n\nExample: MMA = 35.60, High = 76.75\nTLA = (2 × 35.60) − 76.75 = −5.55",
                description:
                  "A follow-on value derived from the Call's MMA: double the MMA, minus the candle's High.",
                howToRead:
                  "TLA is often negative — that is normal and mathematically expected with the current MMA formula, not an error. It gives a second per-candle reference number alongside MMA.",
              },
              {
                id: "pe-ohlc",
                name: "Put — Open / High / Low / Close",
                tint: "put",
                description:
                  "Exactly the same four prices, but for your selected Put option. Put columns are amber-tinted so you always know which side you are reading.",
                howToRead:
                  "A rising Put Close means the Put is getting more expensive — usually because the market is moving down. “—” means no Put trade data for that candle.",
              },
              {
                id: "mma-p",
                name: "Put MMA",
                tint: "put",
                formula:
                  "MMA = (Open + High + Low − Close) ÷ 4\n\nExample: O=73.30, H=74.40, L=70.05, C=71.20\nMMA = (73.30 + 74.40 + 70.05 − 71.20) ÷ 4 = 36.64",
                description:
                  "The same MMA formula, applied to the Put option's candle.",
                howToRead:
                  "Compared against the Call MMA in the Ranking column — whichever is bigger wins the candle for its side.",
              },
              {
                id: "tla-p",
                name: "Put TLA",
                tint: "put",
                formula:
                  "TLA = (2 × MMA) − High\n\nExample: MMA = 36.64, High = 74.40\nTLA = (2 × 36.64) − 74.40 = −1.13",
                description: "The same TLA formula, applied to the Put's MMA and High.",
                howToRead:
                  "Same reading as Call TLA — negative values are normal.",
              },
              {
                id: "ranking",
                name: "Ranking",
                tint: "neutral",
                formula:
                  "Ranking = the HIGHER of (Call MMA, Put MMA)\nIf they are exactly equal, Call wins.\n\nExample: Call MMA = 35.60, Put MMA = 36.64\nRanking = 36.64 → shown as 36, amber (Put wins)",
                description:
                  "The module's core output. For each candle it compares the Call MMA against the Put MMA and shows the winner's value. Nothing else goes into it — no weighting, no history, just the straight comparison of that one candle.",
                howToRead:
                  "The colour tells you the winner instantly: blue = the Call side is stronger this candle, amber = the Put side is stronger. Scan the column top to bottom to see which side has been dominating.",
              },
              {
                id: "fut-ohlc",
                name: "Future — Open / High / Low / Close",
                tint: "neutral",
                description:
                  "The four prices of the NIFTY futures contract for that candle. This is an index-level number (around 24,000+), not an option premium. The Future also feeds the RSI, SMC and FIB indicator columns.",
                howToRead:
                  "Shows the direction of the underlying market that drives both your options. If no fresh Future price has arrived for more than 8 seconds, the live row shows “—” rather than repeating a stale price.",
              },
              {
                id: "fut-mma-tla",
                name: "Future MMA / Future TLA",
                tint: "neutral",
                formula:
                  "Same formulas as the option columns:\nMMA = (O + H + L − C) ÷ 4    TLA = (2 × MMA) − High\n\nExample: O=24460, H=24474.3, L=24460, C=24473.6\nMMA = 12,230.18 → shown as 12230;  TLA = −13.95 → shown as -14",
                description:
                  "The same MMA and TLA calculations, applied to the Future's candle so all four instruments can be compared on the same basis.",
                howToRead:
                  "Context columns — they let you apply the same lens to the underlying market as to the options. They do not affect the Ranking.",
              },
              {
                id: "spot-ohlc",
                name: "Spot — Open / High / Low / Close",
                tint: "neutral",
                description:
                  "The four prices of the NIFTY 50 cash index for that candle — the reference level everyone quotes. The Spot also feeds the EMA and VWAP indicator columns.",
                howToRead:
                  "Your baseline market level. If a Spot candle is ever missing, the table borrows the Future's candle for that row — the only place any substitution is allowed.",
              },
              {
                id: "spot-mma-tla",
                name: "Spot MMA / Spot TLA",
                tint: "neutral",
                formula:
                  "MMA = (O + H + L − C) ÷ 4    TLA = (2 × MMA) − High",
                description:
                  "The same MMA and TLA calculations, applied to the Spot index candle.",
                howToRead:
                  "Context columns, same reading as the Future's MMA/TLA.",
              },
              {
                id: "smc",
                name: "SMC (nearest key level)",
                tint: "neutral",
                formula:
                  "Compares the Future price to four reference levels —\nsession High (SWH), session Low (SWL),\nprevious candle High (PDH), previous candle Low (PDL) —\nand shows whichever level is closest.",
                description:
                  "“Smart Money Concept” — answers, for each candle: which important price level is the market sitting nearest to right now? It shows the level's name and value, e.g. “SWH 24,474.30”.",
                howToRead:
                  "Price reacting near a key high or low is more meaningful than movement in open space. “SWH …” means the market is pressing against the day's high; “SWL …” means it is near the day's low.",
              },
              {
                id: "fib",
                name: "FIB (nearest Fibonacci level)",
                tint: "neutral",
                formula:
                  "Level = High − (High − Low) × ratio\nRatios: 23.6%, 38.2%, 50%, 61.8%, 78.6%\n(High/Low = the session's range so far)",
                description:
                  "Splits the day's price range into the five classic Fibonacci retracement levels and shows the one the Future price is currently closest to, e.g. “61.8% 24,411.55”.",
                howToRead:
                  "Fibonacci levels are widely watched turning-point zones — price often pauses or reverses near them. The label tells you which zone is in play right now.",
              },
              {
                id: "rsi",
                name: "RSI (14)",
                tint: "neutral",
                formula:
                  "RSI = 100 − 100 ÷ (1 + RS)\nRS = average gain ÷ average loss over the last 14 candles\n(Wilder's smoothing — the industry-standard method)",
                description:
                  "Relative Strength Index — a momentum gauge from 0 to 100, calculated on the Future's closing prices. It needs 15 candles of history before it can show its first value, so early rows show “—”.",
                howToRead:
                  "Above 70 = overbought (the rise may be tiring); below 30 = oversold (the fall may be tiring); around 50 = neutral.",
              },
              {
                id: "ema",
                name: "EMA (20)",
                tint: "neutral",
                formula:
                  "EMA = (Close × k) + (previous EMA × (1 − k)),  k = 2 ÷ 21\nSeeded with the simple average of the first 20 closes.",
                description:
                  "A 20-candle Exponential Moving Average of the Spot index — a smoothed trend line that gives more weight to recent prices. It needs 20 candles before it can show its first value, so early rows show “—” (this is by design, not a fault).",
                howToRead:
                  "Spot above its EMA = the short-term trend is up; below = down. The gap between Spot and EMA shows how stretched the move is.",
              },
              {
                id: "vwap",
                name: "VWAP",
                tint: "neutral",
                formula:
                  "Typical Price of each candle = (High + Low + Close) ÷ 3\nVWAP = running average of Typical Price since the session start",
                description:
                  "The average level the Spot index has traded around since the market opened, updated every candle. (Note: because per-candle traded volume is not available in this data feed, every candle counts equally — a true volume-weighted VWAP is a planned improvement.)",
                howToRead:
                  "Spot above VWAP = the market is trading above its average for the day (buyers in charge); below VWAP = below average (sellers in charge).",
              },
            ],
          },
        ],
      },
    ],
  },

  // ── 6. HOW TO READ THE TABLE ────────────────────────────────────────────────
  {
    id: "s6",
    heading: "6 — Colours, dashes and numbers",
    subsections: [
      {
        id: "s6-1",
        heading: "6.1 Colour coding",
        blocks: [
          {
            type: "bullets",
            items: [
              "Call columns carry a blue tint, Put columns an amber tint — you always know which side you are reading.",
              "Within each Open/High/Low/Close block: the High cell is green, the Low cell is red, the Open cell is blue, and the Close cell is green when the candle closed higher than it opened (bullish) or red when lower (bearish).",
              "The Ranking cell is blue when the Call side wins the candle and amber when the Put side wins.",
            ],
          },
        ],
      },
      {
        id: "s6-2",
        heading: "6.2 What “—” means",
        blocks: [
          {
            type: "para",
            content:
              "A dash means: no real data for this cell. The table is deliberately honest — if the Call had no trades in a candle, its cells show “—” rather than borrowing a number from somewhere else. The one permitted exception: if a Spot candle is missing, the Future's candle stands in for it.",
          },
          {
            type: "bullets",
            items: [
              "Call/Put cells show “—” until the first live trade of that option arrives after you generate.",
              "Future and Spot cells in the live row show “—” if no fresh price has arrived for more than 8 seconds — a freshness guard against showing stale prices.",
              "RSI shows “—” for the first 14 candles and EMA for the first 19 — they simply need that much history before their formulas are meaningful.",
            ],
          },
        ],
      },
      {
        id: "s6-3",
        heading: "6.3 How the numbers are displayed",
        blocks: [
          {
            type: "para",
            content:
              "All prices in the table are shown as whole numbers with the decimals cut off (74.9 is shown as 74). The full-precision values are used in every calculation — only the display is simplified. Row order is newest first: the live candle is always the top row.",
          },
          {
            type: "para",
            content:
              "You can select a block of cells with the mouse and press Ctrl+C (Cmd+C on Mac) to copy it — the cells paste cleanly into Excel.",
          },
        ],
      },
    ],
  },

  // ── 7. LIVE UPDATES ─────────────────────────────────────────────────────────
  {
    id: "s7",
    heading: "7 — How the live updates work",
    blocks: [
      {
        type: "steps",
        steps: [
          {
            n: 1,
            text: "The broker sends a price tick every time any of your four instruments trades — during busy periods that is several hundred ticks per minute.",
          },
          {
            n: 2,
            text: "The system folds each tick into candles for all twelve timeframes at once, so switching timeframe is instant.",
          },
          {
            n: 3,
            text: "The top row of your table (the live candle) refreshes twice per second from the latest prices: its High creeps up as new highs print, its Low creeps down, and its Close is always the latest price.",
          },
          {
            n: 4,
            text: "When the candle's time window ends (e.g. the 5 minutes are up), that row freezes as history, and a fresh live row starts at the top. All formulas recompute for the new candle.",
          },
        ],
      },
      {
        type: "bullets",
        items: [
          "Market hours: the module treats the market as live Monday–Friday, 09:00–15:45 IST. The table itself always starts from the 09:15 session open.",
          "History depth: the table can show up to 400 candles, and stored candles are kept for about 25 hours — roughly one full trading day of look-back.",
          "History exists only from the time the live feed was running that day. If the feed starts at 10:00, candles before 10:00 are not available — there is no back-fill from the broker.",
        ],
      },
    ],
  },

  // ── 8. MESSAGES & RECOVERY ──────────────────────────────────────────────────
  {
    id: "s8",
    heading: "8 — Screen messages and what to do",
    blocks: [
      {
        type: "glossary",
        glossary: [
          {
            term: "Market Closed",
            def: "It is outside trading hours (Mon–Fri 09:00–15:45 IST). Nothing to do — come back when the market opens.",
          },
          {
            term: "Authentication Required",
            def: "The broker connection is not active. Log in with your broker credentials again (Module 1 broker login).",
          },
          {
            term: "Reconnecting…",
            def: "The broker feed dropped and the system is retrying automatically (up to 5 attempts). Usually resolves itself within a minute.",
          },
          {
            term: "Broker Disconnected",
            def: "Automatic reconnection gave up. Press Retry; if that fails, log in to the broker again.",
          },
          {
            term: "Broker Session Expired",
            def: "The broker ended the session (e.g. logged in elsewhere). A fresh broker login is required.",
          },
          {
            term: "API Error / Retry",
            def: "A data request failed. Press Retry — the selection is kept, only the data is re-fetched.",
          },
          {
            term: "Connection Lost",
            def: "Your internet connection to the server dropped. The screen reconnects automatically and re-joins all live feeds when the network returns.",
          },
          {
            term: "Empty strike dropdown",
            def: "The strike list comes from the live spot price cache. If it is empty, the price cache is temporarily unavailable — try again shortly.",
          },
        ],
      },
    ],
  },

  // ── 9. MODULE 2 ─────────────────────────────────────────────────────────────
  {
    id: "s9",
    heading: "9 — Module 2: Trading Scanner (at a glance)",
    subsections: [
      {
        id: "s9-1",
        heading: "9.1 What it does",
        blocks: [
          {
            type: "para",
            content:
              "Where Module 1 goes deep on one strike, Module 2 goes wide: it watches many strikes at once, live, in two side-by-side tables — one for Calls, one for Puts — showing just the live premium and its time for each strike.",
          },
        ],
      },
      {
        id: "s9-2",
        heading: "9.2 How it differs from Module 1",
        blocks: [
          {
            type: "para",
            content:
              "Module 1 = one Call + one Put in full detail (all 31 columns, candles, formulas, indicators). Module 2 = many strikes in light detail (live value + time) — for spotting which strikes are moving before you study one of them in Module 1.",
          },
        ],
      },
    ],
  },

  // ── 10. GLOSSARY ────────────────────────────────────────────────────────────
  {
    id: "s10",
    heading: "10 — Quick glossary",
    blocks: [
      {
        type: "glossary",
        glossary: [
          {
            term: "Candle / Bar",
            def: "One time-slice of trading, summarised by four prices: Open, High, Low, Close. One table row = one candle.",
          },
          {
            term: "OHLC",
            def: "Open, High, Low, Close — the four prices of one candle.",
          },
          {
            term: "Timeframe",
            def: "How much time one candle covers (1 minute up to 4 hours).",
          },
          { term: "Premium", def: "The price of an option (Call or Put) itself." },
          {
            term: "CE / PE",
            def: "Call option / Put option. A Call gains when the market rises; a Put gains when it falls.",
          },
          {
            term: "Strike",
            def: "The fixed price level an option contract is written at (e.g. 24,400).",
          },
          {
            term: "ATM (at the money)",
            def: "The strike closest to the current market level. The strike dropdown offers ATM plus 5 strikes above and 5 below.",
          },
          {
            term: "Expiry",
            def: "The date the option contract settles. NIFTY weekly options expire on Tuesdays.",
          },
          {
            term: "Spot",
            def: "The live cash index level (NIFTY 50 itself).",
          },
          {
            term: "Future",
            def: "The price of the index futures contract — usually trades slightly above or below the Spot.",
          },
          {
            term: "MMA",
            def: "Your custom per-candle number: (Open + High + Low − Close) ÷ 4. The Call and Put MMAs are compared to produce the Ranking.",
          },
          {
            term: "TLA",
            def: "Derived from MMA: (2 × MMA) − High. Often negative — that is normal.",
          },
          {
            term: "Ranking",
            def: "The higher of Call MMA vs Put MMA for the candle. Blue = Call side stronger, amber = Put side stronger.",
          },
          {
            term: "RSI",
            def: "Momentum gauge from 0–100. Above 70 = overbought, below 30 = oversold.",
          },
          {
            term: "EMA",
            def: "Exponential Moving Average — a smoothed trend line that weights recent prices more heavily.",
          },
          {
            term: "VWAP",
            def: "The running average level the market has traded around since the open.",
          },
          {
            term: "Fibonacci retracement",
            def: "Five widely-watched pullback levels (23.6%–78.6%) inside the day's range.",
          },
          {
            term: "SMC",
            def: "Smart Money Concept — the key structural levels (session high/low, previous candle high/low) the price is reacting to.",
          },
          {
            term: "Tick",
            def: "A single live price update from the broker — the raw material every candle is built from.",
          },
        ],
      },
    ],
  },

  // ── 11. GOOD TO KNOW ────────────────────────────────────────────────────────
  {
    id: "s11",
    heading: "11 — Good to know",
    blocks: [
      {
        type: "bullets",
        items: [
          "View-only: the platform analyses and displays — it never places, modifies or cancels orders.",
          "Data honesty: every number in the table comes from that instrument's own real trades. Missing data is shown as “—”, never invented (the one documented exception: a missing Spot candle borrows the Future's candle).",
          "Your layout is yours: hidden columns and column order are saved per user and restored on your next login.",
          "The live feed starts only after you log in to the broker — the system never connects to the broker on its own.",
          "The “PP” toggle in the title bar is a legacy control from an earlier version of the table and currently has no effect on the 31 columns.",
          "The MMA formula uses a minus sign on Close — (O + H + L − C) ÷ 4 — exactly as written in your specification. Because of this, MMA is roughly half the price and TLA is often negative; both are expected. If you intended a plus sign, tell the team and it is a one-line change.",
          "On a Ranking tie (Call MMA exactly equals Put MMA), Call wins — please confirm this is the rule you want.",
          "Displayed numbers have their decimals cut off (74.9 shows as 74); the full precision is always used inside the calculations.",
        ],
      },
    ],
  },
];

// ── Search helpers ────────────────────────────────────────────────────────────

function colMatches(col: ColRef, q: string): boolean {
  return (
    col.name.toLowerCase().includes(q) ||
    col.description.toLowerCase().includes(q) ||
    (col.formula?.toLowerCase().includes(q) ?? false) ||
    col.howToRead.toLowerCase().includes(q)
  );
}

function blockMatches(block: DocBlock, q: string): boolean {
  switch (block.type) {
    case "para":
    case "note":
      return block.content.toLowerCase().includes(q);
    case "bullets":
      return block.items.some((i) => i.toLowerCase().includes(q));
    case "steps":
      return block.steps.some((s) => s.text.toLowerCase().includes(q));
    case "columns":
      return block.columns.some((c) => colMatches(c, q));
    case "glossary":
      return block.glossary.some(
        (g) =>
          g.term.toLowerCase().includes(q) ||
          g.def.toLowerCase().includes(q)
      );
  }
}

function subsectionMatches(sub: Subsection, q: string): boolean {
  if (sub.heading.toLowerCase().includes(q)) return true;
  return sub.blocks.some((b) => blockMatches(b, q));
}

export function sectionMatches(section: Section, q: string): boolean {
  if (!q) return true;
  if (section.heading.toLowerCase().includes(q)) return true;
  if (section.blocks?.some((b) => blockMatches(b, q))) return true;
  if (section.subsections?.some((s) => subsectionMatches(s, q))) return true;
  return false;
}

export function matchingColIds(q: string): Set<string> {
  const ids = new Set<string>();
  if (!q) return ids;
  for (const sec of SECTIONS) {
    for (const block of sec.blocks ?? []) {
      if (block.type === "columns") {
        for (const col of block.columns) {
          if (colMatches(col, q)) ids.add(col.id);
        }
      }
    }
    for (const sub of sec.subsections ?? []) {
      for (const block of sub.blocks) {
        if (block.type === "columns") {
          for (const col of block.columns) {
            if (colMatches(col, q)) ids.add(col.id);
          }
        }
      }
    }
  }
  return ids;
}

// ── TOC flat list ─────────────────────────────────────────────────────────────

export interface TocEntry {
  id: string;
  label: string;
  depth: number; // 0 = section, 1 = subsection
}

export function buildToc(): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const sec of SECTIONS) {
    entries.push({ id: sec.id, label: sec.heading, depth: 0 });
    for (const sub of sec.subsections ?? []) {
      entries.push({ id: sub.id, label: sub.heading, depth: 1 });
    }
  }
  return entries;
}
