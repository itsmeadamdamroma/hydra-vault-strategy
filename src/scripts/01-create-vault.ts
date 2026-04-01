/**
 * 01-create-vault.ts — Initialize the HYDRA vault on Ranger Earn
 *
 * This script:
 * 1. Connects to Solana mainnet via RPC
 * 2. Creates a new vault using the @voltr/vault-sdk
 * 3. Sets USDC as the base asset
 * 4. Configures fees, lock period, and profit degradation
 *
 * Usage: npm run create-vault
 */

import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { VAULT_CONFIG, USDC_MINT } from "../config/vault-config";

dotenv.config();

async function createVault() {
  console.log("🐉 HYDRA: Creating vault on Ranger Earn...\n");

  // ── Load Configuration ──────────────────────────────
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const adminKeyPath = process.env.ADMIN_KEYPAIR_PATH;
  const managerKeyPath = process.env.MANAGER_KEYPAIR_PATH;

  if (!adminKeyPath || !managerKeyPath) {
    console.error("❌ ADMIN_KEYPAIR_PATH and MANAGER_KEYPAIR_PATH must be set in .env");
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, "confirmed");

  // Load keypairs
  const adminKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(adminKeyPath, "utf-8")))
  );
  const managerKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(managerKeyPath, "utf-8")))
  );

  console.log(`  Admin:   ${adminKp.publicKey.toBase58()}`);
  console.log(`  Manager: ${managerKp.publicKey.toBase58()}`);
  console.log(`  Asset:   USDC (${USDC_MINT.toBase58()})`);
  console.log("");

  // ── Vault Configuration ─────────────────────────────
  const vaultConfig = {
    maxCap: VAULT_CONFIG.maxCap,
    startAtTs: VAULT_CONFIG.startAtTs,
    lockedProfitDegradationDuration: VAULT_CONFIG.lockedProfitDegradationDuration,
    managerPerformanceFee: VAULT_CONFIG.managerPerformanceFee,
    adminPerformanceFee: VAULT_CONFIG.adminPerformanceFee,
    managerManagementFee: VAULT_CONFIG.managerManagementFee,
    adminManagementFee: VAULT_CONFIG.adminManagementFee,
    redemptionFee: VAULT_CONFIG.redemptionFee,
    issuanceFee: VAULT_CONFIG.issuanceFee,
    withdrawalWaitingPeriod: VAULT_CONFIG.withdrawalWaitingPeriod,
  };

  const vaultParams = {
    config: vaultConfig,
    name: VAULT_CONFIG.name,
    description: VAULT_CONFIG.description,
  };

  console.log("  📋 Vault Parameters:");
  console.log(`     Name: ${VAULT_CONFIG.name}`);
  console.log(`     Perf Fee: ${VAULT_CONFIG.managerPerformanceFee / 100}%`);
  console.log(`     Mgmt Fee: ${VAULT_CONFIG.managerManagementFee / 100}%`);
  console.log(`     Lock Period: ${VAULT_CONFIG.withdrawalWaitingPeriod.toNumber() / 86400} days`);
  console.log(`     Profit Smoothing: ${VAULT_CONFIG.lockedProfitDegradationDuration.toNumber() / 3600}h`);
  console.log("");

  // ── Create Vault ────────────────────────────────────
  try {
    // NOTE: Uncomment when @voltr/vault-sdk is installed
    // const { VoltrClient } = await import("@voltr/vault-sdk");
    // const client = new VoltrClient(connection);
    // const vaultKp = Keypair.generate();
    //
    // const createVaultIx = await client.createInitializeVaultIx(
    //   vaultParams,
    //   {
    //     vault: vaultKp,
    //     vaultAssetMint: USDC_MINT,
    //     admin: adminKp.publicKey,
    //     manager: managerKp.publicKey,
    //     payer: adminKp.publicKey,
    //   }
    // );
    //
    // const txSig = await sendAndConfirmTransaction(
    //   [createVaultIx],
    //   connection,
    //   [adminKp, vaultKp]
    // );
    //
    // console.log(`  ✅ Vault created!`);
    // console.log(`     Address: ${vaultKp.publicKey.toBase58()}`);
    // console.log(`     Tx: ${txSig}`);
    //
    // // Save vault address for other scripts
    // fs.writeFileSync(
    //   ".vault-address",
    //   vaultKp.publicKey.toBase58()
    // );

    console.log("  📝 Vault creation script ready.");
    console.log("     Set ADMIN_KEYPAIR_PATH and MANAGER_KEYPAIR_PATH in .env");
    console.log("     Then uncomment the SDK calls above and run: npm run create-vault");
    console.log("");
    console.log("  🔗 Or use the Ranger UI: https://vaults.ranger.finance/create");
  } catch (error) {
    console.error("❌ Failed to create vault:", error);
    process.exit(1);
  }
}

createVault();
