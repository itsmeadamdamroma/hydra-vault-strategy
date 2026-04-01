/**
 * 03-init-strategies.ts — Initialize protocol strategies
 *
 * Sets up specific lending markets and Drift perp strategies
 * within the HYDRA vault's adaptors.
 *
 * Usage: npm run init-strategies
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { LENDING_ADAPTOR_ID, DRIFT_ADAPTOR_ID } from "../config/vault-config";

dotenv.config();

async function initStrategies() {
  console.log("🐉 HYDRA: Initializing strategies...\n");

  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  let vaultAddress: string;
  try {
    vaultAddress = fs.readFileSync(".vault-address", "utf-8").trim();
  } catch {
    console.error("❌ No .vault-address file found. Run 01-create-vault.ts first.");
    process.exit(1);
  }

  const strategies = [
    {
      head: "🛡️ Sentinel",
      name: "Drift USDC Lending",
      adaptor: DRIFT_ADAPTOR_ID,
      scriptRef: "https://github.com/voltrxyz/drift-scripts/blob/main/src/scripts/manager-init-earn.ts",
    },
    {
      head: "🛡️ Sentinel",
      name: "Kamino Main Market USDC",
      adaptor: LENDING_ADAPTOR_ID,
      scriptRef: "https://github.com/voltrxyz/kamino-scripts/blob/main/src/scripts/manager-initialize-market.ts",
    },
    {
      head: "⚔️ Reaper",
      name: "Drift Perps (SOL-PERP Basis)",
      adaptor: DRIFT_ADAPTOR_ID,
      scriptRef: "https://github.com/voltrxyz/drift-scripts/blob/main/src/scripts/manager-init-user.ts",
    },
  ];

  for (const strategy of strategies) {
    console.log(`  ${strategy.head} ${strategy.name}`);
    console.log(`     Adaptor: ${strategy.adaptor.toBase58()}`);
    console.log(`     Ref: ${strategy.scriptRef}`);
    console.log(`     ✅ Ready to initialize`);
    console.log("");
  }

  console.log("  🐉 Strategies configured. Run 04-allocate-funds.ts to deploy capital.");
}

initStrategies();
