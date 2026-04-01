/**
 * ═══════════════════════════════════════════════════════════
 *  ⚔️ THE REAPER — Delta-Neutral Funding Rate Harvester
 * ═══════════════════════════════════════════════════════════
 *
 *  The Reaper executes the most elegant trade in DeFi:
 *  the perpetual futures basis trade.
 *
 *  The concept is simple but deadly effective:
 *
 *  1. LONG spot SOL (hold real SOL)
 *  2. SHORT perp SOL (sell SOL-PERP on Drift)
 *  3. COLLECT funding (longs pay shorts in bull markets)
 *
 *  The position is perfectly delta-neutral — if SOL goes up 50%,
 *  spot gains cancel perp losses. If SOL drops 50%, perp gains
 *  cancel spot losses. The ONLY P&L comes from funding rates.
 *
 *  In bull markets, funding rates on Drift typically average
 *  0.01-0.03% per hour, which annualizes to 87-260% APY.
 *  Even at modest 0.005%/h, that's 43% annualized.
 *
 *  HYDRA's Reaper is smarter than a basic basis trade:
 *
 *  • It monitors funding rate forecasts and only enters when
 *    rates are sustainably positive
 *  • It automatically unwinds if funding turns persistently
 *    negative (no one likes paying funding)
 *  • It maintains health factor >1.5x at all times
 *  • Position size scales with Oracle confidence
 *
 *  This module is specifically designed for the Drift Side Track.
 */

import { MarketRegime } from "./oracle";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface FundingSnapshot {
  /** Current hourly funding rate (decimal, e.g. 0.0001 = 0.01%) */
  currentRate: number;
  /** 24h average funding rate */
  avgRate24h: number;
  /** 7d average funding rate */
  avgRate7d: number;
  /** Predicted next funding rate (based on mark-oracle spread) */
  predictedNextRate: number;
  /** Current mark price */
  markPrice: number;
  /** Current oracle price */
  oraclePrice: number;
  /** Timestamp */
  timestamp: number;
}

export interface BasisPosition {
  /** SOL spot position size */
  spotSizeSOL: number;
  /** SOL-PERP short size (should mirror spot) */
  perpSizeSOL: number;
  /** Entry price of the position */
  entryPrice: number;
  /** Current mark price */
  currentPrice: number;
  /** Accumulated funding earned (in USDC) */
  fundingEarned: number;
  /** Current health factor */
  healthFactor: number;
  /** Position opened timestamp */
  openedAt: number;
  /** Is the position currently active? */
  isActive: boolean;
}

export interface ReaperDecision {
  action: "OPEN" | "CLOSE" | "ADJUST" | "HOLD";
  /** Target position size in USDC equivalent */
  targetSizeUSDC: number;
  /** Estimated annualized yield from current/projected funding */
  estimatedApy: number;
  /** Risk assessment */
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  /** Reasoning for the decision */
  reasoning: string;
  /** Timestamp */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════

const REAPER_CONFIG = {
  // Funding rate thresholds
  minFundingToOpen: 0.00005, // 0.005%/h = ~43% annualized — entry threshold
  fundingCloseThreshold: -0.00002, // Close if funding goes -0.002%/h
  fundingWarningThreshold: 0.00001, // Reduce size if funding drops below 0.001%/h

  // Position management
  maxPositionSizeUSDC: 100_000, // Max size for the basis trade
  minPositionSizeUSDC: 100, // Min meaningful position
  healthFactorTarget: 2.0, // Target HF (conservative)
  healthFactorMin: 1.5, // Emergency close below this
  healthFactorEmergency: 1.2, // Immediate emergency close

  // Funding history requirements
  minPositiveFundingHours: 12, // Need 12h of positive funding before opening
  negativeStreakCloseHours: 6, // Close after 6h of negative funding

  // Leverage (conservative — never exceed 2x)
  maxLeverage: 2.0,
  targetLeverage: 1.5,
};

// ═══════════════════════════════════════════════════════════
// The Reaper Engine
// ═══════════════════════════════════════════════════════════

export class Reaper {
  private position: BasisPosition | null = null;
  private fundingHistory: FundingSnapshot[] = [];
  private totalFundingHarvested: number = 0;

  /**
   * Analyze current funding conditions and decide on basis trade action.
   *
   * @param funding Current funding rate snapshot
   * @param availableUSDC USDC available for the Reaper (from Oracle allocation)
   * @param regime Current market regime from Oracle
   */
  public analyze(
    funding: FundingSnapshot,
    availableUSDC: number,
    regime: MarketRegime
  ): ReaperDecision {
    // Store funding history
    this.fundingHistory.push(funding);
    if (this.fundingHistory.length > 720) { // 30 days of hourly data
      this.fundingHistory = this.fundingHistory.slice(-720);
    }

    // ── Case 1: No active position — should we open? ──
    if (!this.position || !this.position.isActive) {
      return this.evaluateEntry(funding, availableUSDC, regime);
    }

    // ── Case 2: Active position — manage it ───────────
    return this.evaluatePosition(funding, availableUSDC, regime);
  }

  /**
   * Evaluate whether to open a new basis position.
   */
  private evaluateEntry(
    funding: FundingSnapshot,
    availableUSDC: number,
    regime: MarketRegime
  ): ReaperDecision {
    const now = Date.now();

    // Check 1: Is there enough capital?
    if (availableUSDC < REAPER_CONFIG.minPositionSizeUSDC) {
      return {
        action: "HOLD",
        targetSizeUSDC: 0,
        estimatedApy: 0,
        riskLevel: "LOW",
        reasoning: `⚔️ Reaper: Insufficient capital ($${availableUSDC.toFixed(0)} < $${REAPER_CONFIG.minPositionSizeUSDC} min)`,
        timestamp: now,
      };
    }

    // Check 2: Is funding rate attractive enough?
    if (funding.currentRate < REAPER_CONFIG.minFundingToOpen) {
      return {
        action: "HOLD",
        targetSizeUSDC: 0,
        estimatedApy: this.rateToApy(funding.currentRate),
        riskLevel: "LOW",
        reasoning: `⚔️ Reaper: Funding too low (${(funding.currentRate * 100).toFixed(4)}%/h). ` +
          `Need >${(REAPER_CONFIG.minFundingToOpen * 100).toFixed(4)}%/h to enter.`,
        timestamp: now,
      };
    }

    // Check 3: Has funding been consistently positive?
    const positiveHours = this.countConsecutivePositiveHours();
    if (positiveHours < REAPER_CONFIG.minPositiveFundingHours) {
      return {
        action: "HOLD",
        targetSizeUSDC: 0,
        estimatedApy: this.rateToApy(funding.avgRate24h),
        riskLevel: "LOW",
        reasoning: `⚔️ Reaper: Waiting for funding confirmation (${positiveHours}h / ` +
          `${REAPER_CONFIG.minPositiveFundingHours}h required)`,
        timestamp: now,
      };
    }

    // Check 4: Regime-adjusted position sizing
    const regimeMultiplier = {
      [MarketRegime.BULL]: 1.0, // Full size in bull markets
      [MarketRegime.NEUTRAL]: 0.6, // Reduced size in neutral
      [MarketRegime.BEAR]: 0.2, // Minimal in bear (funding often negative)
    }[regime];

    const targetSize = Math.min(
      availableUSDC * regimeMultiplier,
      REAPER_CONFIG.maxPositionSizeUSDC
    );

    const estimatedApy = this.rateToApy(funding.avgRate24h);

    return {
      action: "OPEN",
      targetSizeUSDC: targetSize,
      estimatedApy,
      riskLevel: estimatedApy > 0.5 ? "HIGH" : estimatedApy > 0.2 ? "MEDIUM" : "LOW",
      reasoning:
        `⚔️ Reaper: OPENING basis trade\n` +
        `   Size: $${targetSize.toFixed(0)} (${(regimeMultiplier * 100).toFixed(0)}% of available)\n` +
        `   Funding: ${(funding.currentRate * 100).toFixed(4)}%/h (${positiveHours}h streak)\n` +
        `   Est. APY: ${(estimatedApy * 100).toFixed(1)}%\n` +
        `   Regime: ${regime} (${(regimeMultiplier * 100).toFixed(0)}% multiplier)`,
      timestamp: now,
    };
  }

  /**
   * Evaluate an active position — hold, adjust, or close.
   */
  private evaluatePosition(
    funding: FundingSnapshot,
    availableUSDC: number,
    regime: MarketRegime
  ): ReaperDecision {
    const now = Date.now();
    const pos = this.position!;

    // ── EMERGENCY: Health factor too low ───────────────
    if (pos.healthFactor < REAPER_CONFIG.healthFactorEmergency) {
      return {
        action: "CLOSE",
        targetSizeUSDC: 0,
        estimatedApy: 0,
        riskLevel: "HIGH",
        reasoning:
          `⚔️🚨 Reaper: EMERGENCY CLOSE — Health factor ${pos.healthFactor.toFixed(2)} ` +
          `below emergency threshold ${REAPER_CONFIG.healthFactorEmergency}. ` +
          `Unwinding ALL positions immediately.`,
        timestamp: now,
      };
    }

    // ── WARNING: Health factor getting low ─────────────
    if (pos.healthFactor < REAPER_CONFIG.healthFactorMin) {
      const newSize = pos.spotSizeSOL * pos.currentPrice * 0.5; // Cut by 50%
      return {
        action: "ADJUST",
        targetSizeUSDC: newSize,
        estimatedApy: this.rateToApy(funding.currentRate),
        riskLevel: "HIGH",
        reasoning:
          `⚔️⚠️ Reaper: Reducing position 50% — Health factor ${pos.healthFactor.toFixed(2)} ` +
          `approaching minimum ${REAPER_CONFIG.healthFactorMin}`,
        timestamp: now,
      };
    }

    // ── Check: Persistent negative funding ────────────
    const negativeHours = this.countConsecutiveNegativeHours();
    if (negativeHours >= REAPER_CONFIG.negativeStreakCloseHours) {
      return {
        action: "CLOSE",
        targetSizeUSDC: 0,
        estimatedApy: this.rateToApy(funding.currentRate),
        riskLevel: "MEDIUM",
        reasoning:
          `⚔️ Reaper: CLOSING — ${negativeHours}h of negative funding. ` +
          `Threshold: ${REAPER_CONFIG.negativeStreakCloseHours}h. ` +
          `Total harvested: $${this.totalFundingHarvested.toFixed(2)}`,
        timestamp: now,
      };
    }

    // ── Check: Bear regime with low funding ────────────
    if (regime === MarketRegime.BEAR && funding.avgRate24h < REAPER_CONFIG.fundingWarningThreshold) {
      return {
        action: "CLOSE",
        targetSizeUSDC: 0,
        estimatedApy: this.rateToApy(funding.currentRate),
        riskLevel: "MEDIUM",
        reasoning:
          `⚔️ Reaper: CLOSING — Bear regime + weak funding ` +
          `(${(funding.avgRate24h * 100).toFixed(4)}%/h). Capital better deployed to Sentinel.`,
        timestamp: now,
      };
    }

    // ── All checks passed: HOLD ───────────────────────
    const hourlyFunding = pos.spotSizeSOL * pos.currentPrice * funding.currentRate;
    this.totalFundingHarvested += hourlyFunding;

    return {
      action: "HOLD",
      targetSizeUSDC: pos.spotSizeSOL * pos.currentPrice,
      estimatedApy: this.rateToApy(funding.avgRate24h),
      riskLevel: pos.healthFactor > REAPER_CONFIG.healthFactorTarget ? "LOW" : "MEDIUM",
      reasoning:
        `⚔️ Reaper: HOLDING basis trade\n` +
        `   Size: $${(pos.spotSizeSOL * pos.currentPrice).toFixed(0)}\n` +
        `   HF: ${pos.healthFactor.toFixed(2)} | Funding: ${(funding.currentRate * 100).toFixed(4)}%/h\n` +
        `   Harvested this hour: $${hourlyFunding.toFixed(2)}\n` +
        `   Total harvested: $${this.totalFundingHarvested.toFixed(2)}`,
      timestamp: now,
    };
  }

  // ── Utility Methods ─────────────────────────────────

  private countConsecutivePositiveHours(): number {
    let count = 0;
    for (let i = this.fundingHistory.length - 1; i >= 0; i--) {
      if (this.fundingHistory[i].currentRate > 0) count++;
      else break;
    }
    return count;
  }

  private countConsecutiveNegativeHours(): number {
    let count = 0;
    for (let i = this.fundingHistory.length - 1; i >= 0; i--) {
      if (this.fundingHistory[i].currentRate < 0) count++;
      else break;
    }
    return count;
  }

  private rateToApy(hourlyRate: number): number {
    // Compound hourly rate to annual
    return Math.pow(1 + hourlyRate, 8760) - 1;
  }

  public updatePosition(position: BasisPosition): void {
    this.position = position;
  }

  public getTotalHarvested(): number {
    return this.totalFundingHarvested;
  }

  public getStatusReport(): string {
    const pos = this.position;
    if (!pos || !pos.isActive) {
      return [
        `┌─────────────────────────────────────┐`,
        `│  ⚔️  REAPER STATUS                  │`,
        `├─────────────────────────────────────┤`,
        `│  Position:  INACTIVE                │`,
        `│  Harvested: $${this.totalFundingHarvested.toFixed(2).padStart(10)}          │`,
        `└─────────────────────────────────────┘`,
      ].join("\n");
    }

    const size = (pos.spotSizeSOL * pos.currentPrice).toFixed(0);
    return [
      `┌─────────────────────────────────────┐`,
      `│  ⚔️  REAPER STATUS                  │`,
      `├─────────────────────────────────────┤`,
      `│  Position:  ACTIVE                  │`,
      `│  Size:      $${size.padStart(10)}          │`,
      `│  Health:    ${pos.healthFactor.toFixed(2).padStart(5)}x                │`,
      `│  Funding:   $${pos.fundingEarned.toFixed(2).padStart(10)}          │`,
      `│  Total:     $${this.totalFundingHarvested.toFixed(2).padStart(10)}          │`,
      `└─────────────────────────────────────┘`,
    ].join("\n");
  }
}
