import { PublicKey } from "@solana/web3.js";
import {
  Connection,
  Keypair,
  Transaction,
  SystemProgram
} from "@solana/web3.js";
import base58 from "bs58";

import { ENV_SETTINGS } from "../../config";
import { transferSol } from "./solTransfer";

const httpsConnection = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL2,
  "confirmed"
);
const httpsConnection1 = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL,
  "confirmed"
);
const httpsConnection2 = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL1,
  "confirmed"
);
const httpsConnection3 = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL3,
  "confirmed"
);

const connectionList = [
  httpsConnection1,
  httpsConnection2,
  httpsConnection3,
  httpsConnection
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function hasEnoughFunds(
  senderWallet: Keypair,
  threshold: number = 0.001 * Math.pow(10, 9)
) {
  let rpcIdx = 0;
  const balance = await connectionList[(rpcIdx + 1) % 4].getBalance(
    senderWallet.publicKey
  );
  console.log("Sufficient amount of that wallet.", balance);
  return balance > threshold;
}

function generateRandomAllocations(
  totalAmount: number,
  numRecipients: number,
  feePerTransaction: number
) {
  let remainingAmount = totalAmount;
  const allocations = [];

  for (let i = 0; i < numRecipients; i++) {
    if (i == numRecipients - 1) {
      allocations.push(remainingAmount);
      console.log("allocations :", allocations);
    } else {
      const randomAmount =
        Math.floor(Math.random() * (remainingAmount / 4)) +
        2 * feePerTransaction;
      allocations.push(randomAmount);
      console.log("allocation else part : ", allocations);
      remainingAmount -= randomAmount;
    }
  }

  return allocations;
}

async function sendTransactionWithRetry(
  transaction: Transaction,
  signers: Keypair[],
  maxRetries: number = 6
) {
  let attempt = 0;
  let delayTime = 6000;
  let rpcIdx = 0;

  while (attempt < maxRetries) {
    try {
      const txId = await connectionList[(rpcIdx + 1) % 4].sendTransaction(
        transaction,
        signers,
        {
          skipPreflight: false,
          preflightCommitment: "confirmed"
        }
      );
      await delay(10000);
      return txId;
    } catch (error) {
      if (error) {
        console.log(
          `Server responded with 429 Too Many Requests. Retrying after ${delayTime}ms delay...`
        );
        await delay(delayTime);
        delayTime *= 1.2;
        attempt++;
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries exceeded for transaction.");
}

async function distributeFunds(senderWallet: Keypair, batchWallets: string) {
  let rpcIdx = 0;
  const senderBalance = await connectionList[(rpcIdx + 1) % 4].getBalance(
    senderWallet.publicKey
  );
  console.log("sender Balance: ", senderBalance);
  const feePerTrx = 5000;
  const rentExemptBalance = await connectionList[
    (rpcIdx + 1) % 4
  ].getMinimumBalanceForRentExemption(0);
  const totalDistributable =
    senderBalance - feePerTrx * batchWallets.length - rentExemptBalance;

  console.log("batchwallet length:", batchWallets.length);
  console.log("totalDistributable :", totalDistributable);

  if (totalDistributable <= 0) {
    console.log("Insufficient funds in sender wallet for distribution.");
    return;
  }

  //Generate random allocations that sum up to the distributable amount
  const allocations = generateRandomAllocations(
    totalDistributable,
    batchWallets.length,
    feePerTrx
  );
  console.log("Allocations in distributable part : ", allocations);
  // let receiverWalletList: PublicKey[] = [];
  for (let i = 0; i < batchWallets.length; i++) {
    const intermediateWallet = Keypair.fromSecretKey(
      base58.decode(batchWallets[i])
    );
    // receiverWalletList.push(intermediateWallet.publicKey);

    const amountToSend = allocations[i];

    if (amountToSend <= feePerTrx) {
      console.log(
        `Insufficient funds to send to ${intermediateWallet.publicKey.toBase58()} after accounting for fees.`
      );
      continue;
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderWallet.publicKey,
        toPubkey: intermediateWallet.publicKey,
        lamports: amountToSend
      })
    );

    try {
      // const txId = await transferSol(
      //   connectionForWashFund,
      //   senderWallet,
      //   receiverWalletList,
      //   allocations
      // );
      const txId = await sendTransactionWithRetry(transaction, [senderWallet]);
      console.log(
        `Sent ${
          (amountToSend - feePerTrx) / Math.pow(10, 9)
        } SOL to Batch 1 wallet ${intermediateWallet.publicKey.toBase58()}. Transaction ID: ${txId}`
      );
      await delay(5000);
    } catch (error) {
      console.error(
        `Error sending to Batch 1 wallet ${intermediateWallet.publicKey.toBase58()}: `,
        error
      );
      continue;
    }
  }
}

async function transferBetweenBatches(batchFrom: string, batchTo: string) {
  console.log("transfer Between batchs part");
  const minRequiredBalance = 0.002 * Math.pow(10, 9);
  const feePerTrx = 5000;
  let rpcIdx = 0;

  for (let i = 0; i < batchFrom.length && i < batchTo.length; i++) {
    const senderWallet = Keypair.fromSecretKey(base58.decode(batchFrom[i]));
    const receiveWallet = Keypair.fromSecretKey(base58.decode(batchTo[i]));
    let balance = await connectionList[(rpcIdx + 1) % 4].getBalance(
      senderWallet.publicKey
    );
    console.log("Balances that transfer between batches part", balance);
    await delay(5000);

    if (balance > minRequiredBalance + feePerTrx * 2) {
      console.log(
        `Batch 1 wallet ${senderWallet.publicKey.toBase58()} has ${
          balance / Math.pow(10, 9)
        } SOL`
      );

      //First transfer: Send 60% of th eavailable balance
      let availableBalance = balance - minRequiredBalance - feePerTrx * 2;
      let amountToSend = Math.floor(availableBalance * 0.6);

      console.log("amount TO send in first 60% amount", amountToSend);

      if (amountToSend <= 0) {
        console.log(
          `Insufficient funds to send 60% from ${senderWallet.publicKey.toBase58()}.`
        );
        continue;
      }

      let transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: senderWallet.publicKey,
          toPubkey: receiveWallet.publicKey,
          lamports: amountToSend
        })
      );

      try {
        const txId = await sendTransactionWithRetry(transaction, [
          senderWallet
        ]);
        console.log(
          `Transferred ${
            amountToSend / Math.pow(10, 9)
          } SOL (60%) from Batch 1 to Batch 2 wallet. Transaction ID : ${txId}`
        );
        await delay(5000);
      } catch (error) {
        console.error(
          `Error transfering 60% from Batch 1 to Batch 2 wallet: `,
          error
        );
        continue;
      }

      //Second transfer: Send the remaining balance.
      balance = await connectionList[(rpcIdx + 1) % 4].getBalance(
        senderWallet.publicKey
      );
      console.log("second part in transfer between batches part, ", balance);
      await delay(5000);

      let remainingAmountToSend = balance - minRequiredBalance - feePerTrx;
      if (remainingAmountToSend <= 0) {
        console.log(
          `No remaining funds to send from ${senderWallet.publicKey.toBase58()}.`
        );
        continue;
      }

      transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: senderWallet.publicKey,
          toPubkey: receiveWallet.publicKey,
          lamports: remainingAmountToSend
        })
      );

      try {
        const txId = await sendTransactionWithRetry(transaction, [
          senderWallet
        ]);
        console.log(
          `Transferred remaining ${
            remainingAmountToSend / 10 ** 9
          } SOL from Batch 1 to Batch 2 wallet. Transaction ID: ${txId}`
        );
        await delay(5000); // 5-second delay
      } catch (error) {
        console.error(
          `Error transferring remaining balance from Batch 1 to Batch 2 wallet:`,
          error
        );
      }
    } else {
      console.log(
        `Batch 1 wallet ${senderWallet.publicKey.toBase58()} has insufficient funds.`
      );
    }
  }
}

async function finalizingTransfersToFinalWallet(
  targetWallet: PublicKey,
  secondBatchs: string
) {
  console.log("finalizeing transfer to finish wallet part");
  const minRequiredBalance = 0.002 * Math.pow(10, 9);
  const feePerTrx = 5000;
  let rpcIdx = 0;

  for (let i = 0; i < secondBatchs.length; i++) {
    const batch2Wallet = Keypair.fromSecretKey(base58.decode(secondBatchs[i]));
    let balance = await connectionList[(rpcIdx + 1) % 4].getBalance(
      batch2Wallet.publicKey
    );
    console.log("finalizing transfer to finalizing wallet balance", balance);
    await delay(5000);

    if (balance > minRequiredBalance + feePerTrx * 2) {
      console.log(
        `Batch 2 wallet ${batch2Wallet.publicKey.toBase58()} has ${
          balance / 10 ** 9
        } SOL.`
      );

      let availableBalance = balance - minRequiredBalance - feePerTrx * 2;
      let amountToSend = Math.floor(availableBalance * 0.4);

      if (amountToSend <= 0) {
        console.log(
          `Insufficient funds to send 40% from ${batch2Wallet.publicKey.toBase58()}`
        );
        continue;
      }

      let transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: batch2Wallet.publicKey,
          toPubkey: targetWallet,
          lamports: amountToSend
        })
      );

      try {
        const txId = await sendTransactionWithRetry(transaction, [
          batch2Wallet
        ]);
        console.log(
          `Transferred ${
            amountToSend / 10 ** 9
          } SOL (40%) from Batch 2 to final wallet. Transaction ID: ${txId}`
        );
        await delay(5000);
      } catch (error) {
        console.error(
          `Error transferring 40% from Batch 2 to target wallet:`,
          error
        );
        continue;
      }

      balance = await connectionList[(rpcIdx + 1) % 4].getBalance(
        batch2Wallet.publicKey
      );
      await delay(5000);

      let remainingAmountToSend = balance - minRequiredBalance - feePerTrx;
      if (remainingAmountToSend <= 0) {
        console.log(
          `No remaining funds to send from ${batch2Wallet.publicKey.toBase58()}`
        );
        continue;
      }

      transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: batch2Wallet.publicKey,
          toPubkey: targetWallet,
          lamports: remainingAmountToSend
        })
      );

      try {
        const txId = await sendTransactionWithRetry(transaction, [
          batch2Wallet
        ]);
        console.log(
          `Transferred remaining ${
            remainingAmountToSend / 10 ** 9
          } SOL from Batch 2 to final wallet. Transaction ID: ${txId}`
        );
        await delay(5000);
      } catch (error) {
        console.error(
          `Error transferring remaining balance from Batch 2 to target wallet:`,
          error
        );
      }
    } else {
      console.log(
        `Batch 2 wallet ${batch2Wallet.publicKey.toBase58()} has insufficient funds.`
      );
    }
  }
}

export async function WashFund(
  firstBatchs: string,
  secondBatchs: string,
  senderWallet: Keypair,
  targetWallet: PublicKey
) {
  console.log("Start the wash funds", firstBatchs);
  if (await hasEnoughFunds(senderWallet)) {
    await distributeFunds(senderWallet, firstBatchs);
    await transferBetweenBatches(firstBatchs, secondBatchs);
    console.log("Transferring from Batch 2 to final wallet....");
    await finalizingTransfersToFinalWallet(targetWallet, secondBatchs);
  } else {
    console.log(
      "Sender wallet is empty or new empty. Transferring from Batch 1 to Batch 2..."
    );
  }
  console.log("Wash fund successfully completed!!!");
}
