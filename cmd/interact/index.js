#!/usr/bin/env node
import { config } from "../../src/config/config.js";
import { 
  signMessage, 
  signTypedData, 
  sendRawTransaction,
  getWalletInfo 
} from "../../src/lib/interact.js";
import { parseInteractArgs } from "../../src/lib/args.js";

(async function main() {
  try {
    const privateKey = config.privateKey;
    if (!privateKey) {
      console.error("PRIVATE_KEY not set in .env");
      process.exit(1);
    }

    const args = parseInteractArgs();

    switch (args.action) {
      case "sign": {
        if (!args.message) {
          console.error("Missing --message");
          process.exit(1);
        }

        const result = await signMessage({
          privateKey,
          message: args.message
        });

        console.log("\nMessage Signed");
        console.log("Address:", result.address);
        console.log("Message:", result.message);
        console.log("Signature:", result.signature);
        break;
      }

      case "send-raw": {
        if (!args.rpc || !args.to || !args.data) {
          console.error("Missing required args: --rpc, --to, --data");
          process.exit(1);
        }

        console.log("\nSending transaction...");
        console.log("To:", args.to);
        console.log("Data:", args.data);
        console.log("RPC:", args.rpc);

        const result = await sendRawTransaction({
          privateKey,
          rpc: args.rpc,
          to: args.to,
          data: args.data,
          value: args.value || "0",
          gasLimit: args.gasLimit,
          chainId: args.chainId ? parseInt(args.chainId) : undefined
        });

        console.log("\nTransaction Sent");
        console.log("Hash:", result.hash);
        console.log("From:", result.from);
        console.log("Block:", result.blockNumber);
        console.log("Status:", result.status === 1 ? "Success" : "Failed");
        console.log("Gas Used:", result.gasUsed);
        break;
      }

      case "wallet": {
        if (!args.rpc) {
          console.error("Missing --rpc");
          process.exit(1);
        }

        const result = await getWalletInfo({
          privateKey,
          rpc: args.rpc
        });

        console.log("\nWallet Info");
        console.log("Address:", result.address);
        console.log("Balance:", result.balance, "ETH");
        console.log("Nonce:", result.nonce);
        console.log("Chain ID:", result.chainId);
        console.log("Network:", result.network);
        break;
      }

      default:
        console.error("Unknown action:", args.action);
        console.log("Use --help to see available actions");
        process.exit(1);
    }

  } catch (err) {
    console.error("\nError:", err.message);
    process.exit(1);
  }
})();
