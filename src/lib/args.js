import minimist from "minimist";

export function parseTransactionArgs() {
  const args = minimist(process.argv.slice(2), {
    string: ["rpc", "token", "to", "min", "max", "log"],
    boolean: ["dry-run", "yes", "verbose"],
    default: { count: 20, min: "0.01", max: "0.5", delay: 1.0, retries: 3, log: "logs", verbose: false },
    alias: { h: "help" },
  });

  if (args.help) {
    const helpText = `
 Usage example:
 export PRIVATE_KEY="0x..."
 node index.js --rpc https://rpc.linea.build \
--token 0x67454b41bAF8D29751Cc64f60E3C62B5634567A4 \
--to 0xDESTINATION_WALLET \
--count 20 --min 0.01 --max 0.5
 
  Flags:
   --dry-run    : do not broadcast transactions
   --yes        : skip confirmation prompt
   --delay      : seconds between txs (default 1.0)
   --retries    : max retries per tx (default 3)
   --log        : path prefix for log files (default logs)
   --verbose    : enable verbose logging
    `;
    console.log(helpText);
    process.exit(0);
  }

  if (!args.rpc || !args.token || !args.to) {
    console.error("Missing required flags: --rpc, --token, --to");
    process.exit(1);
  }

  args.count = parseInt(args.count, 10);
  args.delay = parseFloat(args.delay);
  args.retries = parseInt(args.retries, 10);

  args.min = args.min.toString();
  args.max = args.max.toString();

  return args;
}

export function parseInteractArgs() {
  const args = minimist(process.argv.slice(2), {
    string: ["action", "rpc", "to", "data", "message", "value", "gasLimit", "chainId"],
    alias: { h: "help", a: "action" }
  });
  
  if (args.help) {
    console.log(`
  Actions:
    sign          - Sign a message
    send-raw      - Send raw transaction with data
    wallet        - Get wallet info
  
  Examples:
    # Sign a message
    bun dapp --action sign --message "Hello World"
  
    # Send raw transaction (like the POH sign)
    bun dapp --action send-raw \\
      --rpc https://rpc.linea.build \\
      --to 0x7aD0B9D518041A8d42589Eb5BFbCC6B8630b13E8 \\
      --data 0x4e71d92d \\
      --chainId 59144
  
    # Get wallet info
    bun dapp --action wallet --rpc https://rpc.linea.build
  
  Options:
    --action      Action to perform (sign, send-raw, wallet)
    --message     Message to sign
    --rpc         RPC URL
    --to          Contract address
    --data        Transaction data (hex)
    --value       ETH value to send (optional)
    --gasLimit    Gas limit (optional)
    --chainId     Chain ID (optional)
  `);
    process.exit(0);
  }
  return args;
}