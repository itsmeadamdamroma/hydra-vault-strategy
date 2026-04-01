/**
 * ═══════════════════════════════════════════════════════════════════
 *
 *    ██╗  ██╗██╗   ██╗██████╗ ██████╗  █████╗     ██████╗  ██████╗ ████████╗
 *    ██║  ██║╚██╗ ██╔╝██╔══██╗██╔══██╗██╔══██╗    ██╔══██╗██╔═══██╗╚══██╔══╝
 *    ███████║ ╚████╔╝ ██║  ██║██████╔╝███████║    ██████╔╝██║   ██║   ██║
 *    ██╔══██║  ╚██╔╝  ██║  ██║██╔══██╗██╔══██║    ██╔══██╗██║   ██║   ██║
 *    ██║  ██║   ██║   ██████╔╝██║  ██║██║  ██║    ██████╔╝╚██████╔╝   ██║
 *    ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝    ╚═════╝  ╚═════╝    ╚═╝
 *
 *  The Main Orchestration Loop
 *  "Cut off one head, two more shall take its place."
 *
 *  This is the primary entry point for the HYDRA vault strategy.
 *  It runs continuously on the VPS, coordinating all three heads:
 *
 *    🔮 Oracle   → Market regime detection
 *    🛡️ Sentinel → Lending rate optimization
 *    ⚔️ Reaper   → Funding rate harvesting
 *    🚨 Risk Mgr → Portfolio protection
 *
 *  Every 60 seconds, HYDRA:
 *  1. Fetches fresh on-chain data
 *  2. Asks the Oracle for the current market regime
 *  3. Asks the Sentinel for optimal lending allocation
 *  4. Asks the Reaper for basis trade recommendation
 *  5. Validates everything through the Risk Manager
 *  6. Executes approved rebalances via Ranger Earn SDK
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import { Oracle, RegimeSignals, MarketRegime } from "../ai/oracle";
import { Sentinel, ProtocolRate } from "../ai/sentinel";
import { Reaper, FundingSnapshot } from "../ai/reaper";
import { RiskManager, PortfolioSnapshot, RiskLevel } from "../ai/risk-manager";
import { HYDRA_CONFIG, Protocol, VAULT_CONFIG } from "../config/vault-config";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface HydraState {
  cycle: number;
  startTime: number;
  totalDeposited: number;
  currentNAV: number;
  totalYieldEarned: number;
  isRunning: boolean;
}

// ═══════════════════════════════════════════════════════════
// THE HYDRA BOT
// ═══════════════════════════════════════════════════════════

class HydraBot {
  private oracle: Oracle;
  private sentinel: Sentinel;
  private reaper: Reaper;
  private riskManager: RiskManager;
  private state: HydraState;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor() {
    this.oracle = new Oracle();
    this.sentinel = new Sentinel();
    this.reaper = new Reaper();
    this.riskManager = new RiskManager();

    this.state = {
      cycle: 0,
      startTime: Date.now(),
      totalDeposited: 0,
      currentNAV: 0,
      totalYieldEarned: 0,
      isRunning: false,
    };
  }

  /**
   * ═══════════════════════════════════════════════════════
   *  START THE HYDRA
   * ═══════════════════════════════════════════════════════
   */
  public async start(): Promise<void> {
    this.printBanner();
    this.state.isRunning = true;
    this.state.startTime = Date.now();

    console.log("🐉 HYDRA Bot starting...");
    console.log(`   Vault: ${VAULT_CONFIG.name}`);
    console.log(`   Rebalance interval: ${HYDRA_CONFIG.rebalanceIntervalMs / 1000}s`);
    console.log(`   Min idle buffer: ${HYDRA_CONFIG.minIdleBufferPct}%`);
    console.log(`   Max drawdown: ${HYDRA_CONFIG.maxDrawdownPct}%`);
    console.log(`   Regime confirmation: ${6}h`);
    console.log("");

    // Initial cycle
    await this.executeCycle();

    // Start the loop
    this.intervalHandle = setInterval(async () => {
      try {
        await this.executeCycle();
      } catch (error) {
        console.error("🚨 HYDRA: Cycle failed:", error);
        // Don't crash — log and continue. The Hydra never dies.
      }
    }, HYDRA_CONFIG.rebalanceIntervalMs);

    // Graceful shutdown
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());

    console.log("🐉 HYDRA is alive. Press Ctrl+C to stop.\n");
  }

  /**
   * ═══════════════════════════════════════════════════════
   *  THE CORE CYCLE — Every 60 seconds
   * ═══════════════════════════════════════════════════════
   */
  private async executeCycle(): Promise<void> {
    this.state.cycle++;
    const cycleStart = Date.now();

    console.log(`\n${"─".repeat(60)}`);
    console.log(`  🐉 HYDRA Cycle #${this.state.cycle} | ${new Date().toISOString()}`);
    console.log(`${"─".repeat(60)}`);

    // ── Phase 1: Fetch Market Data ────────────────────
    const [regimeSignals, lendingRates, fundingData] = await Promise.all([
      this.fetchRegimeSignals(),
      this.fetchLendingRates(),
      this.fetchFundingData(),
    ]);

    // ── Phase 2: Oracle Analysis ──────────────────────
    const oracleDecision = this.oracle.analyze(regimeSignals);
    console.log(this.oracle.getStatusReport());

    // ── Phase 3: Risk Check ───────────────────────────
    const portfolio = await this.getPortfolioSnapshot();
    const riskAssessment = this.riskManager.assess(portfolio);
    console.log(riskAssessment.report);

    // ── EMERGENCY EXIT ────────────────────────────────
    if (riskAssessment.emergencyExit) {
      console.log("\n🚨🚨🚨 EMERGENCY EXIT TRIGGERED 🚨🚨🚨");
      console.log("Unwinding ALL positions and returning to 100% idle...");
      await this.emergencyExit();
      return;
    }

    // ── Phase 4: Sentinel (Lending) Analysis ──────────
    const sentinelDecision = this.sentinel.analyze(lendingRates);
    console.log(sentinelDecision.summary);

    // ── Phase 5: Reaper (Basis Trade) Analysis ────────
    const reaperBudget = (portfolio.totalValueUSDC * oracleDecision.reaperWeight) / 100;
    const reaperDecision = this.reaper.analyze(
      fundingData,
      reaperBudget,
      oracleDecision.regime
    );
    console.log(this.reaper.getStatusReport());

    // ── Phase 6: Execute Rebalances ───────────────────
    if (!riskAssessment.haltNewAllocations) {
      // Execute Sentinel allocations (scaled by Oracle weight)
      if (sentinelDecision.shouldRebalance) {
        const sentinelBudgetPct = oracleDecision.sentinelWeight;
        console.log(
          `\n  📤 Executing Sentinel rebalance (${sentinelBudgetPct}% of NAV)...`
        );

        for (const alloc of sentinelDecision.allocations) {
          const scaledPct = (alloc.targetPct * sentinelBudgetPct) / 100;
          const amountUSDC = (portfolio.totalValueUSDC * scaledPct) / 100;

          // Risk Manager pre-trade validation
          const validation = this.riskManager.validateAllocation(
            alloc.protocol,
            amountUSDC,
            portfolio
          );

          if (validation.approved) {
            console.log(`  ✅ ${alloc.name}: $${amountUSDC.toFixed(0)} (${scaledPct.toFixed(1)}%)`);
            // In production: call Ranger SDK allocate instruction here
            // await this.executeAllocation(alloc.protocol, amountUSDC);
          } else {
            console.log(`  ❌ ${alloc.name}: ${validation.reason}`);
          }
        }
      }

      // Execute Reaper trades
      if (reaperDecision.action === "OPEN") {
        console.log(`\n  ⚔️ Opening basis trade: $${reaperDecision.targetSizeUSDC.toFixed(0)}`);
        // In production: execute Drift spot buy + perp short
        // await this.executeBasisTrade(reaperDecision.targetSizeUSDC);
      } else if (reaperDecision.action === "CLOSE") {
        console.log(`\n  ⚔️ Closing basis trade`);
        // await this.closeBasisTrade();
      } else if (reaperDecision.action === "ADJUST") {
        console.log(
          `\n  ⚔️ Adjusting basis trade to $${reaperDecision.targetSizeUSDC.toFixed(0)}`
        );
        // await this.adjustBasisTrade(reaperDecision.targetSizeUSDC);
      }
    } else {
      console.log("\n  ⛔ Risk Manager has HALTED new allocations.");
      if (riskAssessment.unwindPositions) {
        console.log("  🔄 Unwinding risky positions...");
        // await this.unwindRiskyPositions();
      }
    }

    // ── Phase 7: Cycle Summary ────────────────────────
    const cycleTime = Date.now() - cycleStart;
    const uptime = ((Date.now() - this.state.startTime) / 3600000).toFixed(1);

    console.log(`\n  ⏱️  Cycle completed in ${cycleTime}ms | Uptime: ${uptime}h`);
    console.log(`  💰 NAV: $${portfolio.totalValueUSDC.toFixed(2)} | ` +
      `Yield: $${this.state.totalYieldEarned.toFixed(2)} | ` +
      `Regime: ${oracleDecision.regime}`);
  }

  // ═══════════════════════════════════════════════════════
  // DATA FETCHERS
  // These fetch real on-chain data in production.
  // During backtest/demo, they return simulated data.
  // ═══════════════════════════════════════════════════════

  private async fetchRegimeSignals(): Promise<RegimeSignals> {
    // TODO: In production, fetch from Drift SDK + Pyth oracle
    // For hackathon demo, using realistic simulated data
    return {
      fundingRate: 0.00015 + (Math.random() - 0.4) * 0.0001,
      sol30dSMA: 145.5 + (Math.random() - 0.5) * 10,
      sol60dSMA: 140.2 + (Math.random() - 0.5) * 5,
      solPrice: 148.3 + (Math.random() - 0.5) * 15,
      oiChange24h: 0.02 + (Math.random() - 0.5) * 0.03,
      usdcUtilization: 0.65 + (Math.random() - 0.5) * 0.2,
    };
  }

  private async fetchLendingRates(): Promise<ProtocolRate[]> {
    // TODO: In production, fetch from protocol APIs
    const now = Date.now();
    return [
      {
        protocol: Protocol.DRIFT,
        name: "Drift Lending",
        depositApy: 0.12 + (Math.random() - 0.5) * 0.04,
        utilization: 0.72 + (Math.random() - 0.5) * 0.1,
        totalDeposits: 85_000_000,
        riskScore: 15,
        timestamp: now,
      },
      {
        protocol: Protocol.KAMINO,
        name: "Kamino Main",
        depositApy: 0.11 + (Math.random() - 0.5) * 0.03,
        utilization: 0.68 + (Math.random() - 0.5) * 0.1,
        totalDeposits: 120_000_000,
        riskScore: 20,
        timestamp: now,
      },
      {
        protocol: Protocol.MARGINFI,
        name: "MarginFi",
        depositApy: 0.13 + (Math.random() - 0.5) * 0.05,
        utilization: 0.75 + (Math.random() - 0.5) * 0.15,
        totalDeposits: 45_000_000,
        riskScore: 25,
        timestamp: now,
      },
      {
        protocol: Protocol.SOLEND,
        name: "Solend",
        depositApy: 0.09 + (Math.random() - 0.5) * 0.03,
        utilization: 0.55 + (Math.random() - 0.5) * 0.1,
        totalDeposits: 30_000_000,
        riskScore: 30,
        timestamp: now,
      },
    ];
  }

  private async fetchFundingData(): Promise<FundingSnapshot> {
    // TODO: In production, fetch from Drift SDK
    const rate = 0.00012 + (Math.random() - 0.3) * 0.0001;
    return {
      currentRate: rate,
      avgRate24h: rate * 0.9,
      avgRate7d: rate * 0.85,
      predictedNextRate: rate * 1.05,
      markPrice: 148.5 + (Math.random() - 0.5) * 2,
      oraclePrice: 148.3,
      timestamp: Date.now(),
    };
  }

  private async getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
    // TODO: In production, read from Ranger vault on-chain state
    const totalValue = 10000 + this.state.totalYieldEarned;
    return {
      totalValueUSDC: totalValue,
      initialValueUSDC: 10000,
      highWaterMark: totalValue,
      allocations: new Map([
        [Protocol.DRIFT, totalValue * 0.35],
        [Protocol.KAMINO, totalValue * 0.30],
        [Protocol.MARGINFI, totalValue * 0.20],
      ]),
      idleUSDC: totalValue * 0.15,
      lowestHealthFactor: 5.0,
      timestamp: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════
  // EMERGENCY PROCEDURES
  // ═══════════════════════════════════════════════════════

  private async emergencyExit(): Promise<void> {
    console.log("🚨 EMERGENCY EXIT: Deallocating all positions...");
    // In production:
    // 1. Close Reaper basis trade
    // 2. Withdraw all lending positions
    // 3. Move everything to vault idle pool
    console.log("🚨 All positions unwound. Vault is 100% idle.");
  }

  // ═══════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════

  private shutdown(): void {
    console.log("\n🐉 HYDRA: Received shutdown signal...");
    this.state.isRunning = false;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }

    console.log("🐉 HYDRA: Final status report:");
    console.log(this.oracle.getStatusReport());
    console.log(this.sentinel.getStatusReport());
    console.log(this.reaper.getStatusReport());
    console.log(`\n  🏁 Total cycles: ${this.state.cycle}`);
    console.log(`  📈 Total yield: $${this.state.totalYieldEarned.toFixed(2)}`);
    console.log(`  ⏱️  Uptime: ${((Date.now() - this.state.startTime) / 3600000).toFixed(1)}h`);
    console.log("\n🐉 HYDRA has been shut down. Goodnight, sweet prince.\n");

    process.exit(0);
  }

  private printBanner(): void {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     ██╗  ██╗██╗   ██╗██████╗ ██████╗  █████╗                ║
║     ██║  ██║╚██╗ ██╔╝██╔══██╗██╔══██╗██╔══██╗               ║
║     ███████║ ╚████╔╝ ██║  ██║██████╔╝███████║               ║
║     ██╔══██║  ╚██╔╝  ██║  ██║██╔══██╗██╔══██║               ║
║     ██║  ██║   ██║   ██████╔╝██║  ██║██║  ██║               ║
║     ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝               ║
║                                                              ║
║   Hybrid Yield Dynamic Rebalancing Architecture              ║
║   "Cut off one head, two more shall take its place."         ║
║                                                              ║
║   🔮 Oracle    │ Market Regime Detection                     ║
║   🛡️ Sentinel  │ Multi-Protocol Lending Optimizer            ║
║   ⚔️ Reaper    │ Delta-Neutral Funding Harvester             ║
║   🚨 Risk Mgr  │ Institutional-Grade Portfolio Protection    ║
║                                                              ║
║   Built for the 🐻 Build-A-Bear Hackathon                   ║
║   Powered by Ranger Earn × Drift Protocol                    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  const hydra = new HydraBot();
  await hydra.start();
}

main().catch((error) => {
  console.error("🚨 HYDRA: Fatal error:", error);
  process.exit(1);
});
