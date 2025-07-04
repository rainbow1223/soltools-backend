import { Connection, PublicKey } from "@solana/web3.js";
import { sleep } from "../mint/utils";

const USDC_ADDRESS = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
const SOL_VAULT = new PublicKey("DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz");
const USDC_VAULT = new PublicKey(
  "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz"
);
async function getSOLPriceByUSDC() {
  const jupiterUrl = "https://price.jup.ag/v4/price?ids=SOL";
  const response = await fetch(jupiterUrl, { method: "GET" });
  const data = await response.json();
  // console.log(data);
  if (data) {
    globalThis.solPriceByUSDC = data["data"]["SOL"]["price"];
  }
}

export async function updateSOLPrice() {
  while (true) {
    await getSOLPriceByUSDC();
    await sleep(0.4);
  }
}
