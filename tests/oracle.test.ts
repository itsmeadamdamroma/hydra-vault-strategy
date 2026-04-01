/**
 * ═══════════════════════════════════════════════════════════
 *  🧪 ORACLE TESTS — Market Regime Detection Validation
 * ═══════════════════════════════════════════════════════════
 */

import { Oracle, MarketRegime, RegimeSignals } from "../src/ai/oracle";

describe("🔮 Oracle — Market Regime Detection", () => {
  let oracle: Oracle;

  beforeEach(() => {
    oracle = new Oracle();
  });

  // ── Helper to create signals ────────────────────────
  function makeSignals(overrides: Partial<RegimeSignals> = {}): RegimeSignals {
    return {
      fundingRate: 0.0001,
      sol30dSMA: 145,
      sol60dSMA: 140,
      solPrice: 148,
      oiChange24h: 0.02,
      usdcUtilization: 0.65,
      ...overrides,
    };
  }

  test("should initialize in NEUTRAL regime", () => {
    const alloc = oracle.getCurrentAllocation();
    expect(alloc.regime).toBe(MarketRegime.NEUTRAL);
    expect(alloc.sentinelWeight).toBe(60);
    expect(alloc.reaperWeight).toBe(40);
  });

  test("should detect BULLISH signals (high funding + uptrend)", () => {
    const bullSignals = makeSignals({
      fundingRate: 0.008, // Very high funding
      sol30dSMA: 160,
      sol60dSMA: 140, // Strong uptrend
      oiChange24h: 0.08,
      usdcUtilization: 0.85,
    });

    // Run many cycles to trigger regime confirmation
    for (let i = 0; i < 100; i++) {
      oracle.analyze(bullSignals);
    }

    // Should still be NEUTRAL because confirmation takes 6 hours
    // (we'd need real time progression for full transition)
    const alloc = oracle.getCurrentAllocation();
    expect(alloc.regime).toBe(MarketRegime.NEUTRAL);
    expect(alloc.reasoning).toContain("Pending");
  });

  test("should detect BEARISH signals (negative funding + downtrend)", () => {
    const bearSignals = makeSignals({
      fundingRate: -0.005,
      sol30dSMA: 120,
      sol60dSMA: 140, // Downtrend
      oiChange24h: -0.05,
      usdcUtilization: 0.30,
    });

    const result = oracle.analyze(bearSignals);
    // First analysis won't change regime but should start pending
    expect(result.regime).toBe(MarketRegime.NEUTRAL);
  });

  test("should maintain allocation weights that sum to 100", () => {
    const signals = makeSignals();
    const result = oracle.analyze(signals);
    expect(result.sentinelWeight + result.reaperWeight).toBe(100);
  });

  test("should never allocate negative weights", () => {
    const extremeSignals = makeSignals({
      fundingRate: -0.01,
      sol30dSMA: 80,
      sol60dSMA: 150,
      oiChange24h: -0.1,
      usdcUtilization: 0.1,
    });

    const result = oracle.analyze(extremeSignals);
    expect(result.sentinelWeight).toBeGreaterThanOrEqual(0);
    expect(result.reaperWeight).toBeGreaterThanOrEqual(0);
  });

  test("should track regime history", () => {
    oracle.analyze(makeSignals());
    oracle.analyze(makeSignals({ fundingRate: 0.005 }));
    oracle.analyze(makeSignals({ fundingRate: -0.003 }));

    const history = oracle.getRegimeHistory();
    expect(history.length).toBe(3);
    expect(history[0]).toHaveProperty("regime");
    expect(history[0]).toHaveProperty("timestamp");
    expect(history[0]).toHaveProperty("score");
  });

  test("should return confidence between 0 and 1", () => {
    const result = oracle.analyze(makeSignals());
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test("should generate readable status report", () => {
    oracle.analyze(makeSignals());
    const report = oracle.getStatusReport();
    expect(report).toContain("ORACLE STATUS");
    expect(report).toContain("Regime:");
    expect(report).toContain("Confidence:");
  });

  test("should cancel pending regime shift if signal reverts", () => {
    // Send bullish signal
    oracle.analyze(makeSignals({ fundingRate: 0.008, sol30dSMA: 160, sol60dSMA: 140 }));
    let alloc = oracle.getCurrentAllocation();
    expect(alloc.reasoning).toContain("New signal");

    // Revert to neutral
    const result = oracle.analyze(makeSignals({ fundingRate: 0.0001, sol30dSMA: 142, sol60dSMA: 140 }));
    expect(result.reasoning).toContain("cancelled") ;
  });
});
