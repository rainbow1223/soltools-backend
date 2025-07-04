// Import necessary libraries
import {
  TransactionInstruction,
  ComputeBudgetProgram,
  PublicKey,
  Keypair,
  Connection,
  SystemProgram,
  Signer,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import { AccountMeta, AccountMetaReadonly } from "@raydium-io/raydium-sdk";
import bs58 from "bs58";
import axios from "axios";

// Use Jito's public endpoint for transaction submission and a general Solana endpoint for other RPC calls
const jitoConnection = new Connection(
  "https://mainnet.block-engine.jito.wtf/api/v1/transactions",
  "confirmed"
);
const solanaConnection = new Connection(
  "https://mainnet.helius-rpc.com/?api-key=2b64615a-f035-44b3-8209-9b989607f791",
  "confirmed"
);

const connectionOne = new Connection(
  "https://solana.chain-swap.org",
  "confirmed"
);

const connectionTwo = new Connection(
  "https://mainnet.helius-rpc.com/?api-key=87987e8f-9919-470a-b09d-1cfc2010e95d",
  "confirmed"
);

const connectionThree = new Connection(
  "https://mainnet.helius-rpc.com/?api-key=bb4857f2-5204-4878-91f8-2986872dfa66",
  "confirmed"
);

const connectionList: Connection[] = [
  connectionOne,
  connectionTwo,
  connectionThree,
  solanaConnection,
];

// Helper function to read private key from a base58 encoded string
export function readStringPrivateKey(key: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(key));
}

// Function to send a transaction with Jito's optimized endpoint
async function sendTransactionWithV0MarketMaker(
  connection: Connection,
  ixs: TransactionInstruction[],
  ixsSigners: Signer[],
  feePayer: Keypair,
  idx: number
): Promise<string> {
  const blockHash = await connectionList[idx].getLatestBlockhash(); // Use Solana endpoint here
  const newMsg = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: blockHash.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const versionedMsg = new VersionedTransaction(newMsg);
  versionedMsg.sign([feePayer, ...ixsSigners]);
  const res = await connectionList[idx].sendRawTransaction(
    versionedMsg.serialize(),
    {
      skipPreflight: false,
    }
  );
  console.log("Transaction sent:", res);

  await connectionList[idx].confirmTransaction({
    signature: res,
    lastValidBlockHeight: blockHash.lastValidBlockHeight,
    blockhash: blockHash.blockhash,
  });

  return res;
}

// Constants for keys and configuration
const wsolPK = new PublicKey("So11111111111111111111111111111111111111112");
const ammConfig = new PublicKey("D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2");
const raydiumVaultAuthV2 = new PublicKey(
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL"
);
const raydiumCPMM = new PublicKey(
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
);

// Function to generate swap instruction data
function getSwapCpmmData(amountIn: bigint, minimumAmountOut: bigint): Buffer {
  const data = Buffer.alloc(24);
  data.set([0x8f, 0xbe, 0x5a, 0xda, 0xc4, 0x1e, 0x33, 0xde]);
  data.writeBigInt64LE(amountIn, 8);
  data.writeBigInt64LE(minimumAmountOut, 16);
  return data;
}

// Configuration for signer wallets
const numberOfwalletsOneTime = 1;
const signerKeyPair: Keypair[] = [];

// Function to distribute SOL to signer wallets
export async function SendSOLToSignersWallet(
  fundWallet: Keypair
): Promise<string> {
  console.log("Distributing SOL to signer wallets...");
  const tipAccount = new PublicKey(
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49"
  );

  let toSignerTransfer: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }),
  ];

  // Generate signer wallets and print keys
  for (let i = 0; i < numberOfwalletsOneTime; i++) {
    signerKeyPair[i] = Keypair.generate();
    console.log("Signer Public Key:", signerKeyPair[i].publicKey.toBase58());
  }

  // Transfer SOL to each signer wallet
  for (let i = 0; i < numberOfwalletsOneTime; i++) {
    toSignerTransfer.push(
      SystemProgram.transfer({
        fromPubkey: fundWallet.publicKey,
        toPubkey: signerKeyPair[i].publicKey,
        lamports: Math.pow(10, 6),
      })
    );
  }

  // toSignerTransfer.push(
  //   SystemProgram.transfer({
  //     fromPubkey: fundWallet.publicKey,
  //     toPubkey: tipAccount,
  //     lamports: 100000,
  //   })
  // );

  const sendSolTrx = await sendTransactionWithV0MarketMaker(
    jitoConnection,
    toSignerTransfer,
    [],
    fundWallet,
    0
  );

  console.log("Completed SOL distribution:", sendSolTrx);
  return sendSolTrx;
}

// Market-making function with Raydium liquidity pool
export async function MarketMaker(
  fundWallet: Keypair,
  baseMint: PublicKey,
  amountIn: bigint
): Promise<void> {
  console.log("Running market-making operation...");

  // const solATA = getAssociatedTokenAddressSync(wsolPK, fundWallet.publicKey);
  // const baseMintATA = getAssociatedTokenAddressSync(
  //   baseMint,
  //   fundWallet.publicKey
  // );

  // const [pool] = PublicKey.findProgramAddressSync(
  //   [
  //     Buffer.from("pool"),
  //     ammConfig.toBuffer(),
  //     wsolPK.toBuffer(),
  //     baseMint.toBuffer(),
  //   ],
  //   raydiumCPMM
  // );

  // const [outputVault] = PublicKey.findProgramAddressSync(
  //   [Buffer.from("pool_vault"), pool.toBuffer(), baseMint.toBuffer()],
  //   raydiumCPMM
  // );
  // const [inputVault] = PublicKey.findProgramAddressSync(
  //   [Buffer.from("pool_vault"), pool.toBuffer(), wsolPK.toBuffer()],
  //   raydiumCPMM
  // );
  // const [observationState] = PublicKey.findProgramAddressSync(
  //   [Buffer.from("observation"), pool.toBuffer()],
  //   raydiumCPMM
  // );

  for (let i = 0; i < numberOfwalletsOneTime; i++) {
    let swapTokenInstruction: TransactionInstruction[] = [];
    // swapTokenInstruction.push(
    //   ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 300000 }),
    //   ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }),
    //   createAssociatedTokenAccountIdempotentInstruction(
    //     fundWallet.publicKey,
    //     solATA,
    //     fundWallet.publicKey,
    //     wsolPK
    //   ),
    //   SystemProgram.transfer({
    //     fromPubkey: fundWallet.publicKey,
    //     toPubkey: solATA,
    //     lamports: amountIn,
    //   }),
    //   createSyncNativeInstruction(solATA)
    // );

    // let keys: any = [];

    // keys.push(
    //   AccountMeta(fundWallet.publicKey, true),
    //   AccountMetaReadonly(raydiumVaultAuthV2, false),
    //   AccountMetaReadonly(ammConfig, false),
    //   AccountMeta(pool, false),
    //   AccountMeta(solATA, false),
    //   AccountMeta(baseMintATA, false),
    //   AccountMeta(inputVault, false),
    //   AccountMeta(outputVault, false),
    //   AccountMetaReadonly(TOKEN_PROGRAM_ID, false),
    //   AccountMetaReadonly(TOKEN_PROGRAM_ID, false),
    //   AccountMetaReadonly(wsolPK, false),
    //   AccountMetaReadonly(baseMint, false),
    //   AccountMeta(observationState, false)
    // );

    // const swapBaseInputInstruction = new TransactionInstruction({
    //   programId: raydiumCPMM,
    //   keys,
    //   data: getSwapCpmmData(amountIn, BigInt(0)),
    // });

    try {
      const quoteResponse = await axios.get(
        "https://quote-api.jup.ag/v6/quote",
        {
          params: {
            inputMint: wsolPK,
            outputMint: baseMint,
            amount: 100000,
            slippage: 50,
          },
        }
      );
      console.log({ quoteResponse: quoteResponse.data });

      const swapResponse = await axios.post(
        "https://quote-api.jup.ag/v6/swap",
        {
          quoteResponse: quoteResponse.data,
          userPublicKey: fundWallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: 10000,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const { swapTransaction } = swapResponse.data;

      const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
      var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      console.log(transaction);

      transaction.sign([signerKeyPair[i], fundWallet]);

      const bhInfo = await connectionTwo.getLatestBlockhashAndContext(
        "finalized"
      );
      transaction.message.recentBlockhash = bhInfo.value.blockhash;

      const simulation = await connectionTwo.simulateTransaction(transaction, {
        commitment: "processed",
      });
      if (simulation.value.err) {
        throw new Error("Simulate failed: " + simulation.value.err);
      }
      const signature = await connectionTwo.sendTransaction(transaction, {
        skipPreflight: true,
        preflightCommitment: "processed",
      });
      const confirmation = await connectionTwo.confirmTransaction(
        signature,
        "finalized" // This is the commitment level
      );
      if (confirmation.value.err) {
        throw new Error("Transaction failed: " + confirmation.value.err);
      }
      console.log(`https://solscan.io/tx/${signature}`);
    } catch (err) {}

    // swapTokenInstruction.push(
    //   swapBaseInputInstruction,
    //   createCloseAccountInstruction(
    //     solATA,
    //     fundWallet.publicKey,
    //     fundWallet.publicKey,
    //     []
    //   ),
    //   SystemProgram.transfer({
    //     fromPubkey: signerKeyPair[i].publicKey,
    //     toPubkey: fundWallet.publicKey,
    //     lamports: Math.pow(10, 6) - 40000,
    //   })
    // );

    // sendTransactionWithV0MarketMaker(
    //   jitoConnection,
    //   swapTokenInstruction,
    //   [fundWallet],
    //   signerKeyPair[i],
    //   1
    // );

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));
}

// Function to collect remaining SOL from signers' wallets
export async function sendRemainSOLToFundWallet(
  fundWallet: Keypair
): Promise<string | null> {
  console.log("Returning remaining SOL to fund wallet...");

  const remainSOLAmo: number[] = [];

  for (let i = 0; i < numberOfwalletsOneTime; i++) {
    remainSOLAmo[i] = await solanaConnection.getBalance(
      signerKeyPair[i].publicKey
    ); // Use Solana endpoint here
  }

  let toFundsTransfer: TransactionInstruction[] = [];

  for (let i = 0; i < numberOfwalletsOneTime; i++) {
    if (remainSOLAmo[i] !== 0) {
      toFundsTransfer.push(
        SystemProgram.transfer({
          fromPubkey: signerKeyPair[i].publicKey,
          toPubkey: fundWallet.publicKey,
          lamports: remainSOLAmo[i],
        })
      );
    }
  }

  if (toFundsTransfer.length !== 0) {
    const sendSolToFundTrx = await sendTransactionWithV0MarketMaker(
      jitoConnection,
      toFundsTransfer,
      signerKeyPair,
      fundWallet,
      2
    );

    console.log("Returned remaining SOL:", sendSolToFundTrx);
    return sendSolToFundTrx;
  }
  return null;
}

// Test function to execute the market-making process
export async function testSwap(): Promise<void> {
  console.log("Starting test swap...");

  const devWallet = readStringPrivateKey(
    "2CpeZjq1Ed87wmyXrYRpRHpka2FJWqELasm4noMTr7Hy7PfXuS1dAEkRgnBFrr2BhKAcch18ELoR8XrvG8Ekjhvp"
  );
  const baseMint = new PublicKey(
    "9SHMcBF7ezoVEaQeZJS2QALb4W6iz94LFMQfD1frgiFR"
  );
  const amountIn = BigInt("10000");
  while (true) {
    try {
      await SendSOLToSignersWallet(devWallet);
      await MarketMaker(devWallet, baseMint, amountIn);
    } catch (err) {
      console.error("Error in test swap:", err);
      await sendRemainSOLToFundWallet(devWallet);
    }

    console.log("Test swap completed.");
  }
}
