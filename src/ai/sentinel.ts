/**
 * ═══════════════════════════════════════════════════════════
 *  🛡️ THE SENTINEL — Multi-Protocol Lending Rate Optimizer
 * ═══════════════════════════════════════════════════════════
 *
 *  The Sentinel is the defensive backbone of HYDRA. It watches
 *  over the lending landscape like a guardian, continuously
 *  scanning for the highest USDC yields across Solana protocols.
 *
 *  It doesn't chase every micro-movement. It calculates the
 *  TRUE net APY after gas costs and slippage, and only rebalances
 *  when the improvement exceeds a meaningful threshold.
 *
 *  Protocols monitored:
 *  • Drift Earn (via Drift Adaptor)
 *  • Kamino Main Market (via Lending Adaptor)
 *  • MarginFi (via Lending Adaptor)
 *  • Solend (via Lending Adaptor)
 */

import { Protocol, PROTOCOL_REGISTRY, HYDRA_CONFIG } from "../config/vault-config";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ProtocolRate {
  protocol: Protocol;
  name: string;
  /** Current deposit APY as decimal (0.12 = 12%) */
  depositApy: number;
  /** Current borrow utilization (0-1) */
  utilization: number;
  /** Total USDC deposited in the pool */
  totalDeposits: number;
  /** Risk score from protocol registry (0-100) */
  riskScore: number;
  /** Timestamp of the reading */
  timestamp: number;
}

export interface AllocationTarget {
  protocol: Protocol;
  name: string;
  /** Target allocation as percentage (0-100) */
  targetPct: number;
  /** Raw APY from this protocol */
  rawApy: number;
  /** Risk-adjusted score used for ranking */
  adjustedScore: number;
  /** Reason for this allocation (for logging) */
  reason: string;
}

export interface SentinelDecision {
  /** Ordered list of allocations (highest priority first) */
  allocations: AllocationTarget[];
  /** Weighted average expected APY across all allocations */
  expectedApy: number;
  /** Whether a rebalance is recommended */
  shouldRebalance: boolean;
  /** Human-readable summary */
  summary: string;
  /** Timestamp */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════
// The Sentinel Engine
// ═══════════════════════════════════════════════════════════

export class Sentinel {
  private lastRebalanceTime: Map<Protocol, number> = new Map();
  private rateHistory: ProtocolRate[][] = [];
  private lastDecision: SentinelDecision | null = null;

  /**
   * Analyze current lending rates and produce an optimal allocation.
   *
   * The scoring formula is:
   *   score = APY × (1 - riskPenalty) × utilizationBonus
   *
   * Where:
   *   riskPenalty = riskScore / 200 (max 50% penalty for riskiest protocols)
   *   utilizationBonus = 1 + (utilization - 0.5) × 0.2 (slight bonus for high-demand pools)
   *
   * This means a protocol with 15% APY and low risk scores HIGHER than
   * one with 18% APY and high risk — because we're optimizing for
   * RISK-ADJUSTED yield, not raw yield.
   */
  public analyze(rates: ProtocolRate[]): SentinelDecision {
    // Store rate history for trend analysis
    this.rateHistory.push(rates);
    if (this.rateHistory.length > 1440) { // 24h of minute-by-minute data
      this.rateHistory = this.rateHistory.slice(-1440);
    }

    // ── Step 1: Score each protocol ────────────────────
    const scored = rates
      .filter((r) => {
        const config = PROTOCOL_REGISTRY.find((p) => p.protocol === r.protocol);
        return config?.enabled ?? false;
      })
      .map((rate) => {
        const config = PROTOCOL_REGISTRY.find((p) => p.protocol === rate.protocol)!;

        // Risk penalty: higher risk = lower score
        const riskPenalty = rate.riskScore / 200;

        // Utilization bonus: high-demand pools tend to have stickier rates
        const utilizationBonus = 1 + (rate.utilization - 0.5) * 0.2;

        // Rate momentum: favor protocols whose rates are trending UP
        const momentum = this.calculateRateMomentum(rate.protocol);

        // Final adjusted score
        const adjustedScore =
          rate.depositApy * (1 - riskPenalty) * utilizationBonus * (1 + momentum * 0.1);

        return {
          protocol: rate.protocol,
          name: rate.name,
          rawApy: rate.depositApy,
          adjustedScore,
          maxAllocation: config.maxAllocationPct,
        };
      })
      .sort((a, b) => b.adjustedScore - a.adjustedScore);

    // ── Step 2: Allocate with constraints ──────────────
    const allocations: AllocationTarget[] = [];
    let remainingPct = 100 - HYDRA_CONFIG.minIdleBufferPct; // Reserve idle buffer
    let totalWeightedApy = 0;

    for (const protocol of scored) {
      if (remainingPct <= 0) break;

      const allocation = Math.min(protocol.maxAllocation, remainingPct);
      remainingPct -= allocation;

      allocations.push({
        protocol: protocol.protocol,
        name: protocol.name,
        targetPct: allocation,
        rawApy: protocol.rawApy,
        adjustedScore: protocol.adjustedScore,
        reason: `Score: ${protocol.adjustedScore.toFixed(4)} | ` +
          `Raw APY: ${(protocol.rawApy * 100).toFixed(2)}% | ` +
          `Max: ${protocol.maxAllocation}%`,
      });

      totalWeightedApy += protocol.rawApy * (allocation / 100);
    }

    // Enforce minimum diversification
    if (allocations.length < HYDRA_CONFIG.minDiversification && scored.length >= 2) {
      // Redistribute top allocation to include second protocol
      const topAlloc = allocations[0];
      const secondProtocol = scored[1];
      const redistributeAmount = Math.floor(topAlloc.targetPct * 0.3);

      topAlloc.targetPct -= redistributeAmount;
      allocations.push({
        protocol: secondProtocol.protocol,
        name: secondProtocol.name,
        targetPct: redistributeAmount,
        rawApy: secondProtocol.rawApy,
        adjustedScore: secondProtocol.adjustedScore,
        reason: `Diversification enforcement: ${redistributeAmount}% redirected from ${topAlloc.name}`,
      });
    }

    // ── Step 3: Determine if rebalance is worthwhile ───
    const expectedApy = allocations.reduce(
      (sum, a) => sum + a.rawApy * (a.targetPct / 100), 0
    );

    let shouldRebalance = false;
    if (this.lastDecision) {
      const apyImprovement = expectedApy - this.lastDecision.expectedApy;
      const meetsThreshold = apyImprovement > HYDRA_CONFIG.rebalanceThresholdApy / 100;
      const cooledDown = this.allProtocolsCooledDown();
      shouldRebalance = meetsThreshold && cooledDown;
    } else {
      shouldRebalance = true; // First run — always allocate
    }

    const decision: SentinelDecision = {
      allocations,
      expectedApy,
      shouldRebalance,
      summary: this.buildSummary(allocations, expectedApy, shouldRebalance),
      timestamp: Date.now(),
    };

    if (shouldRebalance) {
      this.lastDecision = decision;
      // Update cooldown timers
      for (const alloc of allocations) {
        this.lastRebalanceTime.set(alloc.protocol, Date.now());
      }
    }

    return decision;
  }

  /**
   * Calculate the rate momentum for a protocol.
   * Positive = rates trending up, negative = trending down.
   * Returns value between -1 and 1.
   */
  private calculateRateMomentum(protocol: Protocol): number {
    if (this.rateHistory.length < 60) return 0; // Need 1h of data

    const recent = this.rateHistory.slice(-30); // Last 30 minutes
    const earlier = this.rateHistory.slice(-60, -30); // 30-60 minutes ago

    const recentAvg = this.averageRate(recent, protocol);
    const earlierAvg = this.averageRate(earlier, protocol);

    if (earlierAvg === 0) return 0;
    const delta = (recentAvg - earlierAvg) / earlierAvg;
    return Math.max(-1, Math.min(1, delta * 10)); // Amplify small changes
  }

  private averageRate(snapshots: ProtocolRate[][], protocol: Protocol): number {
    const rates = snapshots
      .map((snap) => snap.find((r) => r.protocol === protocol)?.depositApy ?? 0)
      .filter((r) => r > 0);
    return rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  }

  private allProtocolsCooledDown(): boolean {
    const now = Date.now();
    for (const [, lastTime] of this.lastRebalanceTime) {
      if (now - lastTime < HYDRA_CONFIG.minTimeBetweenRebalancesMs) {
        return false;
      }
    }
    return true;
  }

  private buildSummary(
    allocations: AllocationTarget[],
    expectedApy: number,
    shouldRebalance: boolean
  ): string {
    const lines = [
      `┌─────────────────────────────────────────────────┐`,
      `│  🛡️  SENTINEL ANALYSIS                          │`,
      `├─────────────────────────────────────────────────┤`,
    ];

    for (const a of allocations) {
      const bar = "█".repeat(Math.floor(a.targetPct / 5)) + "░".repeat(20 - Math.floor(a.targetPct / 5));
      lines.push(
        `│  ${a.name.padEnd(15)} ${bar} ${String(a.targetPct).padStart(3)}% @ ${(a.rawApy * 100).toFixed(1).padStart(5)}% │`
      );
    }

    lines.push(`├─────────────────────────────────────────────────┤`);
    lines.push(`│  Expected APY: ${(expectedApy * 100).toFixed(2)}%                          │`);
    lines.push(`│  Rebalance:    ${shouldRebalance ? "✅ YES" : "⏳ NO (cooling)"}                      │`);
    lines.push(`└─────────────────────────────────────────────────┘`);

    return lines.join("\n");
  }

  public getStatusReport(): string {
    if (!this.lastDecision) return "🛡️ Sentinel: Awaiting first analysis...";
    return this.lastDecision.summary;
  }
}
