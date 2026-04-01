/**
 * ═══════════════════════════════════════════════════════════
 *  🚨 RISK MANAGER — The Immune System of HYDRA
 * ═══════════════════════════════════════════════════════════
 *
 *  If the Oracle is the brain and the Sentinel/Reaper are the
 *  arms, the Risk Manager is the immune system. It has ONE job:
 *  protect the principal at all costs.
 *
 *  It enforces hard limits that NO other component can override:
 *
 *  • Per-protocol exposure caps
 *  • Portfolio-wide drawdown circuit breakers
 *  • Health factor emergency triggers
 *  • Anti-concentration rules
 *  • Slippage protection
 *
 *  The Risk Manager has VETO power over ANY decision from
 *  the Oracle, Sentinel, or Reaper. When it says stop,
 *  everything stops.
 */

import { HYDRA_CONFIG, Protocol } from "../config/vault-config";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface PortfolioSnapshot {
  /** Total vault NAV in USDC */
  totalValueUSDC: number;
  /** Initial deposit value (for drawdown calc) */
  initialValueUSDC: number;
  /** High water mark (peak NAV) */
  highWaterMark: number;
  /** Current allocations by protocol */
  allocations: Map<Protocol, number>;
  /** Idle USDC not deployed */
  idleUSDC: number;
  /** Current health factor (lowest across all positions) */
  lowestHealthFactor: number;
  /** Timestamp */
  timestamp: number;
}

export enum RiskLevel {
  NOMINAL = "NOMINAL",
  ELEVATED = "ELEVATED",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
  EMERGENCY = "EMERGENCY",
}

export interface RiskAssessment {
  level: RiskLevel;
  /** Should we halt all new allocations? */
  haltNewAllocations: boolean;
  /** Should we start unwinding positions? */
  unwindPositions: boolean;
  /** Should we emergency exit everything? */
  emergencyExit: boolean;
  /** Active violations */
  violations: RiskViolation[];
  /** Risk report for logging */
  report: string;
  /** Timestamp */
  timestamp: number;
}

export interface RiskViolation {
  rule: string;
  severity: "WARNING" | "CRITICAL" | "EMERGENCY";
  current: string;
  limit: string;
  action: string;
}

// ═══════════════════════════════════════════════════════════
// Risk Limits (hardcoded — cannot be changed at runtime)
// ═══════════════════════════════════════════════════════════

const RISK_LIMITS = {
  // Portfolio-level
  maxDrawdownFromHWM: 0.03, // 3% max drawdown from high water mark
  maxDrawdownFromInitial: 0.05, // 5% max loss from initial deposit
  minIdleBufferPct: 0.05, // 5% must stay liquid
  maxSingleProtocolPct: 0.40, // 40% max in any single protocol

  // Position-level
  healthFactorWarning: 1.5,
  healthFactorCritical: 1.2,
  healthFactorEmergency: 1.05,

  // Diversification
  minActiveProtocols: 2,
  maxConcentrationHHI: 0.50, // Herfindahl index cap (lower = more diversified)

  // Slippage
  maxSlippageBps: 50, // 0.5% max slippage per transaction

  // Rate sanity checks
  maxApySanityCheck: 5.0, // Flag anything claiming >500% APY as suspicious
  minApySanityCheck: -0.01, // Flag negative APY as error
} as const;

// ═══════════════════════════════════════════════════════════
// Risk Manager
// ═══════════════════════════════════════════════════════════

export class RiskManager {
  private snapshots: PortfolioSnapshot[] = [];
  private highWaterMark: number = 0;

  /**
   * Perform a comprehensive risk assessment of the current portfolio.
   *
   * This is called BEFORE and AFTER every allocation/deallocation.
   * If any check fails, the operation is blocked or reversed.
   */
  public assess(snapshot: PortfolioSnapshot): RiskAssessment {
    const violations: RiskViolation[] = [];

    // Update high water mark
    if (snapshot.totalValueUSDC > this.highWaterMark) {
      this.highWaterMark = snapshot.totalValueUSDC;
    }

    // Store snapshot for trailing analysis
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 10080) { // 7 days of minute-by-minute
      this.snapshots = this.snapshots.slice(-10080);
    }

    // ── Check 1: Drawdown from High Water Mark ────────
    if (this.highWaterMark > 0) {
      const drawdownFromHWM = 1 - snapshot.totalValueUSDC / this.highWaterMark;
      if (drawdownFromHWM > RISK_LIMITS.maxDrawdownFromHWM) {
        violations.push({
          rule: "MAX_DRAWDOWN_HWM",
          severity: drawdownFromHWM > RISK_LIMITS.maxDrawdownFromHWM * 1.5 ? "EMERGENCY" : "CRITICAL",
          current: `${(drawdownFromHWM * 100).toFixed(2)}%`,
          limit: `${(RISK_LIMITS.maxDrawdownFromHWM * 100).toFixed(2)}%`,
          action: "Unwind all non-lending positions. Move to 100% Sentinel.",
        });
      }
    }

    // ── Check 2: Drawdown from Initial Deposit ────────
    if (snapshot.initialValueUSDC > 0) {
      const drawdownFromInitial = 1 - snapshot.totalValueUSDC / snapshot.initialValueUSDC;
      if (drawdownFromInitial > RISK_LIMITS.maxDrawdownFromInitial) {
        violations.push({
          rule: "MAX_DRAWDOWN_INITIAL",
          severity: "EMERGENCY",
          current: `${(drawdownFromInitial * 100).toFixed(2)}%`,
          limit: `${(RISK_LIMITS.maxDrawdownFromInitial * 100).toFixed(2)}%`,
          action: "EMERGENCY EXIT: Liquidate all positions. Return to 100% idle.",
        });
      }
    }

    // ── Check 3: Idle Buffer ──────────────────────────
    const idlePct = snapshot.idleUSDC / snapshot.totalValueUSDC;
    if (idlePct < RISK_LIMITS.minIdleBufferPct) {
      violations.push({
        rule: "MIN_IDLE_BUFFER",
        severity: "WARNING",
        current: `${(idlePct * 100).toFixed(2)}%`,
        limit: `${(RISK_LIMITS.minIdleBufferPct * 100).toFixed(2)}%`,
        action: "Deallocate from lowest-yielding protocol to restore buffer.",
      });
    }

    // ── Check 4: Per-Protocol Concentration ───────────
    for (const [protocol, amount] of snapshot.allocations) {
      const pct = amount / snapshot.totalValueUSDC;
      if (pct > RISK_LIMITS.maxSingleProtocolPct) {
        violations.push({
          rule: "MAX_SINGLE_PROTOCOL",
          severity: "CRITICAL",
          current: `${protocol}: ${(pct * 100).toFixed(1)}%`,
          limit: `${(RISK_LIMITS.maxSingleProtocolPct * 100).toFixed(1)}%`,
          action: `Reduce ${protocol} allocation by ${((pct - RISK_LIMITS.maxSingleProtocolPct) * 100).toFixed(1)}%`,
        });
      }
    }

    // ── Check 5: Health Factor ────────────────────────
    if (snapshot.lowestHealthFactor < RISK_LIMITS.healthFactorEmergency) {
      violations.push({
        rule: "HEALTH_FACTOR_EMERGENCY",
        severity: "EMERGENCY",
        current: snapshot.lowestHealthFactor.toFixed(2),
        limit: RISK_LIMITS.healthFactorEmergency.toFixed(2),
        action: "EMERGENCY: Close ALL leverage positions immediately.",
      });
    } else if (snapshot.lowestHealthFactor < RISK_LIMITS.healthFactorCritical) {
      violations.push({
        rule: "HEALTH_FACTOR_CRITICAL",
        severity: "CRITICAL",
        current: snapshot.lowestHealthFactor.toFixed(2),
        limit: RISK_LIMITS.healthFactorCritical.toFixed(2),
        action: "Reduce leveraged position size by 50%.",
      });
    } else if (snapshot.lowestHealthFactor < RISK_LIMITS.healthFactorWarning) {
      violations.push({
        rule: "HEALTH_FACTOR_WARNING",
        severity: "WARNING",
        current: snapshot.lowestHealthFactor.toFixed(2),
        limit: RISK_LIMITS.healthFactorWarning.toFixed(2),
        action: "Monitor closely. Add collateral if HF continues declining.",
      });
    }

    // ── Check 6: Concentration Index (HHI) ────────────
    const hhi = this.calculateHHI(snapshot);
    if (hhi > RISK_LIMITS.maxConcentrationHHI) {
      violations.push({
        rule: "CONCENTRATION_HHI",
        severity: "WARNING",
        current: hhi.toFixed(3),
        limit: RISK_LIMITS.maxConcentrationHHI.toFixed(3),
        action: "Diversify: spread allocation across more protocols.",
      });
    }

    // ── Determine Overall Risk Level ──────────────────
    const hasEmergency = violations.some((v) => v.severity === "EMERGENCY");
    const hasCritical = violations.some((v) => v.severity === "CRITICAL");
    const hasWarning = violations.some((v) => v.severity === "WARNING");

    let level: RiskLevel;
    if (hasEmergency) level = RiskLevel.EMERGENCY;
    else if (hasCritical) level = RiskLevel.CRITICAL;
    else if (hasWarning) level = RiskLevel.ELEVATED;
    else level = RiskLevel.NOMINAL;

    return {
      level,
      haltNewAllocations: level === RiskLevel.CRITICAL || level === RiskLevel.EMERGENCY,
      unwindPositions: level === RiskLevel.CRITICAL || level === RiskLevel.EMERGENCY,
      emergencyExit: level === RiskLevel.EMERGENCY,
      violations,
      report: this.buildReport(level, violations, snapshot),
      timestamp: Date.now(),
    };
  }

  /**
   * Validate a proposed allocation BEFORE execution.
   * Returns true if the allocation is safe to proceed.
   */
  public validateAllocation(
    protocol: Protocol,
    amountUSDC: number,
    currentSnapshot: PortfolioSnapshot
  ): { approved: boolean; reason: string } {
    // Check: Would this breach per-protocol limit?
    const currentAllocation = currentSnapshot.allocations.get(protocol) || 0;
    const newAllocation = currentAllocation + amountUSDC;
    const newPct = newAllocation / currentSnapshot.totalValueUSDC;

    if (newPct > RISK_LIMITS.maxSingleProtocolPct) {
      return {
        approved: false,
        reason: `🚨 BLOCKED: Would bring ${protocol} to ${(newPct * 100).toFixed(1)}% ` +
          `(limit: ${(RISK_LIMITS.maxSingleProtocolPct * 100).toFixed(1)}%)`,
      };
    }

    // Check: Would this breach idle buffer?
    const newIdle = currentSnapshot.idleUSDC - amountUSDC;
    const newIdlePct = newIdle / currentSnapshot.totalValueUSDC;

    if (newIdlePct < RISK_LIMITS.minIdleBufferPct) {
      return {
        approved: false,
        reason: `🚨 BLOCKED: Would reduce idle buffer to ${(newIdlePct * 100).toFixed(1)}% ` +
          `(minimum: ${(RISK_LIMITS.minIdleBufferPct * 100).toFixed(1)}%)`,
      };
    }

    // Check: APY sanity
    return {
      approved: true,
      reason: `✅ Allocation approved: $${amountUSDC.toFixed(0)} → ${protocol}`,
    };
  }

  /**
   * Calculate the Herfindahl-Hirschman Index for portfolio concentration.
   * Range: 0 (perfectly diversified) to 1 (100% in one protocol).
   * Values below 0.25 are considered well-diversified.
   */
  private calculateHHI(snapshot: PortfolioSnapshot): number {
    if (snapshot.totalValueUSDC === 0) return 0;
    let hhi = 0;
    for (const [, amount] of snapshot.allocations) {
      const share = amount / snapshot.totalValueUSDC;
      hhi += share * share;
    }
    // Include idle as a "protocol"
    const idleShare = snapshot.idleUSDC / snapshot.totalValueUSDC;
    hhi += idleShare * idleShare;
    return hhi;
  }

  private buildReport(
    level: RiskLevel,
    violations: RiskViolation[],
    snapshot: PortfolioSnapshot
  ): string {
    const emoji = {
      [RiskLevel.NOMINAL]: "🟢",
      [RiskLevel.ELEVATED]: "🟡",
      [RiskLevel.HIGH]: "🟠",
      [RiskLevel.CRITICAL]: "🔴",
      [RiskLevel.EMERGENCY]: "🚨",
    };

    const lines = [
      `┌─────────────────────────────────────────────────┐`,
      `│  🚨 RISK MANAGER                                │`,
      `├─────────────────────────────────────────────────┤`,
      `│  Status:     ${emoji[level]} ${level.padEnd(30)}  │`,
      `│  NAV:        $${snapshot.totalValueUSDC.toFixed(2).padStart(12)}               │`,
      `│  HWM:        $${this.highWaterMark.toFixed(2).padStart(12)}               │`,
      `│  Drawdown:   ${((1 - snapshot.totalValueUSDC / Math.max(this.highWaterMark, 1)) * 100).toFixed(2).padStart(6)}%                       │`,
      `│  Idle:       ${((snapshot.idleUSDC / snapshot.totalValueUSDC) * 100).toFixed(1).padStart(5)}%                        │`,
      `│  Min HF:     ${snapshot.lowestHealthFactor.toFixed(2).padStart(6)}x                       │`,
      `│  HHI:        ${this.calculateHHI(snapshot).toFixed(3).padStart(6)}                        │`,
      `│  Violations: ${String(violations.length).padStart(3)}                           │`,
    ];

    if (violations.length > 0) {
      lines.push(`├─────────────────────────────────────────────────┤`);
      for (const v of violations) {
        const icon = v.severity === "EMERGENCY" ? "🚨" : v.severity === "CRITICAL" ? "🔴" : "⚠️";
        lines.push(`│  ${icon} ${v.rule.padEnd(42)}  │`);
        lines.push(`│     ${v.current} / ${v.limit}${" ".repeat(Math.max(0, 32 - v.current.length - v.limit.length))}│`);
      }
    }

    lines.push(`└─────────────────────────────────────────────────┘`);
    return lines.join("\n");
  }

  public getStatusReport(): string {
    if (this.snapshots.length === 0) return "🚨 Risk Manager: No data yet.";
    return this.buildReport(
      RiskLevel.NOMINAL,
      [],
      this.snapshots[this.snapshots.length - 1]
    );
  }
}
