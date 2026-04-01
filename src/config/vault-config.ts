/**
 * ██╗  ██╗██╗   ██╗██████╗ ██████╗  █████╗
 * ██║  ██║╚██╗ ██╔╝██╔══██╗██╔══██╗██╔══██╗
 * ███████║ ╚████╔╝ ██║  ██║██████╔╝███████║
 * ██╔══██║  ╚██╔╝  ██║  ██║██╔══██╗██╔══██║
 * ██║  ██║   ██║   ██████╔╝██║  ██║██║  ██║
 * ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
 *
 * Hybrid Yield Dynamic Rebalancing Architecture
 * AI-Powered Multi-Protocol Vault Strategy for Ranger Earn
 *
 * Built for the 🐻 Build-A-Bear Hackathon
 */

import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

// ═══════════════════════════════════════════════════════════════
// Protocol Registry — The Heads of the Hydra
// ═══════════════════════════════════════════════════════════════

export enum Protocol {
  DRIFT = "drift",
  KAMINO = "kamino",
  MARGINFI = "marginfi",
  SOLEND = "solend",
}

export interface ProtocolConfig {
  name: string;
  protocol: Protocol;
  adaptorProgramId: PublicKey;
  riskScore: number; // 0-100, lower = safer
  maxAllocationPct: number; // Max % of vault this protocol can hold
  minRebalanceAmount: number; // Min USDC to make rebalance worthwhile
  enabled: boolean;
}

// ═══════════════════════════════════════════════════════════════
// Vault Configuration
// ═══════════════════════════════════════════════════════════════

export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

export const USDC_DECIMALS = 6;

/**
 * Ranger Earn Adaptor Program IDs
 * Source: https://docs.ranger.finance/vault-owners/strategies/setup-guide
 */
export const LENDING_ADAPTOR_ID = new PublicKey(
  "aVoLTRCRt3NnnchvLYH6rMYehJHwM5m45RmLBZq7PGz"
);

export const DRIFT_ADAPTOR_ID = new PublicKey(
  "EBN93eXs5fHGBABuajQqdsKRkCgaqtJa8vEFD6vKXiP"
);

export const SPOT_ADAPTOR_ID = new PublicKey(
  "to6Eti9CsC5FGkAtqiPphvKD2hiQiLsS8zWiDBqBPKR"
);

/**
 * The HYDRA Protocol Registry
 * Each "head" of the Hydra is a yield source
 */
export const PROTOCOL_REGISTRY: ProtocolConfig[] = [
  {
    name: "Drift Lending",
    protocol: Protocol.DRIFT,
    adaptorProgramId: DRIFT_ADAPTOR_ID,
    riskScore: 15,
    maxAllocationPct: 40,
    minRebalanceAmount: 100,
    enabled: true,
  },
  {
    name: "Kamino Main Market",
    protocol: Protocol.KAMINO,
    adaptorProgramId: LENDING_ADAPTOR_ID,
    riskScore: 20,
    maxAllocationPct: 35,
    minRebalanceAmount: 100,
    enabled: true,
  },
  {
    name: "MarginFi",
    protocol: Protocol.MARGINFI,
    adaptorProgramId: LENDING_ADAPTOR_ID,
    riskScore: 25,
    maxAllocationPct: 30,
    minRebalanceAmount: 100,
    enabled: true,
  },
  {
    name: "Solend",
    protocol: Protocol.SOLEND,
    adaptorProgramId: LENDING_ADAPTOR_ID,
    riskScore: 30,
    maxAllocationPct: 25,
    minRebalanceAmount: 100,
    enabled: true,
  },
];

// ═══════════════════════════════════════════════════════════════
// Vault Parameters
// ═══════════════════════════════════════════════════════════════

export const VAULT_CONFIG = {
  name: "HYDRA Yield Vault",
  description: "AI-optimized multi-protocol USDC yield",

  // Fee structure (competitive but profitable)
  managerPerformanceFee: 1000, // 10% of profits
  adminPerformanceFee: 0, // 0%
  managerManagementFee: 50, // 0.5% annual
  adminManagementFee: 0, // 0%
  redemptionFee: 10, // 0.1%
  issuanceFee: 5, // 0.05%

  // Lock period: 3-month rolling (required by hackathon)
  withdrawalWaitingPeriod: new BN(7776000), // 90 days in seconds

  // Profit smoothing: 24h degradation
  lockedProfitDegradationDuration: new BN(86400),

  // Max cap: uncapped for now
  maxCap: new BN("18446744073709551615"),

  // Start immediately
  startAtTs: new BN(0),
};

// ═══════════════════════════════════════════════════════════════
// HYDRA AI Engine Parameters
// ═══════════════════════════════════════════════════════════════

export const HYDRA_CONFIG = {
  // Rebalancing
  rebalanceIntervalMs: 60_000, // Check every 60s
  rebalanceThresholdApy: 0.5, // Only rebalance if gain > 0.5% APY
  minIdleBufferPct: 5, // Always keep 5% idle for withdrawals
  maxDrawdownPct: 3, // Emergency exit if drawdown > 3%

  // Risk Weights for Protocol Scoring
  riskWeights: {
    tvl: 0.30, // Higher TVL = safer
    auditScore: 0.25, // More audits = safer
    protocolAge: 0.20, // Older = more battle-tested
    incidentHistory: 0.25, // Fewer incidents = safer
  },

  // Anti-churn: minimum time between rebalances per protocol
  minTimeBetweenRebalancesMs: 3600_000, // 1 hour

  // Position limits
  maxProtocols: 4, // Max simultaneous protocol allocations
  minDiversification: 2, // Must be in at least 2 protocols
};
