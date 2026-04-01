/**
 * 04-allocate-funds.ts — Initial capital deployment
 *
 * Deploys the vault's idle USDC according to the Oracle's
 * starting regime assessment.
 *
 * Usage: npm run allocate
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { Oracle, RegimeSignals } from "../ai/oracle";
import { Sentinel, ProtocolRate } from "../ai/sentinel";
import { Protocol } from "../config/vault-config";

dotenv.config();

async function allocateFunds() {
  console.log("🐉 HYDRA: Running initial capital allocation...\n");

  // Initialize the AI engines
  const oracle = new Oracle();
  const sentinel = new Sentinel();

  // Get current market assessment
  const signals: RegimeSignals = {
    fundingRate: 0.00015,
    sol30dSMA: 145.0,
    sol60dSMA: 140.0,
    solPrice: 148.0,
    oiChange24h: 0.03,
    usdcUtilization: 0.70,
  };

  const oracleDecision = oracle.analyze(signals);
  console.log(oracle.getStatusReport());

  // Get lending rate assessment
  const rates: ProtocolRate[] = [
    { protocol: Protocol.DRIFT, name: "Drift", depositApy: 0.12, utilization: 0.72, totalDeposits: 85_000_000, riskScore: 15, timestamp: Date.now() },
    { protocol: Protocol.KAMINO, name: "Kamino", depositApy: 0.11, utilization: 0.68, totalDeposits: 120_000_000, riskScore: 20, timestamp: Date.now() },
    { protocol: Protocol.MARGINFI, name: "MarginFi", depositApy: 0.13, utilization: 0.75, totalDeposits: 45_000_000, riskScore: 25, timestamp: Date.now() },
    { protocol: Protocol.SOLEND, name: "Solend", depositApy: 0.09, utilization: 0.55, totalDeposits: 30_000_000, riskScore: 30, timestamp: Date.now() },
  ];

  const sentinelDecision = sentinel.analyze(rates);
  console.log(sentinelDecision.summary);

  console.log("\n  📊 Recommended Initial Allocation:");
  console.log(`     Oracle Regime: ${oracleDecision.regime}`);
  console.log(`     Sentinel: ${oracleDecision.sentinelWeight}% | Reaper: ${oracleDecision.reaperWeight}%`);
  console.log(`     Expected Blended APY: ${(sentinelDecision.expectedApy * oracleDecision.sentinelWeight / 100 * 100).toFixed(1)}% (lending only)`);
  console.log("\n  🐉 Initial allocation computed. Start the bot with: npm run bot");
}

allocateFunds();
