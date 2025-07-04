import { Keypair } from "@solana/web3.js";
import base58 from "bs58";

function generateWallets(numberOfwallets: number) {
  console.log("generate wallets");
  const newWallets = [];
  for (let i = 0; i < numberOfwallets; i++) {
    const wallet = Keypair.generate();
    newWallets.push(base58.encode(Buffer.from(wallet.secretKey)));
  }

  return newWallets;
}

export function spliteGeneratedWallets(numberOfwallets: number) {
  const midIndex = Math.ceil(generateWallets(numberOfwallets).length / 2);
  console.log("batch wallets");
  return {
    firstBatchs: generateWallets(numberOfwallets).slice(0, midIndex),
    secondBatchs: generateWallets(numberOfwallets).slice(midIndex)
  };
}
