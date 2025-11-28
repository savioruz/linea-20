export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomDecimalString(minStr, maxStr, decimalsToRound = 4) {
  const min = Number(minStr);
  const max = Number(maxStr);
  const r = Math.random() * (max - min) + min;
  return r.toFixed(decimalsToRound);
}

export async function confirmPrompt(summaryText, verbose = false) {
  if (process.env.CI || process.argv.includes("--yes")) return true;

  if (verbose) console.log(summaryText);

  process.stdout.write("Type y to proceed (or anything else to abort): ");

  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => {
      resolve(String(data || "").trim() === "y");
    });
  });
}