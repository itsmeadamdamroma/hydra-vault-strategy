/**
 * ═══════════════════════════════════════════════════════════
 *  🧪 RISK MANAGER TESTS — Portfolio Protection Validation
 * ═══════════════════════════════════════════════════════════
 */

import { RiskManager, PortfolioSnapshot, RiskLevel } from "../src/ai/risk-manager";
import { Protocol } from "../src/config/vault-config";

describe("🚨 Risk Manager — Portfolio Protection", () => {
  let riskManager: RiskManager;

  beforeEach(() => {
    riskManager = new RiskManager();
  });

  function makeSnapshot(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
    const defaults: PortfolioSnapshot = {
      totalValueUSDC: 10_000,
      initialValueUSDC: 10_000,
      highWaterMark: 10_000,
      allocations: new Map([
        [Protocol.DRIFT, 3500],
        [Protocol.KAMINO, 3000],
        [Protocol.MARGINFI, 2000],
      ]),
      idleUSDC: 1500,
      lowestHealthFactor: 5.0,
      timestamp: Date.now(),
    };
    return { ...defaults, ...overrides };
  }

  // ── Nominal State ───────────────────────────────────

  test("should return NOMINAL for healthy portfolio", () => {
    const assessment = riskManager.assess(makeSnapshot());
    expect(assessment.level).toBe(RiskLevel.NOMINAL);
    expect(assessment.haltNewAllocations).toBe(false);
    expect(assessment.unwindPositions).toBe(false);
    expect(assessment.emergencyExit).toBe(false);
    expect(assessment.violations.length).toBe(0);
  });

  // ── Drawdown Tests ──────────────────────────────────

  test("should trigger CRITICAL on 3%+ drawdown from HWM", () => {
    // First, establish a high water mark
    riskManager.assess(makeSnapshot({ totalValueUSDC: 10_000 }));

    // Now simulate a drawdown > 3%
    const assessment = riskManager.assess(makeSnapshot({
      totalValueUSDC: 9_600, // 4% drawdown from 10,000 HWM
    }));

    expect(assessment.level).not.toBe(RiskLevel.NOMINAL);
    const drawdownViolation = assessment.violations.find((v) => v.rule === "MAX_DRAWDOWN_HWM");
    expect(drawdownViolation).toBeDefined();
  });

  test("should trigger EMERGENCY on 5%+ drawdown from initial", () => {
    const assessment = riskManager.assess(makeSnapshot({
      totalValueUSDC: 9_400, // 6% drawdown from 10,000 initial
      initialValueUSDC: 10_000,
    }));

    expect(assessment.emergencyExit).toBe(true);
    const violation = assessment.violations.find((v) => v.rule === "MAX_DRAWDOWN_INITIAL");
    expect(violation).toBeDefined();
    expect(violation!.severity).toBe("EMERGENCY");
  });

  // ── Idle Buffer Tests ───────────────────────────────

  test("should warn when idle buffer is below 5%", () => {
    const assessment = riskManager.assess(makeSnapshot({
      idleUSDC: 200, // 2% of 10,000
    }));

    const bufferViolation = assessment.violations.find((v) => v.rule === "MIN_IDLE_BUFFER");
    expect(bufferViolation).toBeDefined();
    expect(bufferViolation!.severity).toBe("WARNING");
  });

  test("should not warn when idle buffer is at 5%+", () => {
    const assessment = riskManager.assess(makeSnapshot({
      idleUSDC: 600, // 6% of 10,000
    }));

    const bufferViolation = assessment.violations.find((v) => v.rule === "MIN_IDLE_BUFFER");
    expect(bufferViolation).toBeUndefined();
  });

  // ── Concentration Tests ─────────────────────────────

  test("should flag when single protocol exceeds 40%", () => {
    const allocations = new Map<Protocol, number>([
      [Protocol.DRIFT, 5000], // 50% — too concentrated
      [Protocol.KAMINO, 3000],
    ]);

    const assessment = riskManager.assess(makeSnapshot({
      allocations,
      idleUSDC: 2000,
    }));

    const concentrationViolation = assessment.violations.find(
      (v) => v.rule === "MAX_SINGLE_PROTOCOL"
    );
    expect(concentrationViolation).toBeDefined();
  });

  test("should not flag when all protocols are under 40%", () => {
    const assessment = riskManager.assess(makeSnapshot());

    const concentrationViolation = assessment.violations.find(
      (v) => v.rule === "MAX_SINGLE_PROTOCOL"
    );
    expect(concentrationViolation).toBeUndefined();
  });

  // ── Health Factor Tests ─────────────────────────────

  test("should EMERGENCY on health factor below 1.05", () => {
    const assessment = riskManager.assess(makeSnapshot({
      lowestHealthFactor: 1.02,
    }));

    expect(assessment.emergencyExit).toBe(true);
    const hfViolation = assessment.violations.find(
      (v) => v.rule === "HEALTH_FACTOR_EMERGENCY"
    );
    expect(hfViolation).toBeDefined();
  });

  test("should CRITICAL on health factor below 1.2", () => {
    const assessment = riskManager.assess(makeSnapshot({
      lowestHealthFactor: 1.15,
    }));

    const hfViolation = assessment.violations.find(
      (v) => v.rule === "HEALTH_FACTOR_CRITICAL"
    );
    expect(hfViolation).toBeDefined();
    expect(hfViolation!.severity).toBe("CRITICAL");
  });

  test("should WARNING on health factor below 1.5", () => {
    const assessment = riskManager.assess(makeSnapshot({
      lowestHealthFactor: 1.35,
    }));

    const hfViolation = assessment.violations.find(
      (v) => v.rule === "HEALTH_FACTOR_WARNING"
    );
    expect(hfViolation).toBeDefined();
    expect(hfViolation!.severity).toBe("WARNING");
  });

  test("should not flag healthy health factor (> 1.5)", () => {
    const assessment = riskManager.assess(makeSnapshot({
      lowestHealthFactor: 3.0,
    }));

    const hfViolations = assessment.violations.filter((v) =>
      v.rule.startsWith("HEALTH_FACTOR")
    );
    expect(hfViolations.length).toBe(0);
  });

  // ── Pre-Trade Validation ────────────────────────────

  test("should approve valid allocation", () => {
    const snapshot = makeSnapshot();
    const result = riskManager.validateAllocation(Protocol.SOLEND, 500, snapshot);
    expect(result.approved).toBe(true);
    expect(result.reason).toContain("✅");
  });

  test("should reject allocation that breaches per-protocol limit", () => {
    const snapshot = makeSnapshot();
    // Drift already has 3500, adding 2000 would make 5500 = 55%
    const result = riskManager.validateAllocation(Protocol.DRIFT, 2000, snapshot);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("BLOCKED");
  });

  test("should reject allocation that depletes idle buffer", () => {
    const snapshot = makeSnapshot({ idleUSDC: 600 }); // 6%
    // Trying to allocate 500 would leave only 100 = 1%
    const result = riskManager.validateAllocation(Protocol.SOLEND, 500, snapshot);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("BLOCKED");
  });

  // ── Report Generation ───────────────────────────────

  test("should generate readable risk report", () => {
    riskManager.assess(makeSnapshot());
    const report = riskManager.getStatusReport();
    expect(report).toContain("RISK MANAGER");
    expect(report).toContain("NAV:");
  });

  // ── Halt Behavior ───────────────────────────────────

  test("should halt allocations on CRITICAL level", () => {
    const assessment = riskManager.assess(makeSnapshot({
      lowestHealthFactor: 1.15, // CRITICAL
    }));

    expect(assessment.haltNewAllocations).toBe(true);
    expect(assessment.unwindPositions).toBe(true);
  });

  test("should NOT halt allocations on WARNING level", () => {
    const assessment = riskManager.assess(makeSnapshot({
      lowestHealthFactor: 1.35, // WARNING only
    }));

    expect(assessment.haltNewAllocations).toBe(false);
    expect(assessment.unwindPositions).toBe(false);
  });
});
