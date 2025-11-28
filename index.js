#!/usr/bin/env node
import { ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import { parseArgs } from "./src/lib/args.js";
import { sleep, randomDecimalString, confirmPrompt } from "./src/lib/common.js";
import { ERC20_ABI, CHAIN_ID_LINEA } from "./src/constant/constant.js";

dotenv.config();

(async function main() {
  try {
    const args = parseArgs();

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.error("PRIVATE_KEY not set in environment (.env). Aborting.");
      process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(args.rpc);
    try {
      await provider.getBlockNumber();
    } catch (e) {
      console.error("Cannot connect to RPC:", e.message || e);
      process.exit(1);
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    const sender = await wallet.getAddress();
    if (args.verbose) console.log("Using wallet:", sender);

    const tokenAddress = ethers.getAddress(args.token);
    const toAddress = ethers.getAddress(args.to);
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    const decimals = Number(await contract.decimals());
    if (args.verbose) console.log("Token decimals:", decimals);

    const tokenBalanceUnits = await contract.balanceOf(sender);
    const tokenBalanceFormatted = ethers.formatUnits(tokenBalanceUnits, decimals);
    if (args.verbose) console.log("Token balance:", tokenBalanceFormatted);

    const nativeBalanceWei = await provider.getBalance(sender);
    if (args.verbose) console.log("Native balance (ETH-ish):", ethers.formatEther(nativeBalanceWei));

    let estimatedGasPerTx = 120000;
    try {
      const sampleAmountUnits = tokenBalanceUnits > 0n ? ethers.parseUnits("0.01", decimals) : ethers.parseUnits("0.0001", decimals);
      const gasEstimate = await contract.transfer.estimateGas(toAddress, sampleAmountUnits);
      estimatedGasPerTx = Number(gasEstimate);
    } catch (e) {
      if (args.verbose) console.warn("Could not estimate gas precisely, using fallback:", estimatedGasPerTx, "Error:", e.message);
    }
    if (args.verbose) console.log("Estimated gas per tx:", estimatedGasPerTx);

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");
    const estTotalGasCost = gasPrice * BigInt(Math.ceil(estimatedGasPerTx * args.count));
    if (args.verbose) console.log("Current gasPrice (wei):", gasPrice.toString());
    if (args.verbose) console.log("Estimated total gas cost (wei):", estTotalGasCost.toString(), " (~", ethers.formatEther(estTotalGasCost), "ETH )");

    if (nativeBalanceWei < estTotalGasCost) {
      if (args.verbose) console.warn("Warning: native balance is less than estimated total gas cost — transactions may fail.");
    }

    const planned = [];
    let sumUnits = 0n;
    for (let i = 0; i < args.count; ++i) {
      const rndStr = randomDecimalString(args.min, args.max, 4);
      const units = ethers.parseUnits(rndStr, decimals);
      planned.push({ display: rndStr, units });
      sumUnits = sumUnits + units;
    }
    if (args.verbose) console.log("Total planned token amount (units):", sumUnits.toString(), " -> tokens:", ethers.formatUnits(sumUnits, decimals));
    if (sumUnits > tokenBalanceUnits) {
      console.error("Planned total exceeds token balance. Aborting.");
      process.exit(1);
    }

    const summary = `
SUMMARY
  Sender: ${sender}
  Token: ${tokenAddress}
  To: ${toAddress}
  Count: ${args.count}
  Total tokens to send: ${ethers.formatUnits(sumUnits, decimals)}
  Estimated total gas (wei): ${estTotalGasCost.toString()} (~${ethers.formatEther(estTotalGasCost)} ETH)
`;
    const ok = await confirmPrompt(summary);
    if (!ok) {
      console.log("Aborted by user.");
      process.exit(0);
    }

    if (args["dry-run"]) {
      console.log("Dry-run mode: no transactions will be broadcast.");
      planned.forEach((p, i) => {
        console.log(`Planned #${i + 1}: ${p.display} tokens -> units ${p.units.toString()}`);
      });
      process.exit(0);
    }

    const txLog = [];
    for (let i = 0; i < planned.length; ++i) {
      const { display, units } = planned[i];
      if (units === 0n) {
        if (args.verbose) console.warn(`Skipping tx #${i + 1} because units == 0`);
        continue;
      }

      let attempt = 0;
      let success = false;
      while (attempt < args.retries && !success) {
        attempt++;
        try {
          const nonce = await provider.getTransactionCount(sender, "pending");

          let gasLimit = estimatedGasPerTx;
          try {
            const estimate = await contract.transfer.estimateGas(toAddress, units);
            gasLimit = Math.max(Number(estimate) + 2000, 80000);
            gasLimit = Math.min(gasLimit, 250000);
          } catch (e) {
            gasLimit = Math.min(Math.max(estimatedGasPerTx + 2000, 80000), 250000);
          }

          const currentFeeData = await provider.getFeeData();
          const currentGasPrice = currentFeeData.gasPrice || ethers.parseUnits("1", "gwei");

          const txRequest = {
            to: tokenAddress,
            data: contract.interface.encodeFunctionData("transfer", [toAddress, units]),
            nonce: nonce,
            gasLimit: BigInt(gasLimit),
            gasPrice: currentGasPrice,
            chainId: CHAIN_ID_LINEA,
          };

          const signed = await wallet.signTransaction(txRequest);
          const sent = await provider.broadcastTransaction(signed);
          if (args.verbose) console.log(`Sent tx #${i + 1} amount=${display} tokens (units=${units.toString()}) nonce=${nonce} hash=${sent.hash}`);

          const receipt = await sent.wait(1).catch((err) => {
            if (args.verbose) console.warn(`Waiting for receipt for tx ${sent.hash} failed/timeout:`, err.message || err);
            return null;
          });

          if (receipt) {
            if (args.verbose) console.log(`Confirmed tx #${i + 1} in block ${receipt.blockNumber} status=${receipt.status}`);
          } else {
            console.warn(`No receipt yet for tx ${sent.hash}. Continueing - check this hash manually.`);
          }

          txLog.push({ index: i + 1, amount: display, units: units.toString(), nonce, hash: sent.hash });
          success = true;

          if (args.delay && args.delay > 0) await sleep(Math.round(args.delay * 1000));
        } catch (err) {
          console.error(`Attempt ${attempt} failed for tx #${i + 1}:`, err.message || err);
          const backoff = Math.min(5000 * attempt, 30000);
          console.log(`Retrying in ${backoff / 1000}s...`);
          await sleep(backoff);
          if (attempt >= args.retries) {
            console.error(`Max retries reached for tx #${i + 1}. Aborting remaining transactions.`);
            const base = args.log || "linea-20";
            fs.writeFileSync(base + ".txlog.json", JSON.stringify(txLog, null, 2));
            process.exit(1);
          }
        }
      }
    }

    const base = args.log || "linea-20";
    fs.writeFileSync(base + ".txlog.json", JSON.stringify(txLog, null, 2));
    console.log("All done. Tx log saved to", base + ".txlog.json");
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
})();
