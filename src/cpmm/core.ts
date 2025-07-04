import {
  PublicKey,
  Keypair,
  Connection,
  ComputeBudgetProgram,
  TransactionInstruction,
  SystemProgram
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

import {
  checkQuoteStatusForLpCreation,
  removeBaseAndUnwrapSol
} from "../liquidity/checkQuote";
import { ENV_SETTINGS, SOL_ADDRESS } from "../../config";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import {
  AccountMeta,
  AccountMetaReadonly,
  RENT_PROGRAM_ID,
  SYSTEM_PROGRAM_ID
} from "@raydium-io/raydium-sdk";
import { sendTransactionWithV0 } from "../transaction";
import { sleep } from "../mint/utils";

const wsolPK = new PublicKey(SOL_ADDRESS);
const ammConfig = new PublicKey("D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2");
const poolDestinationFee = new PublicKey(
  "DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"
);
const raydiumVaultAuthV2 = new PublicKey(
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL"
);
const raydiumCPMM = new PublicKey(
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
);
const MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

const raydiumCpmmConnection = new Connection(
  "https://raydium-raydium-5ad5.mainnet.rpcpool.com",
  "confirmed"
);
function getCreateCpmmData(
  solAmount: number,
  tokenAmount: bigint,
  poolOpenTime: number
) {
  const data: Buffer = Buffer.alloc(32);
  //afaf6d1f0d989bed
  data.set([0xaf, 0xaf, 0x6d, 0x1f, 0x0d, 0x98, 0x9b, 0xed]);
  data.writeBigInt64LE(BigInt(solAmount), 8);
  data.writeBigInt64LE(tokenAmount, 16);
  data.writeBigInt64LE(BigInt(poolOpenTime), 24);
  return data;
}

function getWithdrawCpmmData(lpAmount: bigint) {
  const data: Buffer = Buffer.alloc(32);
  //b712469c946da122
  data.set([0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22]);
  data.writeBigInt64LE(lpAmount, 8);
  data.writeBigInt64LE(BigInt(0), 16);
  data.writeBigInt64LE(BigInt(0), 24);
  return data;
}
export async function createCpmmPool(
  httpsConnection: Connection,
  devWallet: Keypair,
  baseInfo: { mint: PublicKey; tokenAmount: bigint },
  solAmount: number
) {
  const checkWrapSol = await checkQuoteStatusForLpCreation(
    httpsConnection,
    devWallet,
    solAmount
  );
  console.log(
    "Current or Changed WSOl amount during Create CPMM pool, ",
    checkWrapSol
  );
  await sleep(2.5);
  const solATA = getAssociatedTokenAddressSync(wsolPK, devWallet.publicKey);
  const baseMintATA = getAssociatedTokenAddressSync(
    baseInfo.mint,
    devWallet.publicKey
  );
  if (checkWrapSol) {
    const [pool] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        ammConfig.toBuffer(),
        wsolPK.toBuffer(),
        baseInfo.mint.toBuffer()
      ],
      raydiumCPMM
    );
    const [lpToken] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_lp_mint"), pool.toBuffer()],
      raydiumCPMM
    );
    const [baseVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), pool.toBuffer(), baseInfo.mint.toBuffer()],
      raydiumCPMM
    );
    const [quoteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), pool.toBuffer(), wsolPK.toBuffer()],
      raydiumCPMM
    );
    const [observationState] = PublicKey.findProgramAddressSync(
      [Buffer.from("observation"), pool.toBuffer()],
      raydiumCPMM
    );
    // console.log(lpToken);
    console.log("Step 1 completed");
    let cpmmPoolInstruction: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: ENV_SETTINGS.COMPUTE_PRICE
      }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
    ];
    console.log("Step 2 completed");
    const lpMintATA = getAssociatedTokenAddressSync(
      lpToken,
      devWallet.publicKey
    );
    let keys = [];
    keys.push(
      AccountMeta(devWallet.publicKey, true),
      AccountMetaReadonly(ammConfig, false),
      AccountMetaReadonly(raydiumVaultAuthV2, false),
      AccountMeta(pool, false),
      AccountMetaReadonly(wsolPK, false),
      AccountMetaReadonly(baseInfo.mint, false),
      AccountMeta(lpToken, false),
      AccountMeta(solATA, false),
      AccountMeta(baseMintATA, false),
      AccountMeta(lpMintATA, false),
      AccountMeta(quoteVault, false),
      AccountMeta(baseVault, false),
      AccountMeta(poolDestinationFee, false),
      AccountMeta(observationState, false),
      AccountMetaReadonly(TOKEN_PROGRAM_ID, false),
      AccountMetaReadonly(TOKEN_PROGRAM_ID, false),
      AccountMetaReadonly(TOKEN_PROGRAM_ID, false),
      AccountMetaReadonly(ASSOCIATED_TOKEN_PROGRAM_ID, false),
      AccountMetaReadonly(SYSTEM_PROGRAM_ID, false),
      AccountMetaReadonly(RENT_PROGRAM_ID, false)
    );
    console.log("Step 3 completed");
    const poolOpeningTime = Math.floor(Date.now() / 1000) + 10;
    const initializeCpmmInst = new TransactionInstruction({
      programId: raydiumCPMM,
      keys,
      data: getCreateCpmmData(solAmount, baseInfo.tokenAmount, poolOpeningTime)
    });

    cpmmPoolInstruction.push(initializeCpmmInst);
    await sleep(1);
    const createCpmmTx = await sendTransactionWithV0(
      httpsConnection,
      cpmmPoolInstruction,
      [],
      devWallet
    );
    console.log("Step 4 completed");
    if (createCpmmTx) {
      console.log("Create CPMM tx successfully.", createCpmmTx);
      return {
        pool: pool,
        lpMint: lpToken,
        quoteVault: quoteVault,
        baseVault: baseVault
      };
    } else {
      console.error("cpmm creation error");
      return null;
    }
  } else {
    console.error("not enough SOL");
    return null;
  }
}

export async function removeALLCpmmPool(
  httpsConnection: Connection,
  devWallet: Keypair,
  baseMint: PublicKey,
  pool: PublicKey,
  lpMint: PublicKey,
  quoteVault: PublicKey,
  baseVault: PublicKey
) {
  const solATA = getAssociatedTokenAddressSync(wsolPK, devWallet.publicKey);
  const baseMintATA = getAssociatedTokenAddressSync(
    baseMint,
    devWallet.publicKey
  );
  const lpMintATA = getAssociatedTokenAddressSync(lpMint, devWallet.publicKey);

  // Check if LP token account exists
  const lpAccount = await httpsConnection.getAccountInfo(lpMintATA);
  if (!lpAccount) {
    console.log("LP token account doesn't exist, skipping close instruction");
    return null;
  }

  let lpAmount: bigint = BigInt(0);
  try {
    const stringAmount = (
      await httpsConnection.getTokenAccountBalance(lpMintATA)
    ).value.amount;
    lpAmount = BigInt(stringAmount);
    console.log("lp balance is ", lpAmount);
  } catch {
    console.error("no lp token in your wallet");
    return null;
  }
  let keys = [];
  keys.push(
    AccountMeta(devWallet.publicKey, true),
    AccountMetaReadonly(raydiumVaultAuthV2, false),
    AccountMeta(pool, false),
    AccountMeta(lpMintATA, false),
    AccountMeta(solATA, false),
    AccountMeta(baseMintATA, false),
    AccountMeta(quoteVault, false),
    AccountMeta(baseVault, false),
    AccountMetaReadonly(TOKEN_PROGRAM_ID, false),
    AccountMetaReadonly(TOKEN_2022_PROGRAM_ID, false),
    AccountMetaReadonly(wsolPK, false),
    AccountMetaReadonly(baseMint, false),
    AccountMeta(lpMint, false),
    AccountMetaReadonly(MEMO_PROGRAM, false)
  );
  const withdrawInst = new TransactionInstruction({
    programId: raydiumCPMM,
    keys,
    data: getWithdrawCpmmData(lpAmount)
  });
  const removeLpInstruction: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: ENV_SETTINGS.COMPUTE_PRICE * 2
    }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
    createAssociatedTokenAccountIdempotentInstruction(
      devWallet.publicKey,
      solATA,
      devWallet.publicKey,
      wsolPK
    ),
    withdrawInst,
  ];

  try {
    const finalBalance = await httpsConnection.getTokenAccountBalance(lpMintATA);
    if(BigInt(finalBalance.value.amount) === BigInt(0)) {
      removeLpInstruction.push(
        createCloseAccountInstruction(
          lpMintATA,
          devWallet.publicKey,
          devWallet.publicKey,
          []
        )
      )
    }
  } catch (error) {
    console.log("SKip closing account - might already be closed");
  }

  const removeTx = await sendTransactionWithV0(
    httpsConnection,
    removeLpInstruction,
    [],
    devWallet
  );

  if (removeTx) {
    console.log(`remove successfully  ${removeTx}`);
    const burnBaseRes = await removeBaseAndUnwrapSol(
      httpsConnection,
      devWallet,
      baseMint
    );
    return burnBaseRes;
  } else {
    console.error("remove failed");
    return null;
  }
}

export async function getPoolStatusForOnlyRemoveLP(
  baseMint: PublicKey,
  poolAddr: PublicKey
) {
  // const [pool] = PublicKey.findProgramAddressSync(
  //   [
  //     Buffer.from("pool"),
  //     ammConfig.toBuffer(),
  //     wsolPK.toBuffer(),
  //     baseMint.toBuffer()
  //   ],
  //   raydiumCPMM
  // );
  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_lp_mint"), poolAddr.toBuffer()],
    raydiumCPMM
  );
  const [baseVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_vault"), poolAddr.toBuffer(), baseMint.toBuffer()],
    raydiumCPMM
  );
  const [quoteVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_vault"), poolAddr.toBuffer(), wsolPK.toBuffer()],
    raydiumCPMM
  );

  console.log(
    `Pool: ${poolAddr}, lpMint: ${lpMint}, baseVault: ${baseVault}, quoteVault: ${quoteVault}, baseMint: ${baseMint}`
  );

  return {
    lpMint: lpMint,
    quoteVault: quoteVault,
    baseVault: baseVault
  };
}

async function transferLpToken(
  httpsConnection: Connection,
  devWallet: Keypair,
  receiver: PublicKey,
  lpMint: PublicKey
) {
  const lpATA = getAssociatedTokenAddressSync(lpMint, devWallet.publicKey);
  const targetATA = getAssociatedTokenAddressSync(lpMint, receiver);
  try {
    const lpBal = BigInt(
      (await httpsConnection.getTokenAccountBalance(lpATA)).value.amount
    );
    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000000 }),
      createAssociatedTokenAccountIdempotentInstruction(
        devWallet.publicKey,
        targetATA,
        receiver,
        lpMint
      ),
      createTransferCheckedInstruction(
        lpATA,
        lpMint,
        targetATA,
        devWallet.publicKey,
        lpBal,
        9,
        []
      )
    ];
    await sleep(0.5);
    const res = await sendTransactionWithV0(
      httpsConnection,
      ixs,
      [],
      devWallet
    );
    console.log(res);
  } catch {
    return null;
  }
}

export async function testCpmmCreation() { }
