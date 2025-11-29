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
      "value": "0.1"
    },
    {
      "to": "0xANOTHER_CONTRACT",
      "data": "0x...",
      "value": "0"
    }
  ],
  "count": 5,
  "delay": 2.0,
  "retries": 3
}
```

Parameters:
- `privateKey` - Your Private Key (required)
- `rpc` - RPC (required)
- `transactions` - Array of transaction objects (required)
- `count` - Number of times to repeat each transaction (default: 1)
- `delay` - Seconds between transactions (default: 1.0)
- `retries` - Max retry attempts per transaction (default: 3)

Response:
```json
{
  "success": true,
  "total": 10,
  "count": 5,
  "uniqueTransactions": 2,
  "successful": 10,
  "failed": 0,
  "duration": "45s",
  "results": [
    {
      "index": 1,
      "round": 1,
      "txIndex": 1,
      "hash": "0x...",
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
