import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";
import { ENV_SETTINGS, SOL_ADDRESS } from "../../config";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { readStringPrivateKey, sleep } from "../mint/utils";
import { sendTransactionWithV0 } from "../transaction";
const wsolPK = new PublicKey(SOL_ADDRESS);

const testConnection = new Connection(ENV_SETTINGS.HTTPS_RPC_URL1);
async function wrapSol(
  connection: Connection,
  devWallet: Keypair,
  wrapAmount: number
) {
  const solATA = getAssociatedTokenAddressSync(wsolPK, devWallet.publicKey);
  // if (wrapAmount + 4 * Math.pow(10, 6) > currentSolAmount) {
  //   console.error("not enough balance in your wallet to wrap SOL");
  //   return null;
  // }
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: ENV_SETTINGS.COMPUTE_PRICE * 2
    })
  ];
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      devWallet.publicKey,
      solATA,
      devWallet.publicKey,
      wsolPK
    ),
    SystemProgram.transfer({
      fromPubkey: devWallet.publicKey,
      toPubkey: solATA,
      lamports: wrapAmount
    }),
    createSyncNativeInstruction(solATA)
  );
  const blockHash = await connection.getLatestBlockhash();
  const newWrapMsg = new TransactionMessage({
    payerKey: devWallet.publicKey,
    recentBlockhash: blockHash.blockhash,
    instructions: ixs
  }).compileToV0Message();
  const versionedMsg = new VersionedTransaction(newWrapMsg);
  versionedMsg.sign([devWallet]);
  const wrapRes = await connection.sendRawTransaction(
    versionedMsg.serialize(),
    { skipPreflight: false }
  );
  const confirmation = await testConnection.confirmTransaction({
    signature: wrapRes,
    lastValidBlockHeight: blockHash.lastValidBlockHeight,
    blockhash: blockHash.blockhash
  });
  console.log(wrapRes);
  return wrapRes;
}

export async function removeBaseAndUnwrapSol(
  connection: Connection,
  devWallet: Keypair,
  baseMint: PublicKey
) {
  const solATA = getAssociatedTokenAddressSync(wsolPK, devWallet.publicKey);
  const baseATA = getAssociatedTokenAddressSync(baseMint, devWallet.publicKey);
  let currentBaseAmount: bigint = BigInt(0);
  let currentWsolBal: number = 0;
  /*Check Status*/
  let isBaseRemoved = false;
  let isUnwraped = false;
  let ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: ENV_SETTINGS.COMPUTE_PRICE
    })
  ];
  /*Base Token*/
  try {
    currentBaseAmount = BigInt(
      (await connection.getTokenAccountBalance(baseATA)).value.amount
    );
    /*Burn*/
    if (currentBaseAmount > BigInt(0)) {
      ixs.push(
        createBurnCheckedInstruction(
          baseATA,
          baseMint,
          devWallet.publicKey,
          currentBaseAmount,
          6
        )
      );
    }
    ixs.push(
      createCloseAccountInstruction(
        baseATA,
        devWallet.publicKey,
        devWallet.publicKey,
        []
      )
    );
  } catch {
    isBaseRemoved = true;
  }
  await sleep(0.1);
  /*UnwrapSOL*/
  try {
    ixs.push(
      createCloseAccountInstruction(
        solATA,
        devWallet.publicKey,
        devWallet.publicKey,
        []
      )
    );
  } catch {
    isUnwraped = true;
  }
  if (isBaseRemoved && isUnwraped) {
    console.log("already removed");
    return null;
  }
  /*Make Transaction*/
  await sleep(0.1);
  const removeRes = await sendTransactionWithV0(connection, ixs, [], devWallet);
  return removeRes;
}

export async function checkQuoteStatusForLpCreation(
  connection: Connection,
  devWallet: Keypair,
  lpSolAmount: number
) {
  const currentSolAmount = await connection.getBalance(devWallet.publicKey);
  console.log("current sol", currentSolAmount);
  
  const solATA = getAssociatedTokenAddressSync(wsolPK, devWallet.publicKey);
  let currentWsolBal: number = 0;
  try {
    currentWsolBal = Number(
      (await connection.getTokenAccountBalance(solATA)).value.amount
    );
  } catch {
    currentWsolBal = 0;
  }
  console.log("current wsol", currentWsolBal, lpSolAmount);
  const requiredSolAmount = lpSolAmount + 2 * Math.pow(10, 8) - currentWsolBal;
  if (requiredSolAmount > currentSolAmount) {
    const errorAmount = (
      (requiredSolAmount - currentSolAmount) /
      Math.pow(10, 9)
    ).toString();
    console.error(
      `not enough SOL balance to create LP, need ${errorAmount}SOL more!`
    );
    return null;
  } else {
    if (currentWsolBal < lpSolAmount) {
      const res = await wrapSol(
        connection,
        devWallet,
        lpSolAmount - currentWsolBal
      );
      return res;
    } else {
      return "enough wsol";
    }
  }
}

export async function testBurnToken() {
  const devWallet = readStringPrivateKey("");
  const baseMint = new PublicKey(
    "27sGxN2T1H3utLVKTD8QG3EQC2pGmh3m4EGS29sg6YZe"
  );
  await removeBaseAndUnwrapSol(testConnection, devWallet, baseMint);
}
