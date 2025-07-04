import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ENDPOINT as _ENDPOINT,
  Liquidity,
  LIQUIDITY_STATE_LAYOUT_V4,
  LiquidityPoolKeys,
  MAINNET_PROGRAM_ID,
  MARKET_STATE_LAYOUT_V3,
  MarketV2,
  Market as RayMarket,
  TokenAmount,
  SPL_MINT_LAYOUT,
  Token,
  TOKEN_PROGRAM_ID,
  TxVersion,
  BigNumberish,
} from "@raydium-io/raydium-sdk";

import { DexInstructions, Market } from "@openbook-dex/openbook";
import { ENV_SETTINGS, SOL_ADDRESS, TIP_ACCOUNTS } from "../../config";
import {
  getWalletTokenAccount,
  readStringPrivateKey,
  sleep,
} from "../mint/utils";
import BN from "bn.js";
import {
  ACCOUNT_SIZE,
  createCloseAccountInstruction,
  createInitializeAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  EVENT_QUEUE_LENGTH,
  getVaultOwnerAndNonce,
  ORDERBOOK_LENGTH,
  REQUEST_QUEUE_LENGTH,
} from "./orderbookUtils";
import useSerumMarketAccountSizes from "./getMarketAccountSizes";
import {
  checkQuoteStatusForLpCreation,
  removeBaseAndUnwrapSol,
} from "./checkQuote";
import { sendTxWithBundle } from "../transaction";
const httpsConnectionForLP = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL3,
  "confirmed"
);
const httpsConnection1 = new Connection(
  ENV_SETTINGS.HTTPS_RPC_MAKER_BOT,
  "confirmed"
);
const wsolPK = new PublicKey(SOL_ADDRESS);

/*LP Creation*/
export async function createLP(
  baseMint: PublicKey,
  solAmount: number,
  devWallet: Keypair,
  buyerWallet: Keypair,
  buyAmount: number
) {
  console.log('createLp part is running!');
  console.log('base mint:', baseMint.toString());
  const quoteCheck = await checkQuoteStatusForLpCreation(
    httpsConnectionForLP,
    devWallet,
    solAmount
  );
  await sleep(0.5);
  if (!quoteCheck) {
    console.log("not enough SOL amount in your wallet");
    return null;
  }
  const devATAOfSOL = getAssociatedTokenAddressSync(
    wsolPK,
    devWallet.publicKey
  );

  const devATA = getAssociatedTokenAddressSync(baseMint, devWallet.publicKey);
  const tokenAmount = (await httpsConnection1.getTokenAccountBalance(devATA))
    .value.amount;
  let baseAmount = new BN(tokenAmount);
  console.log(baseAmount);
  // Create MarketId
  let marketId;
  if (baseMint.toString() === "9of6SKeCfAa7U2fMYv9A7Y6y9EkrVP9sEN2fKiA6yDHn") {
    marketId = new PublicKey("JCFK5chs6v1kQHACuiCPqySUw3WE8vMqroU9LMUchSES");
  } else {
    marketId = await createMarket(devWallet, baseMint);
  }
  console.log('marketId result:', marketId);

  await sleep(1);

  const feeDestinationId = new PublicKey(
    "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5"
  );
  const tokenAccountsOfDevwallet = await getWalletTokenAccount(
    httpsConnection1,
    devATA,
    devATAOfSOL
  );
  const currentTime = Date.now() / 1000;
  const poolStartTime = Math.floor(0 + currentTime);
  if (marketId) {
    // console.log(MAINNET_PROGRAM_ID.OPENBOOK_MARKET);
    console.log("Create LP step 1!");
    const initPoolInstruction =
      await Liquidity.makeCreatePoolV4InstructionV2Simple({
        connection: httpsConnectionForLP,
        programId: MAINNET_PROGRAM_ID.AmmV4,
        marketInfo: {
          marketId: marketId,
          programId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
        },
        baseMintInfo: { mint: baseMint, decimals: 6 },
        quoteMintInfo: { mint: wsolPK, decimals: 9 },
        baseAmount: new BN(tokenAmount),
        quoteAmount: new BN(solAmount),
        startTime: new BN(poolStartTime),
        ownerInfo: {
          feePayer: devWallet.publicKey,
          wallet: devWallet.publicKey,
          tokenAccounts: tokenAccountsOfDevwallet,
          useSOLBalance: false,
        },
        associatedOnly: true,
        checkCreateATAOwner: true,
        makeTxVersion: TxVersion.V0,
        feeDestinationId,
      });
    const pool = initPoolInstruction.address.ammId;

    console.log("pool address: ", pool.toString());

    let createLPInstructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: ENV_SETTINGS.COMPUTE_PRICE,
      }),
    ];
    let createLPSigners: Signer[] = [devWallet];

    for (let ix of initPoolInstruction.innerTransactions) {
      createLPInstructions.push(...ix.instructions);
      createLPSigners.push(...ix.signers);
    }
    await sleep(1);
    /*Get latest Blockhash*/
    const createLpBlockhash = await httpsConnectionForLP.getLatestBlockhash();
    /*Compile as Version 0*/
    const newLpTxMsg = new TransactionMessage({
      payerKey: devWallet.publicKey,
      recentBlockhash: createLpBlockhash.blockhash,
      instructions: createLPInstructions,
    }).compileToV0Message();
    const versionedLpMsg = new VersionedTransaction(newLpTxMsg);
    versionedLpMsg.sign(createLPSigners);

    // console.log("Create LP step 2!");
    // //Create buy token transaction
    // const buyerATA = getAssociatedTokenAddressSync(baseMint, buyerWallet.publicKey);
    // const buyInstructions: TransactionInstruction[] = [
    //   SystemProgram.transfer({
    //     fromPubkey: buyerWallet.publicKey,
    //     toPubkey: devWallet.publicKey,
    //     lamports: buyAmount,
    //   }),
    //   // Add compute budget program instructions to buy the token in here
    //   ComputeBudgetProgram.setComputeUnitPrice({
    //     microLamports: ENV_SETTINGS.COMPUTE_PRICE,
    //   })
    // ];

    // const buySigners: Signer[] = [buyerWallet];
    // const buyBlockhash = await httpsConnectionForLP.getLatestBlockhash();
    // const newBuyTxMsg = new TransactionMessage({
    //   payerKey: buyerWallet.publicKey,
    //   recentBlockhash: buyBlockhash.blockhash,
    //   instructions: buyInstructions,
    // }).compileToV0Message();
    // const versionedBuyMsg = new VersionedTransaction(newBuyTxMsg);
    // versionedBuyMsg.sign(buySigners);
    
    // // Bundle transactions using Jito
    // const randomEngineIndex = Math.floor(Math.random() * 5);
    // console.log(`random index of Jito engine: ${randomEngineIndex}`);
    // const bundleRes = await sendTxWithBundle(randomEngineIndex, [versionedLpMsg, versionedBuyMsg]);

    // if (!bundleRes) {
    //   console.error("lp creation and buy token tx failed");
    //   return null;
    // } else {
    //   console.log(`bundle tx: ${bundleRes}`);
    //   return {
    //     pool: pool,
    //     opentime: poolStartTime,
    //     lpToken: initPoolInstruction.address.lpMint,
    //   };
    // }

    // Send Transaction of LP creation ----- Current
    const lpCreationRes = await httpsConnectionForLP.sendRawTransaction(
      versionedLpMsg.serialize(),
      { skipPreflight: false }
    );
    /*Confirmation*/
    const confirmation = await httpsConnection1.confirmTransaction({
      signature: lpCreationRes,
      lastValidBlockHeight: createLpBlockhash.lastValidBlockHeight,
      blockhash: createLpBlockhash.blockhash,
    });
    /*Return pool, opening time and lp token information*/
    if (confirmation.value.err) {
      console.error("lp creation is failed", confirmation.value.err);
      return null;
    } else {
      console.log(`pool creation tx: ${lpCreationRes}`);
      console.log(`pool: ${pool.toString()}`);
      console.log(`lp token: ${initPoolInstruction.address.lpMint.toString()}`);
      return {
        pool: pool,
        opentime: poolStartTime,
        lpToken: initPoolInstruction.address.lpMint,
      };
    }


    //Send Transaction of LP creation -------------- OLD
    // const txId = await buildAndSendTx({
    //   connection: httpsConnectionForLP,
    //   makeTxVersion: TxVersion.V0,
    //   owner: devWallet,
    //   innerSimpleV0Transaction: initPoolInstruction.innerTransactions
    // });
    // console.log(`pool creation tx: ${txId}`);
    // return {
    //   pool: pool,
    //   opentime: poolStartTime,
    //   lpToken: initPoolInstruction.address.lpMint
    // };
  } else {
    console.error("no market ID");
    return null;
  }
}

/*Remove LP*/
export async function removeLPALL(
  pool: PublicKey,
  lpMint: PublicKey,
  devWallet: Keypair
) {
  const targetPoolInfo = await getLiquidityV4PoolKeys(
    httpsConnectionForLP,
    pool
  );
  if (targetPoolInfo) {
    const baseMintATA = getAssociatedTokenAddressSync(
      targetPoolInfo.baseMint,
      devWallet.publicKey
    );
    const quoteMintATA = getAssociatedTokenAddressSync(
      targetPoolInfo.quoteMint,
      devWallet.publicKey
    );
    const lpMintATA = getAssociatedTokenAddressSync(
      lpMint,
      devWallet.publicKey
    );
    let lpTokenAmount: BigNumberish = 0;
    try {
      const lpTokenBal = (
        await httpsConnection1.getTokenAccountBalance(lpMintATA)
      ).value.amount;
      lpTokenAmount = lpTokenBal ? lpTokenBal : 0;
    } catch {
      console.error(`there is no lp token in your wallet`);
      return null;
    }
    const fastRemoveLpInstruction = Liquidity.makeRemoveLiquidityInstruction({
      amountIn: lpTokenAmount,
      poolKeys: targetPoolInfo,
      userKeys: {
        baseTokenAccount: baseMintATA,
        quoteTokenAccount: quoteMintATA,
        lpTokenAccount: lpMintATA,
        owner: devWallet.publicKey,
      },
    }).innerTransaction;

    /*Select Jito tip account randomly*/
    const randomIdx = Math.floor(Math.random() * TIP_ACCOUNTS.length);
    const tipAccount = new PublicKey(TIP_ACCOUNTS[randomIdx]);
    /*Make Transaction*/
    let ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 2000000,
      }),
      SystemProgram.transfer({
        fromPubkey: devWallet.publicKey,
        toPubkey: tipAccount,
        lamports: ENV_SETTINGS.JITO_TIP,
      }),
      ...fastRemoveLpInstruction.instructions,
    ];
    if (Number(lpTokenAmount) == 0) {
      console.error(`there is no lp token`);
      return null;
    }
    let ixsSigners: Signer[] = [devWallet];
    // for (let ix of removeLPInstruction.innerTransactions) {
    //   ixs.push(...ix.instructions);
    //   ixsSigners.push(...ix.signers);
    // }
    /*Close LPtoken account*/
    ixs.push(
      createCloseAccountInstruction(
        lpMintATA,
        devWallet.publicKey,
        devWallet.publicKey,
        []
      )
    );
    /*Burn mint token*/
    // ixs.push();
    let blockHash = await httpsConnectionForLP.getLatestBlockhash();
    const newRemoveTxMsg = new TransactionMessage({
      payerKey: devWallet.publicKey,
      recentBlockhash: blockHash.blockhash,
      instructions: ixs,
    }).compileToV0Message();
    const versionedMsg = new VersionedTransaction(newRemoveTxMsg);
    versionedMsg.sign(ixsSigners);
    /*Use Jito*/
    const randomEngineIndex = Math.floor(Math.random() * 5);
    console.log(`random index of Jito engine: ${randomEngineIndex}`);
    const bundleRes = await sendTxWithBundle(randomEngineIndex, [versionedMsg]);
    // const ixsRes = await httpsConnect2ionForLP.sendRawTransaction(
    //   versionedMsg.serialize(),
    //   { skipPreflight: true }
    // );
    // const confirmation = await httpsConnectionForLP.confirmTransaction({
    //   signature: ixsRes,
    //   lastValidBlockHeight: blockHash.lastValidBlockHeight,
    //   blockhash: blockHash.blockhash
    // });
    if (!bundleRes) {
      console.error("remove lp tx is faile");
      return null;
    } else {
      console.log(`remove LP tx: ${bundleRes}`);
      await sleep(4);
      await removeBaseAndUnwrapSol(
        httpsConnection1,
        devWallet,
        targetPoolInfo.baseMint
      );
      return bundleRes;
    }
    // const removetxId = await buildAndSendTx({
    //   connection: httpsConnectionForLP,
    //   makeTxVersion: TxVersion.V0,
    //   owner: devWallet,
    //   innerSimpleV0Transaction: removeLPInstruction.innerTransactions
    // });
    // console.log(`LP is removed`);
    // console.log(removetxId);
  } else {
    console.error("pool keys error");
    return null;
  }
}

export const getLiquidityV4PoolKeys = async (
  connection: Connection,
  pool: PublicKey
) => {
  console.log("get pool info");
  const poolAccount = await connection.getAccountInfo(pool, "confirmed");

  if (!poolAccount) {
    console.error("pool account not found");
    return null;
  }

  console.log("pool account found", poolAccount);

  // Check if the pool is a Raydium V4 pool
  if (poolAccount.owner.toBase58() != MAINNET_PROGRAM_ID.AmmV4.toBase58()) {
    return null;
  }
  const poolInfo = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);

  console.log("pool info", poolInfo);

  if (
    poolInfo.baseMint.toBase58() != Token.WSOL.mint.toBase58() &&
    poolInfo.quoteMint.toBase58() != Token.WSOL.mint.toBase58()
  ) {
    return null;
  }

  const marketAccount = await connection.getAccountInfo(
    poolInfo.marketId,
    "confirmed"
  );
  if (!marketAccount) return null;
  const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);

  const lpMintAccount = await connection.getAccountInfo(
    poolInfo.lpMint,
    "confirmed"
  );
  if (!lpMintAccount) return null;
  const lpMintInfo = SPL_MINT_LAYOUT.decode(lpMintAccount.data);

  const poolKeys: LiquidityPoolKeys = {
    id: pool,
    baseMint: poolInfo.baseMint,
    quoteMint: poolInfo.quoteMint,
    lpMint: poolInfo.lpMint,
    baseDecimals: Number(poolInfo.baseDecimal),
    quoteDecimals: Number(poolInfo.quoteDecimal),
    lpDecimals: lpMintInfo.decimals,
    version: 4,
    programId: poolAccount.owner,
    authority: Liquidity.getAssociatedAuthority({
      programId: poolAccount.owner,
    }).publicKey,
    openOrders: poolInfo.openOrders,
    targetOrders: poolInfo.targetOrders,
    baseVault: poolInfo.baseVault,
    quoteVault: poolInfo.quoteVault,
    withdrawQueue: poolInfo.withdrawQueue,
    lpVault: poolInfo.lpVault,
    marketVersion: 3,
    marketProgramId: poolInfo.marketProgramId,
    marketId: poolInfo.marketId,
    marketAuthority: RayMarket.getAssociatedAuthority({
      programId: poolInfo.marketProgramId,
      marketId: poolInfo.marketId,
    }).publicKey,
    marketBaseVault: marketInfo.baseVault,
    marketQuoteVault: marketInfo.quoteVault,
    marketBids: marketInfo.bids,
    marketAsks: marketInfo.asks,
    marketEventQueue: marketInfo.eventQueue,
    lookupTableAccount: PublicKey.default,
  };

  return poolKeys;
};

async function createMarket(devWallet: Keypair, baseMint: PublicKey) {
  const marketAccounts = {
    market: Keypair.generate(),
    requestQueue: Keypair.generate(),
    eventQueue: Keypair.generate(),
    bids: Keypair.generate(),
    asks: Keypair.generate(),
    baseVault: Keypair.generate(),
    quoteVault: Keypair.generate(),
  };
  /*Determine lotsize of base, quote lotsize is 1 as default*/
  // const baseInformation = (await httpsConnection1.getTokenSupply(baseMint))
  //   .value;
  // const lgBaseTotalSupply = baseInformation.amount.length;
  // console.log(lgBaseTotalSupply);
  // const lgOfBaseLot = Math.max(0, lgBaseTotalSupply - 10);
 
  console.log("start creating market");
  const programID = new PublicKey(
    "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"
  );
  const vaultInstructions: TransactionInstruction[] = [];
  const vaultSigners: Signer[] = [];
  const [vaultOwner, vaultOwnerNonce] = await getVaultOwnerAndNonce(
    marketAccounts.market.publicKey,
    programID
  );
  const lamportsForAccount =
    await httpsConnection1.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
  /**/
  vaultInstructions.push(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: ENV_SETTINGS.COMPUTE_PRICE,
    }),
    ...[
      SystemProgram.createAccount({
        fromPubkey: devWallet.publicKey,
        newAccountPubkey: marketAccounts.baseVault.publicKey,
        lamports: lamportsForAccount,
        space: ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      SystemProgram.createAccount({
        fromPubkey: devWallet.publicKey,
        newAccountPubkey: marketAccounts.quoteVault.publicKey,
        lamports: lamportsForAccount,
        space: ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccountInstruction(
        marketAccounts.baseVault.publicKey,
        baseMint,
        vaultOwner
      ),
      createInitializeAccountInstruction(
        marketAccounts.quoteVault.publicKey,
        wsolPK,
        vaultOwner
      ),
    ]
  );
  /**/
  vaultSigners.push(
    devWallet,
    marketAccounts.baseVault,
    marketAccounts.quoteVault
  );

  /*DEfine Market inst*/
  let baseMintDecimals: number = 6;
  let quoteMintDecimals: number = 9;
  const baseLotSize = new BN(Math.pow(10, 6));
  const quoteLotSize = new BN(Math.round(1));
  const marketInstructions: TransactionInstruction[] = [];
  const marketSigners: Signer[] = [
    devWallet,
    marketAccounts.market,
    marketAccounts.bids,
    marketAccounts.asks,
    marketAccounts.eventQueue,
    marketAccounts.requestQueue,
  ];
  /**/
  marketInstructions.push(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: ENV_SETTINGS.COMPUTE_PRICE,
    }),
    SystemProgram.createAccount({
      newAccountPubkey: marketAccounts.market.publicKey,
      fromPubkey: devWallet.publicKey,
      space: Market.getLayout(programID).span,
      lamports: await httpsConnectionForLP.getMinimumBalanceForRentExemption(
        Market.getLayout(programID).span
      ),
      programId: programID,
    })
  );
  await sleep(0.1);
  const { totalEventQueueSize, totalOrderbookSize, totalRequestQueueSize } =
    useSerumMarketAccountSizes({
      eventQueueLength: EVENT_QUEUE_LENGTH,
      requestQueueLength: REQUEST_QUEUE_LENGTH,
      orderbookLength: ORDERBOOK_LENGTH,
    });
  /*Event Queue*/
  marketInstructions.push(
    SystemProgram.createAccount({
      newAccountPubkey: marketAccounts.requestQueue.publicKey,
      fromPubkey: devWallet.publicKey,
      space: totalRequestQueueSize,
      lamports: await httpsConnectionForLP.getMinimumBalanceForRentExemption(
        totalRequestQueueSize
      ),
      programId: programID,
    })
  );
  /*create event queue*/
  marketInstructions.push(
    SystemProgram.createAccount({
      newAccountPubkey: marketAccounts.eventQueue.publicKey,
      fromPubkey: devWallet.publicKey,
      space: totalEventQueueSize,
      lamports: await httpsConnection1.getMinimumBalanceForRentExemption(
        totalEventQueueSize
      ),
      programId: programID,
    })
  );
  await sleep(0.1);
  /*Create Order book*/
  const orderBookRentExempt =
    await httpsConnectionForLP.getMinimumBalanceForRentExemption(
      totalOrderbookSize
    );
  /*create bids*/
  marketInstructions.push(
    SystemProgram.createAccount({
      newAccountPubkey: marketAccounts.bids.publicKey,
      fromPubkey: devWallet.publicKey,
      space: totalOrderbookSize,
      lamports: orderBookRentExempt,
      programId: programID,
    })
  );
  /*create asks*/
  marketInstructions.push(
    SystemProgram.createAccount({
      newAccountPubkey: marketAccounts.asks.publicKey,
      fromPubkey: devWallet.publicKey,
      space: totalOrderbookSize,
      lamports: orderBookRentExempt,
      programId: programID,
    })
  );
  marketInstructions.push(
    DexInstructions.initializeMarket({
      market: marketAccounts.market.publicKey,
      requestQueue: marketAccounts.requestQueue.publicKey,
      eventQueue: marketAccounts.eventQueue.publicKey,
      bids: marketAccounts.bids.publicKey,
      asks: marketAccounts.asks.publicKey,
      baseVault: marketAccounts.baseVault.publicKey,
      quoteVault: marketAccounts.quoteVault.publicKey,
      baseMint,
      quoteMint: wsolPK,
      baseLotSize,
      quoteLotSize,
      feeRateBps: 150, // Unused in v3
      quoteDustThreshold: new BN(500), // Unused in v3
      vaultSignerNonce: vaultOwnerNonce,
      programId: programID,
    })
  );
  await sleep(0.5);
  /*---------------Send both transaction----------------*/
  /*-Send Valut Signer-*/
  const recentBlockForValut = await httpsConnectionForLP.getLatestBlockhash();
  const newVaultTxMsg = new TransactionMessage({
    payerKey: devWallet.publicKey,
    recentBlockhash: recentBlockForValut.blockhash,
    instructions: vaultInstructions,
  }).compileToV0Message();
  const versionedVaultMsg = new VersionedTransaction(newVaultTxMsg);
  versionedVaultMsg.sign(vaultSigners);
  const valutTxRes = await httpsConnectionForLP.sendRawTransaction(
    versionedVaultMsg.serialize(),
    { skipPreflight: false }
  );
  const confirmationForVault = await httpsConnection1.confirmTransaction({
    signature: valutTxRes,
    lastValidBlockHeight: recentBlockForValut.lastValidBlockHeight,
    blockhash: recentBlockForValut.blockhash,
  });
  if (confirmationForVault.value.err) {
    console.log("vault tx failed", confirmationForVault.value.err);
    return null;
  } else {
    /*-------------------*/
    console.log(`valut tx: ${valutTxRes}`);
    await sleep(0.2);
    const recentBlockForMarket = await httpsConnection1.getLatestBlockhash();
    const newMatketTxMsg = new TransactionMessage({
      payerKey: devWallet.publicKey,
      recentBlockhash: recentBlockForMarket.blockhash,
      instructions: marketInstructions,
    }).compileToV0Message();
    const versionedMarketMsg = new VersionedTransaction(newMatketTxMsg);
    versionedMarketMsg.sign(marketSigners);
    const marketTxRes = await httpsConnection1.sendRawTransaction(
      versionedMarketMsg.serialize(),
      { skipPreflight: false }
    );
    const confirmationForMarket = await httpsConnectionForLP.confirmTransaction(
      {
        signature: marketTxRes,
        lastValidBlockHeight: recentBlockForMarket.lastValidBlockHeight,
        blockhash: recentBlockForMarket.blockhash,
      }
    );
    if (confirmationForMarket.value.err) {
      console.error("market tx failed", confirmationForMarket.value.err);
      return null;
    } else {
      console.log(`market tx: ${marketTxRes}`);
      console.log(`market ID: ${marketAccounts.market.publicKey}`);
      return marketAccounts.market.publicKey;
    }
  }
}

async function addLiquidity(
  devWallet: Keypair,
  solAmount: number,
  poolInfo: {
    pool: PublicKey;
    marketId: PublicKey;
    lpMint: PublicKey;
  }
) {
  const poolKeys = await getLiquidityV4PoolKeys(
    httpsConnection1,
    poolInfo.pool
  );
  const lpMintATA = getAssociatedTokenAddressSync(
    poolInfo.lpMint,
    devWallet.publicKey
  );

  if (poolKeys) {
    const baseATA = getAssociatedTokenAddressSync(
      poolKeys.baseMint,
      devWallet.publicKey
    );
    let baseAmount: BigNumberish = 0;
    try {
      baseAmount = (await httpsConnection1.getTokenAccountBalance(baseATA))
        .value.amount;
    } catch {
      console.error("there is base token balance");
      return null;
    }
    const addLpInstruction = Liquidity.makeAddLiquidityInstruction({
      poolKeys: poolKeys,
      userKeys: {
        baseTokenAccount: baseATA,
        quoteTokenAccount: getAssociatedTokenAddressSync(
          poolKeys.quoteMint,
          devWallet.publicKey
        ),
        lpTokenAccount: lpMintATA,
        owner: devWallet.publicKey,
      },
      baseAmountIn: baseAmount,
      quoteAmountIn: solAmount,
      fixedSide: "base",
    }).innerTransaction;
    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: ENV_SETTINGS.COMPUTE_PRICE,
      }),
      ...addLpInstruction.instructions,
    ];
    const ixsSigners: Signer[] = [devWallet, ...addLpInstruction.signers];
    let blockHash = await httpsConnectionForLP.getLatestBlockhash();
    const newAddLpMsg = new TransactionMessage({
      payerKey: devWallet.publicKey,
      recentBlockhash: blockHash.blockhash,
      instructions: ixs,
    }).compileToV0Message();
    const versionedMsg = new VersionedTransaction(newAddLpMsg);
    versionedMsg.sign(ixsSigners);
    const ixsRes = await httpsConnectionForLP.sendRawTransaction(
      versionedMsg.serialize(),
      { skipPreflight: false }
    );
    const confirmation = await httpsConnectionForLP.confirmTransaction({
      signature: ixsRes,
      lastValidBlockHeight: blockHash.lastValidBlockHeight,
      blockhash: blockHash.blockhash,
    });
    if (confirmation.value.err) {
      console.error("failed add lp", confirmation.value.err);
      return null;
    } else {
      console.log(`add lp tx, ${ixsRes}`);
      return solAmount;
    }
  }
}
