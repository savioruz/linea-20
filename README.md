# linea-20

## Setup

Install dependencies:
```bash
bun install
```

Configure environment:
```bash
cp .env.example .env
```

Edit `.env`:
```env
PRIVATE_KEY=0x...
API_KEY=your_secret_api_key
HOST=0.0.0.0
PORT=3000
```

## CLI Usage

### Batch Token Transfers

Send multiple ERC20 token transfers:
```bash
bun run cmd:transaction -- \
  --rpc https://rpc.linea.build \
  --token 0xTOKEN_ADDRESS \
  --to 0xDESTINATION_WALLET \
  --count 20 \
  --min 0.01 \
  --max 0.5
```

**Options:**
- `--rpc` - RPC endpoint URL (required)
- `--token` - ERC20 token contract address (required)
- `--to` - Destination wallet address (required)
- `--count` - Number of transactions (default: 20)
- `--min` - Minimum amount per transfer (default: 0.01)
- `--max` - Maximum amount per transfer (default: 0.5)
- `--delay` - Seconds between transactions (default: 1.0)
- `--retries` - Max retry attempts per tx (default: 3)
- `--dry-run` - Preview without sending
- `--yes` - Skip confirmation prompt
- `--verbose` - Enable detailed logging

### dApp Interactions

**Sign a message:**
```bash
bun run cmd:interact -- \
  --action sign \
  --message "Hello World"
```

**Send raw transaction:**
```bash
bun run cmd:interact -- \
  --action send-raw \
  --rpc https://rpc.linea.build \
  --to 0xCONTRACT_ADDRESS \
  --data 0x4e71d92d \
  --value 0.1
```

**Get wallet info:**
```bash
bun run cmd:interact -- \
  --action wallet \
  --rpc https://rpc.linea.build
```

## API Server

Start the server:
```bash
bun run server
```

The server runs on `http://localhost:3000` by default (configurable via `HOST` and `PORT` env vars).

### API Endpoints

#### Health Check
```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": 1732896000000,
  "activeJobs": 2
}
```

---

#### Batch Token Transfers

**Start a batch job:**
```bash
POST /batch
Content-Type: application/json
x-api-key: YOUR_SECRET_KEY

{
  "rpc": "https://rpc.linea.build",
  "token": "0xTOKEN_ADDRESS",
  "to": "0xDESTINATION_WALLET",
  "count": 20,
  "min": "0.01",
  "max": "0.5",
  "delay": 1.0,
  "retries": 3,
  "logDir": "logs"
}
```

Response:
```json
{
  "jobId": "job_1732896000000_abc123",
  "status": "queued",
  "message": "Batch transaction started",
  "statusUrl": "/batch/job_1732896000000_abc123"
}
```

**Get job status:**
```bash
GET /batch/:jobId
x-api-key: YOUR_SECRET_KEY
```

Response:
```json
{
  "id": "job_1732896000000_abc123",
  "status": "running",
  "wallet": "0xYourAddress",
  "balances": {
    "eth": "1.5",
    "token": "1000.0"
  },
  "planned": {
    "count": 20,
    "totalAmount": "5.5"
  },
  "completed": 15,
  "transactions": [...],
  "createdAt": 1732896000000
}
```

**List all jobs:**
```bash
GET /batch
x-api-key: YOUR_SECRET_KEY
```

Response:
```json
{
  "jobs": [
    {
      "id": "job_1732896000000_abc123",
      "status": "completed",
      "wallet": "0xYourAddress",
      "completed": 20,
      "total": 20,
      "createdAt": 1732896000000,
      "duration": "45s"
    }
  ],
  "total": 1
}
```

**Delete a job:**
```bash
DELETE /batch/:jobId
x-api-key: YOUR_SECRET_KEY
```

---

#### dApp Interactions

**Sign a message:**
```bash
POST /interact/sign
Content-Type: application/json
x-api-key: YOUR_SECRET_KEY

{
  "message": "Hello World"
}
```

Response:
```json
{
  "address": "0xYourAddress",
  "message": "Hello World",
  "signature": "0x..."
}
```

**Sign typed data (EIP-712):**
```bash
POST /interact/sign-typed
Content-Type: application/json
x-api-key: YOUR_SECRET_KEY

{
  "domain": {
    "name": "MyDApp",
    "version": "1",
    "chainId": 59144
  },
  "types": {
    "Message": [
      { "name": "content", "type": "string" }
    ]
  },
  "value": {
    "content": "Hello"
  }
}
```

**Send raw transaction:**
```bash
POST /interact/send-raw
Content-Type: application/json
x-api-key: YOUR_SECRET_KEY

{
  "rpc": "https://rpc.linea.build",
  "to": "0xCONTRACT_ADDRESS",
  "data": "0x4e71d92d",
  "value": "0.1",
  "gasLimit": "100000",
  "chainId": 59144
}
```

Response:
```json
{
  "hash": "0x...",
  "from": "0xYourAddress",
  "to": "0xCONTRACT_ADDRESS",
  "blockNumber": 123456,
  "status": 1,
  "gasUsed": "85000"
}
```

**Batch send raw transactions:**
```bash
POST /interact/batch-send-raw
Content-Type: application/json
x-api-key: YOUR_SECRET_KEY

{
  "privateKey": "0xYOUR_PRIVATE_KEY",
  "rpc": "https://rpc.linea.build",
  "transactions": [
    {
      "to": "0xCONTRACT_ADDRESS",
      "data": "0x4e71d92d",
      "value": "0.1",
      "count": 5
    },
    {
      "to": "0xANOTHER_CONTRACT",
      "data": "0x...",
      "value": "0",
      "count": 3
    }
  ],
  "gasLimit": "300000",
  "gasPrice": "50",
  "delay": 2.0,
  "retries": 3
}
```

Parameters:
- `privateKey` - Your Private Key (required)
- `rpc` - RPC endpoint (required)
- `transactions` - Array of transaction objects (required)
  - Each transaction can have its own `count` parameter (default: 1)
  - `to` - Contract address (required)
  - `data` - Transaction data (required)
  - `value` - ETH amount to send (optional, default: "0")
  - `count` - Number of times to repeat this specific transaction (optional, default: 1)
  - `gasLimit` - Gas limit for this transaction (optional)
  - `gasPrice` - Gas price in gwei for this transaction (optional)
- `gasLimit` - Global gas limit fallback (optional)
- `gasPrice` - Global gas price fallback in gwei (optional)
- `delay` - Seconds between transactions (default: 1.0)
- `retries` - Max retry attempts per transaction (default: 3)

Response:
```json
{
  "jobId": "job_1732896000000_abc123",
  "status": "queued",
  "message": "Batch send-raw started",
  "total": 8,
  "statusUrl": "/batch/job_1732896000000_abc123"
}
```

Job status response:
```json
{
  "success": true,
  "total": 8,
  "uniqueTransactions": 2,
  "successful": 8,
  "failed": 0,
  "duration": "45s",
  "results": [
    {
      "index": 1,
      "txIndex": 1,
      "repeat": 1,
      "totalRepeats": 5,
      "hash": "0x...",
      "from": "0xYourAddress",
      "to": "0xCONTRACT_ADDRESS",
      "blockNumber": 123456,
      "status": 1,
      "gasUsed": "85000"
    }
  ],
  "failedTransactions": []
}
```

**Get wallet info:**
```bash
GET /interact/wallet?rpc=https://rpc.linea.build
x-api-key: YOUR_SECRET_KEY
```

Response:
```json
{
  "address": "0xYourAddress",
  "balance": "1.5",
  "nonce": 42,
  "chainId": 59144,
  "network": "linea"
}
```

**Generate new wallets:**
```bash
POST /interact/generate-wallets
Content-Type: application/json
x-api-key: YOUR_SECRET_KEY

{
  "count": 10
}
```

Parameters:
- `count` - Number of wallets to generate (default: 1, max: 100)

Response:
```json
{
  "count": 10,
  "wallets": [
    {
      "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      "privateKey": "0x..."
    },
    {
      "address": "0x123...",
      "privateKey": "0x..."
    }
  ]
}
```

**Send ETH:**

Single transaction:
```bash
POST /interact/send-eth
Content-Type: application/json
x-api-key: YOUR_SECRET_KEY

{
  "privateKey": "0x...",
  "rpc": "https://rpc.linea.build",
  "to": "0x...",
  "amount": "0.01"
}
```

Batch transactions:
```bash
POST /interact/send-eth
Content-Type: application/json
x-api-key: YOUR_SECRET_KEY

{
  "privateKey": "0x...",
  "rpc": "https://rpc.linea.build",
  "transactions": [
    {"to": "0xABC...", "amount": "0.1"},
    {"to": "0xDEF...", "amount": "0.2"},
    {"to": "0x123...", "amount": "0.05"}
  ],
  "delay": 0.5,
  "retries": 3
}
```

Parameters:
- `privateKey` - Your Private Key (required)
- `rpc` - RPC endpoint (required)
- `to` - Recipient address (required for single tx)
- `amount` - ETH amount to send (required for single tx)
- `transactions` - Array of {to, amount} objects (required for batch)
- `delay` - Seconds between transactions (optional, default: 0)
- `retries` - Max retry attempts per transaction (optional, default: 3)

Response:
```json
{
  "jobId": "job_1732896000000_abc123",
  "status": "queued",
  "message": "ETH transfer started",
  "total": 3,
  "statusUrl": "/batch/job_1732896000000_abc123"
}
```

Job status response (single tx):
```json
{
  "hash": "0x...",
  "from": "0xYourAddress",
  "to": "0x...",
  "amount": "0.01",
  "blockNumber": 123456,
  "status": 1,
  "gasUsed": "21000"
}
```

Job status response (batch):
```json
{
  "success": true,
  "total": 3,
  "successful": 3,
  "failed": 0,
  "results": [
    {
      "index": 1,
      "hash": "0x...",
      "from": "0xYourAddress",
      "to": "0xABC...",
      "amount": "0.1",
      "blockNumber": 123456,
      "status": 1,
      "gasUsed": "21000"
    }
  ],
  "failedTransactions": []
}
```

**Note:** The API uses intelligent nonce management to handle concurrent requests without conflicts. It automatically increases gas prices by 20% to prevent "replacement fee too low" errors.
