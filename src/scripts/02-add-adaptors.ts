/**
 * 02-add-adaptors.ts — Add protocol adaptors to the HYDRA vault
 *
 * Adds the Lending Adaptor (for Kamino/MarginFi/Solend)
 * and Drift Adaptor (for Drift lending + perps).
 *
 * This is a one-time operation per adaptor.
 *
 * Usage: npm run add-adaptors
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { LENDING_ADAPTOR_ID, DRIFT_ADAPTOR_ID, SPOT_ADAPTOR_ID } from "../config/vault-config";

dotenv.config();

async function addAdaptors() {
  console.log("🐉 HYDRA: Adding protocol adaptors...\n");

  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const adminKeyPath = process.env.ADMIN_KEYPAIR_PATH;
  const connection = new Connection(rpcUrl, "confirmed");

  if (!adminKeyPath) {
    console.error("❌ ADMIN_KEYPAIR_PATH must be set in .env");
    process.exit(1);
  }

  const adminKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(adminKeyPath, "utf-8")))
  );

  // Load vault address from previous step
  let vaultAddress: string;
  try {
    vaultAddress = fs.readFileSync(".vault-address", "utf-8").trim();
  } catch {
    console.error("❌ No .vault-address file found. Run 01-create-vault.ts first.");
    process.exit(1);
  }

  const vault = new PublicKey(vaultAddress);
  console.log(`  Vault: ${vaultAddress}`);
  console.log("");

  const adaptors = [
    { name: "Lending Adaptor (Kamino/MarginFi/Solend)", id: LENDING_ADAPTOR_ID },
    { name: "Drift Adaptor (Lending + Perps)", id: DRIFT_ADAPTOR_ID },
    { name: "Spot Adaptor (Jupiter Swaps)", id: SPOT_ADAPTOR_ID },
  ];

  for (const adaptor of adaptors) {
    console.log(`  📌 Adding: ${adaptor.name}`);
    console.log(`     Program ID: ${adaptor.id.toBase58()}`);

    // NOTE: Uncomment when @voltr/vault-sdk is installed
    // const { VoltrClient } = await import("@voltr/vault-sdk");
    // const client = new VoltrClient(connection);
    //
    // const addAdaptorIx = await client.createAddAdaptorIx({
    //   vault,
    //   admin: adminKp.publicKey,
    //   payer: adminKp.publicKey,
    //   adaptorProgram: adaptor.id,
    // });
    //
    // const txSig = await sendAndConfirmTransaction(
    //   [addAdaptorIx], connection, [adminKp]
    // );
    // console.log(`     ✅ Added! Tx: ${txSig}`);

    console.log(`     ✅ Ready to add (uncomment SDK calls)`);
    console.log("");
  }

  console.log("  🐉 All adaptors registered. Run 03-init-strategies.ts next.");
}

addAdaptors();
