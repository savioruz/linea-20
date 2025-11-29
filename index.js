#!/usr/bin/env node
import express from "express";
import { executeBatchTransactions } from "./src/lib/transaction.js";
import { config } from "./src/config/config.js";
import { 
  signMessage, 
  signTypedData, 
  callContract, 
  sendTransaction, 
  sendRawTransaction,
  batchSendRawTransactions,
  getWalletInfo 
} from "./src/lib/interact.js";

const app = express();
app.use(express.json());

const jobs = new Map();

const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const validApiKey = config.apiKey;

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

    const result = await executeBatchTransactions(
      {
        privateKey: config.privateKey,
        ...config
      },
      {
        onStart: ({ wallet }) => {
          job.wallet = wallet;
        },
        onProgress: ({ completed, total, transaction }) => {
          job.completed = completed;
          job.transactions = job.transactions || [];
          job.transactions.push(transaction);
        }
      }
    );

    job.status = "completed";
    job.duration = result.duration;
    job.logPath = result.logPath;
    job.balances = result.balances;
    job.transactions = result.transactions;
    job.endTime = Date.now();

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

// POST /interact/sign - Sign a message
app.post("/interact/sign", apiKeyAuth, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Missing required field: message" });
    }

    const result = await signMessage({
      privateKey: config.privateKey,
      message
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /interact/sign-typed - Sign typed data (EIP-712)
app.post("/interact/sign-typed", apiKeyAuth, async (req, res) => {
  try {
    const { domain, types, value } = req.body;

    if (!domain || !types || !value) {
      return res.status(400).json({ error: "Missing required fields: domain, types, value" });
    }

    const result = await signTypedData({
      privateKey: config.privateKey,
      domain,
      types,
      value
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /interact/call - Call contract (read-only)
app.post("/interact/call", apiKeyAuth, async (req, res) => {
  try {
    const { rpc, contract, abi, method, params = [] } = req.body;

    if (!rpc || !contract || !abi || !method) {
      return res.status(400).json({ error: "Missing required fields: rpc, contract, abi, method" });
    }

    const result = await callContract({
      rpc,
      contract,
      abi,
      method,
      params
    });

    res.json({ result: result.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /interact/send - Send transaction to contract
app.post("/interact/send", apiKeyAuth, async (req, res) => {
  try {
    const { rpc, contract, abi, method, params = [], value, gasLimit, gasPrice } = req.body;

    if (!rpc || !contract || !abi || !method) {
      return res.status(400).json({ error: "Missing required fields: rpc, contract, abi, method" });
    }

    const result = await sendTransaction({
      privateKey: config.privateKey,
      rpc,
      contract,
      abi,
      method,
      params,
      value,
      gasLimit,
      gasPrice
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /interact/send-raw - Send raw transaction
app.post("/interact/send-raw", apiKeyAuth, async (req, res) => {
  try {
    const { rpc, to, data, value, gasLimit, chainId } = req.body;

    if (!rpc || !to || !data) {
      return res.status(400).json({ error: "Missing required fields: rpc, to, data" });
    }

    const result = await sendRawTransaction({
      privateKey: config.privateKey,
      rpc,
      to,
      data,
      value,
      gasLimit,
      chainId
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /interact/batch-send-raw - Send multiple raw transactions
app.post("/interact/batch-send-raw", apiKeyAuth, async (req, res) => {
  try {
    const { privateKey, rpc, transactions, count = 1, delay = 1.0, retries = 3 } = req.body;

    if (!privateKey || !rpc || !transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: "Missing required fields: privateKey, rpc, transactions (array)" });
    }

    const result = await batchSendRawTransactions({
      privateKey: privateKey,
      rpc,
      transactions,
      count,
      delay,
      retries,
      verbose: false
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /interact/wallet - Get wallet info
app.get("/interact/wallet", apiKeyAuth, async (req, res) => {
  try {
    const { rpc } = req.query;

    if (!rpc) {
      return res.status(400).json({ error: "Missing required query param: rpc" });
    }

    const result = await getWalletInfo({
      privateKey: config.privateKey,
      rpc
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: Date.now(),
    activeJobs: jobs.size
  });
});

const HOST = config.host;
const PORT = config.port;

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/health`);
  console.log(`Start batch: POST http://${HOST}:${PORT}/batch`);
  console.log(`Check status: GET http://${HOST}:${PORT}/batch/:jobId`);
});
