import { ethers } from "ethers";

// Nonce management to prevent concurrent transaction conflicts
const nonceTracker = new Map(); // Map of address -> { nonce, promise }

async function getNextNonce(provider, address) {
  const key = address.toLowerCase();
  
  if (!nonceTracker.has(key)) {
    const nonce = await provider.getTransactionCount(address, "pending");
    nonceTracker.set(key, { nonce, promise: Promise.resolve() });
    return nonce;
  }

  const tracker = nonceTracker.get(key);
  
  // Wait for any pending nonce allocation
  await tracker.promise;
  
  // Allocate the next nonce
  const currentNonce = tracker.nonce;
  tracker.nonce++;
  
  return currentNonce;
}

function releaseNonce(address) {
  // Clean up after some time to prevent memory leaks
  const key = address.toLowerCase();
  setTimeout(() => {
    nonceTracker.delete(key);
  }, 60000); // Clear after 1 minute
}

export async function signMessage(config) {
  const { privateKey, message } = config;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required");
  }

  const wallet = new ethers.Wallet(privateKey);
  const signature = await wallet.signMessage(message);

  return {
    address: wallet.address,
    message,
    signature
  };
}

export async function signTypedData(config) {
  const { privateKey, domain, types, value } = config;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required");
  }

  const wallet = new ethers.Wallet(privateKey);
  const signature = await wallet.signTypedData(domain, types, value);

  return {
    address: wallet.address,
    signature
  };
}

export async function callContract(config) {
  const { rpc, contract, abi, method, params = [] } = config;

  const provider = new ethers.JsonRpcProvider(rpc);
  const contractInstance = new ethers.Contract(contract, abi, provider);

  const result = await contractInstance[method](...params);
  return result;
}

export async function sendTransaction(config) {
  const {
    privateKey,
    rpc,
    contract,
    abi,
    method,
    params = [],
    value = "0",
    gasLimit,
    gasPrice
  } = config;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required");
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contractInstance = new ethers.Contract(contract, abi, wallet);

  const txOptions = {};
  if (value && value !== "0") {
    txOptions.value = ethers.parseEther(value);
  }
  if (gasLimit) {
    txOptions.gasLimit = BigInt(gasLimit);
  }
  if (gasPrice) {
    txOptions.gasPrice = ethers.parseUnits(gasPrice, "gwei");
  }

  const tx = await contractInstance[method](...params, txOptions);
  const receipt = await tx.wait();

  return {
    hash: tx.hash,
    from: wallet.address,
    to: contract,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed: receipt.gasUsed.toString()
  };
}

export async function sendRawTransaction(config) {
  const {
    privateKey,
    rpc,
    to,
    data,
    value = "0",
    gasLimit,
    chainId
  } = config;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required");
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);

  const feeData = await provider.getFeeData();
  
  const txRequest = {
    to,
    data,
    value: value !== "0" ? ethers.parseEther(value) : 0n,
    gasLimit: gasLimit ? BigInt(gasLimit) : undefined,
    gasPrice: feeData.gasPrice,
    chainId: chainId || (await provider.getNetwork()).chainId
  };

  if (!gasLimit) {
    try {
      const estimated = await provider.estimateGas(txRequest);
      txRequest.gasLimit = estimated;
    } catch (e) {
      txRequest.gasLimit = 200000n;
    }
  }

  const tx = await wallet.sendTransaction(txRequest);
  const receipt = await tx.wait();

  return {
    hash: tx.hash,
    from: wallet.address,
    to,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed: receipt.gasUsed.toString()
  };
}

export async function getWalletInfo(config) {
  const { privateKey, rpc } = config;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required");
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  const address = wallet.address;
  const balance = await provider.getBalance(address);
  const nonce = await provider.getTransactionCount(address);
  const network = await provider.getNetwork();

  return {
    address,
    balance: ethers.formatEther(balance),
    balanceWei: balance.toString(),
    nonce,
    chainId: Number(network.chainId),
    network: network.name
  };
}

export async function sendEth(config, callbacks = {}) {
  const {
    privateKey,
    rpc,
    to,
    amount,
    transactions, // Optional: array of {to, amount} for batch
    delay = 0,
    retries = 3
  } = config;

  const { onProgress } = callbacks;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required");
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);

  if (transactions && Array.isArray(transactions)) {
    const results = [];
    const failed = [];
    const total = transactions.length;

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      let attempt = 0;
      let success = false;

      while (attempt < retries && !success) {
        attempt++;
        try {
          const nonce = await getNextNonce(provider, wallet.address);
          const feeData = await provider.getFeeData();
          const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 120n) / 100n : undefined;

          const sentTx = await wallet.sendTransaction({
            to: tx.to,
            value: ethers.parseEther(tx.amount),
            nonce,
            gasPrice
          });

          const receipt = await sentTx.wait();

          const result = {
            index: i + 1,
            hash: sentTx.hash,
            from: wallet.address,
            to: tx.to,
            amount: tx.amount,
            blockNumber: receipt.blockNumber,
            status: receipt.status,
            gasUsed: receipt.gasUsed.toString()
          };

          results.push(result);
          success = true;

          if (onProgress) onProgress({ completed: i + 1, total, transaction: result });

          if (delay > 0 && i < transactions.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
          }

        } catch (err) {
          if (attempt >= retries) {
            failed.push({
              index: i + 1,
              to: tx.to,
              amount: tx.amount,
              error: err.message
            });
            break;
          }

          const backoff = Math.min(2000 * attempt, 10000);
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }

    releaseNonce(wallet.address);

    return {
      success: failed.length === 0,
      total,
      successful: results.length,
      failed: failed.length,
      results,
      failedTransactions: failed
    };
  }

  // Handle single transaction
  let attempt = 0;
  while (attempt < retries) {
    attempt++;
    try {
      const nonce = await getNextNonce(provider, wallet.address);
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 120n) / 100n : undefined;

      const tx = await wallet.sendTransaction({
        to,
        value: ethers.parseEther(amount),
        nonce,
        gasPrice
      });

      const receipt = await tx.wait();

      releaseNonce(wallet.address);

      return {
        hash: tx.hash,
        from: wallet.address,
        to,
        amount,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString()
      };

    } catch (err) {
      if (attempt >= retries) {
        releaseNonce(wallet.address);
        throw err;
      }

      const backoff = Math.min(2000 * attempt, 10000);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
}

export async function batchSendRawTransactions(config, callbacks = {}) {
  const {
    privateKey,
    rpc,
    transactions,
    delay = 1.0,
    retries = 3,
    gasLimit,
    gasPrice,
    verbose = false
  } = config;

  const { onProgress, onComplete, onError } = callbacks;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required");
  }

  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    throw new Error("transactions array is required");
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const startTime = Date.now();

  const results = [];
  const failed = [];

  // Calculate total based on each transaction's count
  const totalTransactions = transactions.reduce((sum, tx) => sum + (tx.count || 1), 0);
  let txNumber = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const count = tx.count || 1;

    for (let c = 0; c < count; c++) {
      txNumber++;
      let attempt = 0;
      let success = false;

      while (attempt < retries && !success) {
        attempt++;
        try {
          if (verbose) console.log(`\nSending tx #${txNumber}/${totalTransactions} (tx ${i + 1}/${transactions.length}, repeat ${c + 1}/${count})`);
          if (verbose) console.log("To:", tx.to);
          if (verbose) console.log("Data:", tx.data);

        const feeData = await provider.getFeeData();
        
        let finalGasPrice;
        if (tx.gasPrice) {
          finalGasPrice = ethers.parseUnits(tx.gasPrice, "gwei");
        } else if (gasPrice) {
          finalGasPrice = ethers.parseUnits(gasPrice, "gwei");
        } else {
          finalGasPrice = feeData.gasPrice;
        }

        const txRequest = {
          to: tx.to,
          data: tx.data,
          value: tx.value && tx.value !== "0" ? ethers.parseEther(tx.value) : 0n,
          gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : (gasLimit ? BigInt(gasLimit) : undefined),
          gasPrice: finalGasPrice,
          chainId: tx.chainId || (await provider.getNetwork()).chainId
        };

        if (!tx.gasLimit) {
          try {
            const estimated = await provider.estimateGas(txRequest);
            txRequest.gasLimit = estimated;
          } catch (e) {
            txRequest.gasLimit = 200000n;
          }
        }

        const sent = await wallet.sendTransaction(txRequest);
        if (verbose) console.log("Hash:", sent.hash);

        const receipt = await sent.wait();
        
          const result = {
            index: txNumber,
            txIndex: i + 1,
            repeat: c + 1,
            totalRepeats: count,
            hash: sent.hash,
            from: wallet.address,
            to: tx.to,
            data: tx.data,
            blockNumber: receipt.blockNumber,
            status: receipt.status,
            gasUsed: receipt.gasUsed.toString()
          };

          results.push(result);
          success = true;

          if (verbose) console.log("Status:", receipt.status === 1 ? "Success" : "Failed");
          if (onProgress) onProgress({ completed: txNumber, total: totalTransactions, transaction: result });

          if (delay && delay > 0 && txNumber < totalTransactions) {
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
          }

        } catch (err) {
          if (verbose) console.error(`Attempt ${attempt} failed:`, err.message);
          
          if (attempt >= retries) {
            const failedTx = {
              index: txNumber,
              txIndex: i + 1,
              repeat: c + 1,
              to: tx.to,
              data: tx.data,
              error: err.message
            };
            failed.push(failedTx);
            if (verbose) console.error(`Max retries reached for tx #${txNumber}`);
            break;
          }

          const backoff = Math.min(5000 * attempt, 30000);
          if (verbose) console.log(`Retrying in ${backoff / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  const summary = {
    success: failed.length === 0,
    total: totalTransactions,
    uniqueTransactions: transactions.length,
    successful: results.length,
    failed: failed.length,
    duration,
    results,
    failedTransactions: failed
  };

  if (onComplete) onComplete(summary);
  if (failed.length > 0 && onError) {
    onError(new Error(`${failed.length} transactions failed`));
  }

  return summary;
}
