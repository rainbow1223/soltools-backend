import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";
import { sendTransactionWithV0 } from "../transaction";
import { sleep } from "../mint/utils";

export async function transferSol(
  httpsConnection: Connection,
  sourceWallet: Keypair,
  receivers: PublicKey[],
  solAmount: number[]
) {
  try {
    let ixs: TransactionInstruction[] = [];
    for (let i = 0; i < receivers.length; i++) {
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: sourceWallet.publicKey,
          toPubkey: receivers[i],
          lamports: solAmount[i]
        })
      );
    }
    /*Send Transaction*/
    const transferRes = await sendTransactionWithV0(
      httpsConnection,
      ixs,
      [],
      sourceWallet
    );
    console.log("transfer SOL res: ", transferRes);
    return transferRes;
  } catch {
    console.error("error sol transfer");
    return null;
  }
}

export async function refundSol(
  httpsConnection: Connection,
  childWallet: Keypair,
  targetWallet: PublicKey
) {
  try {
    const currentSolBal = await httpsConnection.getBalance(
      childWallet.publicKey
    );
    let ixs: TransactionInstruction[] = [
      SystemProgram.transfer({
        fromPubkey: childWallet.publicKey,
        toPubkey: targetWallet,
        lamports: currentSolBal - 5000
      })
    ];
    await sleep(0.05);
    const refundRes = await sendTransactionWithV0(
      httpsConnection,
      ixs,
      [],
      childWallet
    );
    console.log("success refund", refundRes);
    return refundRes;
  } catch {
    console.error("error sol refund");
    return null;
  }
}
