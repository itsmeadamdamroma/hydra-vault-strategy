/**
 * ═══════════════════════════════════════════════════════════
 *  🔮 THE ORACLE — Market Regime Detection Engine
 * ═══════════════════════════════════════════════════════════
 *
 *  The brain of HYDRA. Analyzes on-chain signals to classify
 *  the current market into one of three regimes:
 *
 *  🟢 BULL  — Funding rates positive, prices trending up
 *  🟡 NEUTRAL — No strong directional signal
 *  🔴 BEAR — Funding negative, prices declining
 *
 *  Then dynamically reweights between The Sentinel (lending)
 *  and The Reaper (basis trade) to maximize risk-adjusted yield.
 *
 *  The Oracle never panics. It requires 6 hours of sustained
 *  signal confirmation before changing regime — preventing
 *  whipsaws from flash crashes or fake pumps.
 */

export enum MarketRegime {
  BULL = "BULL",
  NEUTRAL = "NEUTRAL",
  BEAR = "BEAR",
}

export interface RegimeSignals {
  /** Current hourly funding rate from Drift SOL-PERP (e.g. 0.01 = 0.01%) */
  fundingRate: number;
  /** SOL 30-day simple moving average */
  sol30dSMA: number;
  /** SOL 60-day simple moving average */
  sol60dSMA: number;
  /** Current SOL price */
  solPrice: number;
  /** Open interest change over 24h (positive = growing speculation) */
  oiChange24h: number;
  /** Drift borrow utilization for USDC (high = lots of demand to borrow) */
  usdcUtilization: number;
}

export interface RegimeAllocation {
  regime: MarketRegime;
  sentinelWeight: number; // 0-100, allocation to lending
  reaperWeight: number; // 0-100, allocation to basis trade
  confidence: number; // 0-1, how confident we are in the regime
  reasoning: string; // Human-readable explanation for logs
}

/**
 * REGIME SCORING WEIGHTS
 *
 * Each signal contributes a score from -1 (bearish) to +1 (bullish).
 * The weighted sum determines the regime:
 *   score > +0.3  → BULL
 *   score < -0.3  → BEAR
 *   else           → NEUTRAL
 */
const SIGNAL_WEIGHTS = {
  fundingRate: 0.35, // Most important — direct proxy for speculative demand
  trendAlignment: 0.25, // 30d vs 60d SMA crossover
  oiMomentum: 0.20, // Growing OI = growing speculation
  usdcDemand: 0.20, // High USDC utilization = capital being deployed
};

/**
 * REGIME → ALLOCATION MAPPING
 *
 * These are the target weights. The Oracle smoothly transitions
 * between them over 6 hours to prevent sudden capital movements.
 */
const REGIME_TARGETS: Record<MarketRegime, { sentinel: number; reaper: number }> = {
  [MarketRegime.BULL]: { sentinel: 30, reaper: 70 },
  [MarketRegime.NEUTRAL]: { sentinel: 60, reaper: 40 },
  [MarketRegime.BEAR]: { sentinel: 90, reaper: 10 },
};

// Minimum hours a regime must persist before we act on it
const REGIME_CONFIRMATION_HOURS = 6;

export class Oracle {
  private currentRegime: MarketRegime = MarketRegime.NEUTRAL;
  private currentAllocation: RegimeAllocation;
  private pendingRegime: MarketRegime | null = null;
  private pendingRegimeStartTime: number = 0;
  private regimeHistory: Array<{ regime: MarketRegime; timestamp: number; score: number }> = [];

  constructor() {
    this.currentAllocation = {
      regime: MarketRegime.NEUTRAL,
      sentinelWeight: REGIME_TARGETS[MarketRegime.NEUTRAL].sentinel,
      reaperWeight: REGIME_TARGETS[MarketRegime.NEUTRAL].reaper,
      confidence: 0.5,
      reasoning: "🔮 Oracle initialized in NEUTRAL regime. Awaiting first signal batch.",
    };
  }

  /**
   * Process a new batch of market signals and potentially update the regime.
   *
   * Returns the current allocation recommendation.
   * The caller (HYDRA bot) is responsible for executing the rebalance.
   */
  public analyze(signals: RegimeSignals): RegimeAllocation {
    const score = this.computeRegimeScore(signals);
    const detectedRegime = this.scoreToRegime(score);
    const confidence = Math.min(Math.abs(score) / 0.6, 1.0);

    // Log to history
    this.regimeHistory.push({
      regime: detectedRegime,
      timestamp: Date.now(),
      score,
    });

    // Trim history to last 168 entries (7 days at hourly intervals)
    if (this.regimeHistory.length > 168) {
      this.regimeHistory = this.regimeHistory.slice(-168);
    }

    // ═══════════════════════════════════════════════════════
    // REGIME CONFIRMATION LOGIC
    // Prevents whipsaws. A new regime must persist for 6 hours
    // before the Oracle acts on it.
    // ═══════════════════════════════════════════════════════
    if (detectedRegime !== this.currentRegime) {
      if (this.pendingRegime === detectedRegime) {
        // Same pending regime — check if confirmation period elapsed
        const hoursElapsed = (Date.now() - this.pendingRegimeStartTime) / (1000 * 3600);

        if (hoursElapsed >= REGIME_CONFIRMATION_HOURS) {
          // ✅ Confirmed! Transition to new regime
          const previousRegime = this.currentRegime;
          this.currentRegime = detectedRegime;
          this.pendingRegime = null;

          const target = REGIME_TARGETS[detectedRegime];
          this.currentAllocation = {
            regime: detectedRegime,
            sentinelWeight: target.sentinel,
            reaperWeight: target.reaper,
            confidence,
            reasoning: `🔮 REGIME SHIFT: ${previousRegime} → ${detectedRegime} | ` +
              `Score: ${score.toFixed(3)} | Confirmed after ${hoursElapsed.toFixed(1)}h | ` +
              `New allocation: Sentinel ${target.sentinel}% / Reaper ${target.reaper}%`,
          };

          console.log(`\n${"═".repeat(60)}`);
          console.log(`  🔮 ORACLE: REGIME TRANSITION CONFIRMED`);
          console.log(`  ${previousRegime} ──────────▶ ${detectedRegime}`);
          console.log(`  Confidence: ${(confidence * 100).toFixed(0)}%`);
          console.log(`  Sentinel: ${target.sentinel}% | Reaper: ${target.reaper}%`);
          console.log(`${"═".repeat(60)}\n`);
        } else {
          // Still waiting for confirmation
          this.currentAllocation.reasoning =
            `🔮 Pending regime shift: ${this.currentRegime} → ${detectedRegime} ` +
            `(${hoursElapsed.toFixed(1)}h / ${REGIME_CONFIRMATION_HOURS}h confirmed)`;
        }
      } else {
        // NEW pending regime detected — start the clock
        this.pendingRegime = detectedRegime;
        this.pendingRegimeStartTime = Date.now();

        this.currentAllocation.reasoning =
          `🔮 New signal detected: ${detectedRegime} (score: ${score.toFixed(3)}). ` +
          `Starting ${REGIME_CONFIRMATION_HOURS}h confirmation window...`;
      }
    } else {
      // Signal confirms current regime — reset any pending transition
      if (this.pendingRegime !== null) {
        this.currentAllocation.reasoning =
          `🔮 Pending shift to ${this.pendingRegime} cancelled — signal reverted to ${this.currentRegime}`;
        this.pendingRegime = null;
      } else {
        this.currentAllocation.reasoning =
          `🔮 Regime ${this.currentRegime} confirmed | Score: ${score.toFixed(3)} | Confidence: ${(confidence * 100).toFixed(0)}%`;
      }
      this.currentAllocation.confidence = confidence;
    }

    return { ...this.currentAllocation };
  }

  /**
   * Compute a composite regime score from -1 (extreme bear) to +1 (extreme bull).
   */
  private computeRegimeScore(signals: RegimeSignals): number {
    let score = 0;

    // ── Signal 1: Funding Rate ──────────────────────────
    // Positive funding = bulls paying shorts = bullish speculation
    // Scale: 0.01% hourly ≈ 87.6% annualized, very bullish
    const fundingScore = Math.max(-1, Math.min(1, signals.fundingRate / 0.005));
    score += fundingScore * SIGNAL_WEIGHTS.fundingRate;

    // ── Signal 2: Trend Alignment (SMA Crossover) ──────
    // 30d SMA above 60d SMA = uptrend
    const smaDelta = (signals.sol30dSMA - signals.sol60dSMA) / signals.sol60dSMA;
    const trendScore = Math.max(-1, Math.min(1, smaDelta / 0.1));
    score += trendScore * SIGNAL_WEIGHTS.trendAlignment;

    // ── Signal 3: Open Interest Momentum ────────────────
    // Growing OI = new money entering, usually bullish
    const oiScore = Math.max(-1, Math.min(1, signals.oiChange24h / 0.05));
    score += oiScore * SIGNAL_WEIGHTS.oiMomentum;

    // ── Signal 4: USDC Borrowing Demand ─────────────────
    // High utilization = capital being deployed = bullish activity
    // Also means higher lending APY for The Sentinel
    const utilizationScore = Math.max(-1, Math.min(1, (signals.usdcUtilization - 0.5) / 0.3));
    score += utilizationScore * SIGNAL_WEIGHTS.usdcDemand;

    return score;
  }

  private scoreToRegime(score: number): MarketRegime {
    if (score > 0.3) return MarketRegime.BULL;
    if (score < -0.3) return MarketRegime.BEAR;
    return MarketRegime.NEUTRAL;
  }

  // ── Getters ──────────────────────────────────────────

  public getCurrentRegime(): MarketRegime {
    return this.currentRegime;
  }

  public getCurrentAllocation(): RegimeAllocation {
    return { ...this.currentAllocation };
  }

  public getRegimeHistory() {
    return [...this.regimeHistory];
  }

  /**
   * Generate a human-readable status report for monitoring/logging.
   */
  public getStatusReport(): string {
    const alloc = this.currentAllocation;
    const emoji = {
      [MarketRegime.BULL]: "🟢",
      [MarketRegime.NEUTRAL]: "🟡",
      [MarketRegime.BEAR]: "🔴",
    };

    return [
      `┌─────────────────────────────────────┐`,
      `│  🔮 ORACLE STATUS                   │`,
      `├─────────────────────────────────────┤`,
      `│  Regime:     ${emoji[alloc.regime]} ${alloc.regime.padEnd(20)}│`,
      `│  Confidence: ${(alloc.confidence * 100).toFixed(0).padStart(3)}%                   │`,
      `│  Sentinel:   ${String(alloc.sentinelWeight).padStart(3)}%                   │`,
      `│  Reaper:     ${String(alloc.reaperWeight).padStart(3)}%                   │`,
      `│  Pending:    ${(this.pendingRegime || "none").padEnd(20)}│`,
      `└─────────────────────────────────────┘`,
    ].join("\n");
  }
}
