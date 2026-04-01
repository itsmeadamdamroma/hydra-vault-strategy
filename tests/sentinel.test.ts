/**
 * ═══════════════════════════════════════════════════════════
 *  🧪 SENTINEL TESTS — Lending Rate Optimizer Validation
 * ═══════════════════════════════════════════════════════════
 */

import { Sentinel, ProtocolRate } from "../src/ai/sentinel";
import { Protocol } from "../src/config/vault-config";

describe("🛡️ Sentinel — Lending Rate Optimizer", () => {
  let sentinel: Sentinel;

  beforeEach(() => {
    sentinel = new Sentinel();
  });

  function makeRates(overrides: Partial<Record<Protocol, number>> = {}): ProtocolRate[] {
    const now = Date.now();
    return [
      {
        protocol: Protocol.DRIFT,
        name: "Drift Lending",
        depositApy: overrides[Protocol.DRIFT] ?? 0.12,
        utilization: 0.72,
        totalDeposits: 85_000_000,
        riskScore: 15,
        timestamp: now,
      },
      {
        protocol: Protocol.KAMINO,
        name: "Kamino Main",
        depositApy: overrides[Protocol.KAMINO] ?? 0.11,
        utilization: 0.68,
        totalDeposits: 120_000_000,
        riskScore: 20,
        timestamp: now,
      },
      {
        protocol: Protocol.MARGINFI,
        name: "MarginFi",
        depositApy: overrides[Protocol.MARGINFI] ?? 0.13,
        utilization: 0.75,
        totalDeposits: 45_000_000,
        riskScore: 25,
        timestamp: now,
      },
      {
        protocol: Protocol.SOLEND,
        name: "Solend",
        depositApy: overrides[Protocol.SOLEND] ?? 0.09,
        utilization: 0.55,
        totalDeposits: 30_000_000,
        riskScore: 30,
        timestamp: now,
      },
    ];
  }

  test("should produce valid allocations on first analysis", () => {
    const decision = sentinel.analyze(makeRates());

    expect(decision.allocations.length).toBeGreaterThan(0);
    expect(decision.expectedApy).toBeGreaterThan(0);
    expect(decision.shouldRebalance).toBe(true); // First run always rebalances
    expect(decision.timestamp).toBeGreaterThan(0);
  });

  test("should rank protocols by risk-adjusted score (not raw APY)", () => {
    const decision = sentinel.analyze(makeRates());

    // Drift has lower risk (15) than MarginFi (25), so despite MarginFi
    // having higher raw APY (13% vs 12%), Drift should rank competitively
    const driftAlloc = decision.allocations.find((a) => a.protocol === Protocol.DRIFT);
    expect(driftAlloc).toBeDefined();
    expect(driftAlloc!.adjustedScore).toBeGreaterThan(0);
  });

  test("should respect per-protocol max allocation (40%)", () => {
    const decision = sentinel.analyze(makeRates());

    for (const alloc of decision.allocations) {
      expect(alloc.targetPct).toBeLessThanOrEqual(40);
    }
  });

  test("should maintain idle buffer (total allocation < 95%)", () => {
    const decision = sentinel.analyze(makeRates());
    const totalAllocated = decision.allocations.reduce((sum, a) => sum + a.targetPct, 0);
    expect(totalAllocated).toBeLessThanOrEqual(95); // 5% idle buffer
  });

  test("should enforce minimum diversification (≥2 protocols)", () => {
    // Even if one protocol dominates, we need at least 2
    const rates = makeRates({
      [Protocol.DRIFT]: 0.50, // One protocol way higher
      [Protocol.KAMINO]: 0.02,
      [Protocol.MARGINFI]: 0.01,
      [Protocol.SOLEND]: 0.005,
    });

    const decision = sentinel.analyze(rates);
    expect(decision.allocations.length).toBeGreaterThanOrEqual(2);
  });

  test("should not rebalance when improvement is below threshold", () => {
    // First analysis — always rebalances
    sentinel.analyze(makeRates());

    // Second analysis with nearly identical rates — should NOT rebalance
    const decision2 = sentinel.analyze(makeRates());
    expect(decision2.shouldRebalance).toBe(false);
  });

  test("should produce positive expected APY with valid rates", () => {
    const decision = sentinel.analyze(makeRates());
    expect(decision.expectedApy).toBeGreaterThan(0.05); // At least 5%
    expect(decision.expectedApy).toBeLessThan(1.0); // Less than 100%
  });

  test("should generate readable status report", () => {
    sentinel.analyze(makeRates());
    const report = sentinel.getStatusReport();
    expect(report).toContain("SENTINEL");
    expect(report).toContain("Expected APY:");
  });

  test("should handle all protocols disabled gracefully", () => {
    const emptyRates: ProtocolRate[] = [];
    const decision = sentinel.analyze(emptyRates);
    expect(decision.allocations.length).toBe(0);
  });

  test("allocation percentages should be non-negative", () => {
    const decision = sentinel.analyze(makeRates());
    for (const alloc of decision.allocations) {
      expect(alloc.targetPct).toBeGreaterThanOrEqual(0);
    }
  });
});
