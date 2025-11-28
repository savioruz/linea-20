#!/usr/bin/env node
import express from "express";
import { ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import { sleep, randomDecimalString } from "../src/lib/common.js";
import { ERC20_ABI, CHAIN_ID_LINEA } from "../src/constant/constant.js";

dotenv.config();

const app = express();
app.use(express.json());

const jobs = new Map();

const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    return res.status(500).json({ error: "API_KEY not configured on server" });
  }

  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
  }

  next();
};

async function executeBatch(jobId, config) {
  const job = jobs.get(jobId);
  
  try {
    job.status = "running";
    job.startTime = Date.now();

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("PRIVATE_KEY not set in environment");
    }

    const provider = new ethers.JsonRpcProvider(config.rpc);
    await provider.getBlockNumber();

    const wallet = new ethers.Wallet(privateKey, provider);
    const sender = await wallet.getAddress();
    job.wallet = sender;

    const tokenAddress = ethers.getAddress(config.token);
    const toAddress = ethers.getAddress(config.to);
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    const decimals = Number(await contract.decimals());
    const tokenBalanceUnits = await contract.balanceOf(sender);
    const nativeBalanceWei = await provider.getBalance(sender);

    job.balances = {
      token: ethers.formatUnits(tokenBalanceUnits, decimals),
      native: ethers.formatEther(nativeBalanceWei)
    };

    let estimatedGasPerTx = 120000;
    try {
      const sampleAmountUnits = tokenBalanceUnits > 0n ? ethers.parseUnits("0.01", decimals) : ethers.parseUnits("0.0001", decimals);
      const gasEstimate = await contract.transfer.estimateGas(toAddress, sampleAmountUnits);
      estimatedGasPerTx = Number(gasEstimate);
    } catch (e) {
      job.warnings = job.warnings || [];
      job.warnings.push(`Could not estimate gas: ${e.message}`);
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");

    const planned = [];
    let sumUnits = 0n;
    for (let i = 0; i < config.count; ++i) {
      const rndStr = randomDecimalString(config.min, config.max, 4);
      const units = ethers.parseUnits(rndStr, decimals);
      planned.push({ display: rndStr, units });
      sumUnits = sumUnits + units;
    }

    if (sumUnits > tokenBalanceUnits) {
      throw new Error("Planned total exceeds token balance");
    }

    job.planned = {
      total: ethers.formatUnits(sumUnits, decimals),
      count: config.count
    };

    const txLog = [];
    for (let i = 0; i < planned.length; ++i) {
      const { display, units } = planned[i];
      if (units === 0n) continue;

      let attempt = 0;
      let success = false;
      while (attempt < config.retries && !success) {
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

          const receipt = await sent.wait(1).catch(() => null);

          txLog.push({ 
            index: i + 1, 
            amount: display, 
            units: units.toString(), 
            nonce, 
            hash: sent.hash,
            blockNumber: receipt?.blockNumber,
            status: receipt?.status
          });
          success = true;

          if (config.delay && config.delay > 0) await sleep(Math.round(config.delay * 1000));
        } catch (err) {
          if (attempt >= config.retries) {
            throw new Error(`Max retries reached for tx #${i + 1}: ${err.message}`);
          }
          const backoff = Math.min(5000 * attempt, 30000);
          await sleep(backoff);
        }
      }

      job.completed = i + 1;
      job.transactions = txLog;
    }

    const logDir = config.logDir || "logs";
    const timestamp = Math.floor(Date.now() / 1000);
    const logPath = `${logDir}/${timestamp}.txlog.json`;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.writeFileSync(logPath, JSON.stringify(txLog, null, 2));

    const endTime = Date.now();
    const duration = ((endTime - job.startTime) / 1000).toFixed(2);

    job.status = "completed";
    job.duration = duration;
    job.logPath = logPath;
    job.transactions = txLog;
    job.endTime = endTime;

  } catch (err) {
    job.status = "failed";
    job.error = err.message;
    job.endTime = Date.now();
  }
}

// POST /batch - Start a new batch transaction
app.post("/batch", apiKeyAuth, async (req, res) => {
  try {
    const { rpc, token, to, count = 20, min = "0.01", max = "0.5", delay = 1.0, retries = 3, logDir = "logs" } = req.body;

    if (!rpc || !token || !to) {
      return res.status(400).json({ error: "Missing required fields: rpc, token, to" });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    jobs.set(jobId, {
      id: jobId,
      status: "queued",
      config: { rpc, token, to, count, min, max, delay, retries, logDir },
      createdAt: Date.now(),
      completed: 0,
      transactions: []
    });

    // Execute in background
    executeBatch(jobId, { rpc, token, to, count, min, max, delay, retries, logDir });

    res.json({ 
      jobId, 
      status: "queued",
      message: "Batch transaction started",
      statusUrl: `/batch/${jobId}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /batch/:jobId - Get job status
app.get("/batch/:jobId", apiKeyAuth, (req, res) => {
  const job = jobs.get(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const response = {
    id: job.id,
    status: job.status,
    wallet: job.wallet,
    balances: job.balances,
    planned: job.planned,
    completed: job.completed,
    transactions: job.transactions,
    createdAt: job.createdAt,
    warnings: job.warnings
  };

  if (job.status === "completed") {
    response.duration = job.duration;
    response.logPath = job.logPath;
    response.endTime = job.endTime;
  }

  if (job.status === "failed") {
    response.error = job.error;
    response.endTime = job.endTime;
  }

  res.json(response);
});

// GET /batch - List all jobs
app.get("/batch", apiKeyAuth, (req, res) => {
  const allJobs = Array.from(jobs.values()).map(job => ({
    id: job.id,
    status: job.status,
    wallet: job.wallet,
    completed: job.completed,
    total: job.planned?.count || 0,
    createdAt: job.createdAt,
    duration: job.duration
  }));

  res.json({ jobs: allJobs, total: allJobs.length });
});

// DELETE /batch/:jobId - Delete a job from memory
app.delete("/batch/:jobId", apiKeyAuth, (req, res) => {
  const deleted = jobs.delete(req.params.jobId);
  
  if (!deleted) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({ message: "Job deleted" });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: Date.now(),
    activeJobs: jobs.size
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Start batch: POST http://localhost:${PORT}/batch`);
  console.log(`Check status: GET http://localhost:${PORT}/batch/:jobId`);
});
