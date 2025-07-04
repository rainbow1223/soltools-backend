import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { ENV_SETTINGS } from "../../config";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  createCpmmPool,
  removeALLCpmmPool,
  getPoolStatusForOnlyRemoveLP
} from "./core";
import { readStringPrivateKey, sleep } from "../mint/utils";

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
let isLpExist = false;
let isClickManualRemove = false;
const connectionList = [httpsConnection1, httpsConnection2, httpsConnection3];
export async function limitOrderCpmm(
  devWallet: Keypair,
  initSolAmount: number,
  baseMint: PublicKey,
  profit: number,
  baseTokenAmo: number
) {
  let rpcIdx = 0;
  let currentValue: number = 0;
  const baseATA = getAssociatedTokenAddressSync(baseMint, devWallet.publicKey);
  let tokenAmount = BigInt(0);
  let tokenAmountFinal = BigInt(0);
  const baseTokenAmount = BigInt(baseTokenAmo);
  const diviser = BigInt(100);
  console.log("baseATA", baseATA);
  try {
    const stringAmount = (
      await httpsConnection1.getTokenAccountBalance(baseATA)
    ).value.amount;
    console.log("string Amount", stringAmount);
    tokenAmount = BigInt(stringAmount);
    tokenAmountFinal = (tokenAmount * baseTokenAmount) / diviser;
  } catch {
    console.error("there is no base token balance in your wallet");
    return null;
  }
  console.log("before create CPMM pool, tokenAmount = ", tokenAmountFinal);
  const createCpmmRes = await createCpmmPool(
    httpsConnection,
    devWallet,
    { mint: baseMint, tokenAmount: tokenAmountFinal },
    initSolAmount
  );
  console.log("successfully create CPMM pool", createCpmmRes);
  if (createCpmmRes) {
    isLpExist = true;
    while (isLpExist) {
      try {
        currentValue = await connectionList[rpcIdx].getBalance(
          createCpmmRes.quoteVault
        );
      } catch {
        console.log("helius error in limit order");
      }
      // console.log(`current SOL reserve in LP: ${currentValue}`);

      /*If it is over profit*/
      if (currentValue > profit + initSolAmount + 20 * Math.pow(10, 7)) {
        console.log("auto remove");
        isLpExist = false;
        const removeRes = await removeALLCpmmPool(
          connectionList[(rpcIdx + 1) % 3],
          devWallet,
          baseMint,
          createCpmmRes.pool,
          createCpmmRes.lpMint,
          createCpmmRes.quoteVault,
          createCpmmRes.baseVault
        );
        if (removeRes) {
          console.log("auto removed", removeRes);
        } else {
          isLpExist = true;
        }
      } else {
      if (isClickManualRemove) {
        if (!isLpExist) {
          console.error(
            "cpmm is not created yet or auto removing is pending"
          );
        } else {
          console.log("manual remove!");
          isLpExist = false;
          const removeRes = await removeALLCpmmPool(
            connectionList[(rpcIdx + 1) % 3],
            devWallet,
            baseMint,
            createCpmmRes.pool,
            createCpmmRes.lpMint,
            createCpmmRes.quoteVault,
            createCpmmRes.baseVault
          );
          isClickManualRemove = false;
          console.log("manual remove is completed");
        }
      }
      }
      rpcIdx = (rpcIdx + 1) % 3;
      await sleep(0.5);
    }
  } else {
    console.error("cpmm is not created");
  }
}

export function clickManualRemoveCpmm() {
  isClickManualRemove = true;
}

export async function RemoveLPOnly(
  devWallet: Keypair,
  baseMint: PublicKey,
  poolAddr: PublicKey
) {
  let rpcIdx = 0;
  let currentValue: number = 0;
  const getPoolStatusUsingBaseToken = await getPoolStatusForOnlyRemoveLP(
    baseMint,
    poolAddr
  );

  if (getPoolStatusUsingBaseToken) {
    isLpExist = true;
    while (isLpExist) {
      try {
        currentValue = await connectionList[rpcIdx].getBalance(
          getPoolStatusUsingBaseToken.quoteVault
        );
      } catch {
        console.log("helius error in limit order");
      }
      console.log(`current SOL reserve in LP: ${currentValue}`);

      console.log("start remove!");
      isLpExist = false;
      const removeRes = await removeALLCpmmPool(
        connectionList[(rpcIdx + 1) % 3],
        devWallet,
        baseMint,
        poolAddr,
        getPoolStatusUsingBaseToken.lpMint,
        getPoolStatusUsingBaseToken.quoteVault,
        getPoolStatusUsingBaseToken.baseVault
      );
      if (removeRes) {
        console.log("LP removed", removeRes);
      } else {
        isLpExist = true;
      }
      rpcIdx = (rpcIdx + 1) % 3;
      await sleep(0.5);
    }
  } else {
    console.error("cpmm is not created");
  }
}

export async function testLimitOrderCpmm(
  devWallet: Keypair,
  initSolAmount: number,
  baseMint: PublicKey,
  profit: number,
  baseTokenAmo: number
) {
  const baseATA = getAssociatedTokenAddressSync(baseMint, devWallet.publicKey);
  let tokenAmount = BigInt(0);
  let tokenAmountFinal = BigInt(0);
  const baseTokenAmount = BigInt(baseTokenAmo);
  const diviser = BigInt(100);
  console.log("baseATA", baseATA);
  try {
    const stringAmount = (
      await httpsConnection1.getTokenAccountBalance(baseATA)
    ).value.amount;

    console.log("string Amount", stringAmount);
    tokenAmount = BigInt(stringAmount);
    tokenAmountFinal = (tokenAmount * baseTokenAmount) / diviser;
  } catch {
    console.error("there is no base token balance in your wallet");
    return null;
  }
  console.log("before create CPMM pool, tokenAmount = ", tokenAmountFinal);
}

export async function testCpmmPart() {
  const devWallet = readStringPrivateKey("");
  const baseMint = new PublicKey(
    "9j8LFdVhRSjiqwKeQBnnrE5EtGdS1jjgRRNYMFTY8GQZ"
  );
  const solAmount = 2 * Math.pow(10, 8);
  const pool = new PublicKey("3rrCctMMr6JpViVTmSbq7SV2EoTPfpi9uEZ6GeqDU1UQ");
  const lpMint = new PublicKey("AZWxr6bX4XLgXLJckbeh81hzERyhKWpP6e5efT7opAMv");
  const quoteVault = new PublicKey(
    "8korAhHEsCwhdVFGHdAvmwiFFnMKdwJ3uKwGHjdLiMss"
  );
  const baseVault = new PublicKey(
    "77fThgKesjF4X1Sft2fKYWsX3nkeHaygBp3j1xZru96o"
  );
  // await createCpmmPool(
  //   httpsConnection1,
  //   devWallet,
  //   { mint: baseMint, tokenAmount: BigInt(Math.pow(10, 15)) },
  //   solAmount
  // );
  await removeALLCpmmPool(
    httpsConnection1,
    devWallet,
    baseMint,
    pool,
    lpMint,
    quoteVault,
    baseVault
  );
}
