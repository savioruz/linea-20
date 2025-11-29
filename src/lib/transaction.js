import { ethers } from "ethers";
import fs from "fs";
import { sleep, randomDecimalString } from "./common.js";
import { ERC20_ABI, CHAIN_ID_LINEA } from "../constant/constant.js";

export async function executeBatchTransactions(config, callbacks = {}) {
  const {
    privateKey,
    rpc,
    token,
    to,
    count = 20,
    min = "0.01",
    max = "0.5",
    delay = 1.0,
    retries = 3,
    logDir = "logs",
    verbose = false
  } = config;

  const {
    onStart,
    onProgress,
    onComplete,
    onError
  } = callbacks;

  try {
    const startTime = Date.now();

    if (!privateKey) {
      throw new Error("PRIVATE_KEY not set");
    }

    const provider = new ethers.JsonRpcProvider(rpc);
    await provider.getBlockNumber();

    const wallet = new ethers.Wallet(privateKey, provider);
    const sender = await wallet.getAddress();
    if (verbose) console.log("Using wallet:", sender);
    if (onStart) onStart({ wallet: sender });

    const tokenAddress = ethers.getAddress(token);
    const toAddress = ethers.getAddress(to);
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    const decimals = Number(await contract.decimals());
    if (verbose) console.log("Token decimals:", decimals);

    const tokenBalanceUnits = await contract.balanceOf(sender);
    const tokenBalanceFormatted = ethers.formatUnits(tokenBalanceUnits, decimals);
    if (verbose) console.log("Token balance:", tokenBalanceFormatted);

    const nativeBalanceWei = await provider.getBalance(sender);
    if (verbose) console.log("Native balance (ETH-ish):", ethers.formatEther(nativeBalanceWei));

    let estimatedGasPerTx = 120000;
    try {
      const sampleAmountUnits = tokenBalanceUnits > 0n ? ethers.parseUnits("0.01", decimals) : ethers.parseUnits("0.0001", decimals);
      const gasEstimate = await contract.transfer.estimateGas(toAddress, sampleAmountUnits);
      estimatedGasPerTx = Number(gasEstimate);
    } catch (e) {
      if (verbose) console.warn("Could not estimate gas precisely, using fallback:", estimatedGasPerTx, "Error:", e.message);
    }
    if (verbose) console.log("Estimated gas per tx:", estimatedGasPerTx);

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");
    const estTotalGasCost = gasPrice * BigInt(Math.ceil(estimatedGasPerTx * count));
    if (verbose) console.log("Current gasPrice (wei):", gasPrice.toString());
    if (verbose) console.log("Estimated total gas cost (wei):", estTotalGasCost.toString(), " (~", ethers.formatEther(estTotalGasCost), "ETH )");

    if (nativeBalanceWei < estTotalGasCost) {
      if (verbose) console.warn("Warning: native balance is less than estimated total gas cost — transactions may fail.");
    }

    const planned = [];
    let sumUnits = 0n;
    for (let i = 0; i < count; ++i) {
      const rndStr = randomDecimalString(min, max, 4);
      const units = ethers.parseUnits(rndStr, decimals);
      planned.push({ display: rndStr, units });
      sumUnits = sumUnits + units;
    }
    if (verbose) console.log("Total planned token amount (units):", sumUnits.toString(), " -> tokens:", ethers.formatUnits(sumUnits, decimals));
    
    if (sumUnits > tokenBalanceUnits) {
      throw new Error("Planned total exceeds token balance");
    }

    const txLog = [];
    for (let i = 0; i < planned.length; ++i) {
      const { display, units } = planned[i];
      if (units === 0n) {
        if (verbose) console.warn(`Skipping tx #${i + 1} because units == 0`);
        continue;
      }

      let attempt = 0;
      let success = false;
      while (attempt < retries && !success) {
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
          if (verbose) console.log(`Sent tx #${i + 1} amount=${display} tokens (units=${units.toString()}) nonce=${nonce} hash=${sent.hash}`);

          const receipt = await sent.wait(1).catch((err) => {
            if (verbose) console.warn(`Waiting for receipt for tx ${sent.hash} failed/timeout:`, err.message || err);
            return null;
          });

          if (receipt) {
            if (verbose) console.log(`Confirmed tx #${i + 1} in block ${receipt.blockNumber} status=${receipt.status}`);
          } else {
            if (verbose) console.warn(`No receipt yet for tx ${sent.hash}. Check this hash manually.`);
          }

          const txEntry = { 
            index: i + 1, 
            amount: display, 
            units: units.toString(), 
            nonce, 
            hash: sent.hash,
            blockNumber: receipt?.blockNumber,
            status: receipt?.status
          };
          
          txLog.push(txEntry);
          success = true;

          if (onProgress) onProgress({ completed: i + 1, total: count, transaction: txEntry });

          if (delay && delay > 0) await sleep(Math.round(delay * 1000));
        } catch (err) {
          if (attempt >= retries) {
            throw new Error(`Max retries reached for tx #${i + 1}: ${err.message}`);
          }
          const backoff = Math.min(5000 * attempt, 30000);
          if (verbose) console.log(`Retrying in ${backoff / 1000}s...`);
          await sleep(backoff);
        }
      }
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const logPath = `${logDir}/${timestamp}.txlog.json`;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.writeFileSync(logPath, JSON.stringify(txLog, null, 2));

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    const result = {
      success: true,
      transactions: txLog,
      logPath,
      duration,
      wallet: sender,
      balances: {
        token: tokenBalanceFormatted,
        native: ethers.formatEther(nativeBalanceWei)
      }
    };

    if (onComplete) onComplete(result);
    return result;

  } catch (err) {
    if (onError) onError(err);
    throw err;
  }
}
