#!/usr/bin/env node
import { ethers } from "ethers";
import { parseTransactionArgs } from "../../src/lib/args.js";
import { confirmPrompt } from "../../src/lib/common.js";
import { executeBatchTransactions } from "../../src/lib/transaction.js";
import { config } from "../../src/config/config.js";

(async function main() {
  try {
    const args = parseTransactionArgs();

    if (args["dry-run"]) {
      console.log("Dry-run mode is not fully supported in this version.");
      process.exit(0);
    }

    // Get basic info for confirmation
    const privateKey = config.privateKey;
    if (!privateKey) {
      console.error("PRIVATE_KEY not set in environment (.env). Aborting.");
      process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(args.rpc);
    const wallet = new ethers.Wallet(privateKey, provider);
    const sender = await wallet.getAddress();
    
    const summary = `
SUMMARY
  Sender: ${sender}
  Token: ${args.token}
  To: ${args.to}
  Count: ${args.count}
  Amount range: ${args.min} - ${args.max}
`;
    const ok = await confirmPrompt(summary);
    if (!ok) {
      console.log("Aborted by user.");
      process.exit(0);
    }

    // Execute batch transactions
    const result = await executeBatchTransactions(
      {
        privateKey,
        rpc: args.rpc,
        token: args.token,
        to: args.to,
        count: args.count,
        min: args.min,
        max: args.max,
        delay: args.delay,
        retries: args.retries,
        logDir: args.log || "logs",
        verbose: args.verbose
      }
    );

    console.log(`All done in ${result.duration}s. Tx log saved to ${result.logPath}`);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
})();
