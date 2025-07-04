require('dotenv').config();

import bs58 from 'bs58';
import fs from 'fs';
import axios from 'axios';
import {
  Keypair, Connection, PublicKey, Transaction,
  SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
  VersionedTransaction, ComputeBudgetProgram
} from '@solana/web3.js';
import { createAssociatedTokenAccountInstruction, getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { ENV_SETTINGS } from "../../config";

// Configuration
let NUM_CHILD_WALLETS = 3;
let SOL_AMOUNT_PER_WALLET = 0.01;
let MIN_TRADE_AMOUNT_SOL = 0.001;
let MAX_TRADE_AMOUNT_SOL = 0.002;
const TRADE_INTERVAL_MIN = 1000; //2 * 60 * 1000; // 2 minutes
const TRADE_INTERVAL_MAX = 2500; // 10 * 60 * 1000; // 10 minutes
const SWAP_SLIPPAGE = 6000; // 1% slippage, increased for better success rate
const MAX_RETRIES = 3; // Maximum number of retries for failed transactions
const PRIORITY_FEE = 5000; // Priority fee in microlamports


// Add these new configuration parameters at the top of your file
const MAX_CONSECUTIVE_BUYS = 3;  // Maximum number of consecutive buys
const MAX_CONSECUTIVE_SELLS = 3; // Maximum number of consecutive sells
const MIN_SELL_PERCENTAGE = 30;  // Minimum percentage to sell (30%)
const MAX_SELL_PERCENTAGE = 100; // Maximum percentage to sell (100%)

// Track the current operation type
let consecutiveBuys = 0;
let consecutiveSells = 0;


let TOKEN_MINT = new PublicKey('474cXktRed3TZ61VX3P44ZWfcbomcLNuY5n811DarbnX');

// Add this to track the bot's scheduled tasks
let tradingIntervalId: NodeJS.Timeout | null = null;
let botActive = false;

// Token addresses
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Create connection with commitment level and confirmation strategy
const connection = new Connection(ENV_SETTINGS.HTTPS_RPC_URL2, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000, // 60 seconds timeout
});

// Alternative RPC endpoints to try if primary fails
const BACKUP_RPC_URLS = [
  ENV_SETTINGS.HTTPS_RPC_URL1,
  ENV_SETTINGS.HTTPS_RPC_URL2,
  ENV_SETTINGS.HTTPS_RPC_URL3,
];

// Store child wallets
let childWallets: Keypair[] = [];

// Distribute SOL to child wallets
export async function distributeSOL() {
  try {
    // Load master wallet from private key in .env
    const masterPrivateKey = process.env.VOLUME_BOT_MASTER_WALLET;
    if (!masterPrivateKey) {
      throw new Error('Master wallet private key not found in .env file');
    }

    // Convert private key from base58 to Uint8Array and create keypair
    const masterKeypair = Keypair.fromSecretKey(bs58.decode(masterPrivateKey));
    console.log(`Master Wallet: ${masterKeypair.publicKey.toString()}`);

    // Check master wallet balance
    const masterBalance = await connection.getBalance(masterKeypair.publicKey);
    const masterBalanceSOL = masterBalance / LAMPORTS_PER_SOL;
    console.log(`Master Wallet Balance: ${masterBalanceSOL} SOL`);

    // Calculate required SOL
    const requiredSOL = NUM_CHILD_WALLETS * SOL_AMOUNT_PER_WALLET;
    if (masterBalanceSOL < requiredSOL) {
      throw new Error(`Insufficient balance. Need ${requiredSOL} SOL but have ${masterBalanceSOL} SOL`);
    }

    // Generate child wallets and distribute SOL
    console.log(`\nGenerating ${NUM_CHILD_WALLETS} child wallets and distributing ${SOL_AMOUNT_PER_WALLET} SOL to each...\n`);

    childWallets = [];

    for (let i = 0; i < NUM_CHILD_WALLETS; i++) {
      // Generate new wallet
      const childWallet = Keypair.generate();
      childWallets.push(childWallet);

      // Log child wallet details
      console.log(`Child Wallet ${i + 1}:`);
      console.log(`  Public Key: ${childWallet.publicKey.toString()}`);
      console.log(`  Private Key: ${bs58.encode(childWallet.secretKey)}`);

      // Create and send transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: masterKeypair.publicKey,
          toPubkey: childWallet.publicKey,
          lamports: SOL_AMOUNT_PER_WALLET * LAMPORTS_PER_SOL
        })
      );

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [masterKeypair]
      );

      console.log(`  Transaction: https://solscan.io/tx/${signature}`);
      console.log(`  SOL Transferred: ${SOL_AMOUNT_PER_WALLET}\n`);
    }

    // Save wallet information to file for later use
    saveWallets(childWallets);

    // Final master wallet balance
    const finalMasterBalance = await connection.getBalance(masterKeypair.publicKey);
    console.log(`Final Master Wallet Balance: ${finalMasterBalance / LAMPORTS_PER_SOL} SOL`);

    return childWallets;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Save wallets to file
function saveWallets(wallets: Keypair[]) {
  try {
    const walletsData = wallets.map(wallet => ({
      publicKey: wallet.publicKey.toString(),
      privateKey: bs58.encode(wallet.secretKey)
    }));

    fs.writeFileSync('./wallets.json', JSON.stringify(walletsData, null, 2));
    console.log('Wallets saved to wallets.json');
  } catch (error) {
    console.error('Error saving wallets:', error);
  }
}

// Load wallets from file
function loadWallets(): Keypair[] {
  try {
    // Check if file exists
    if (!fs.existsSync('./wallets.json')) {
      console.log('wallets.json file not found');
      return [];
    }

    const fileContent = fs.readFileSync('./wallets.json', 'utf-8');
    if (!fileContent || fileContent.trim() === '') {
      console.log('wallets.json file is empty');
      return [];
    }

    const walletsData = JSON.parse(fileContent);
    return walletsData.map((wallet: any) =>
      Keypair.fromSecretKey(bs58.decode(wallet.privateKey))
    );
  } catch (error) {
    console.error('Error loading wallets:', error);
    return [];
  }
}

// Try different RPC endpoints if one fails
async function withFallbackRPC<T>(operation: (conn: Connection) => Promise<T>): Promise<T> {
  let lastError;

  // Try with the primary connection first
  try {
    return await operation(connection);
  } catch (error) {
    console.warn("Primary RPC failed, trying fallbacks...");
    lastError = error;
  }

  // Try each backup RPC
  for (const rpcUrl of BACKUP_RPC_URLS) {
    try {
      const backupConnection = new Connection(rpcUrl, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000
      });
      return await operation(backupConnection);
    } catch (error) {
      console.warn(`Backup RPC ${rpcUrl} failed`);
      lastError = error;
    }
  }

  throw lastError;
}

// Check if wallet has token
async function hasToken(walletPubkey: PublicKey, tokenMint: PublicKey): Promise<boolean> {
  try {
    const tokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      walletPubkey
    );

    try {
      const accountInfo = await withFallbackRPC(conn => getAccount(conn, tokenAccount));
      return Number(accountInfo.amount) > 0;
    } catch (e) {
      // Token account doesn't exist or has no balance
      return false;
    }
  } catch (error) {
    console.error('Error checking token balance:', error);
    return false;
  }
}

// Get token balance
async function getTokenBalance(walletPubkey: PublicKey, tokenMint: PublicKey): Promise<number> {
  try {
    const tokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      walletPubkey
    );

    try {
      const accountInfo = await withFallbackRPC(conn => getAccount(conn, tokenAccount));
      return Number(accountInfo.amount);
    } catch (e) {
      return 0;
    }
  } catch (error) {
    console.error('Error getting token balance:', error);
    return 0;
  }
}

// Ensure token account exists
async function ensureTokenAccount(wallet: Keypair, tokenMint: PublicKey): Promise<boolean> {
  try {
    const tokenAccount = await getAssociatedTokenAddress(tokenMint, wallet.publicKey);

    // Check if account exists
    try {
      await withFallbackRPC(conn => getAccount(conn, tokenAccount));
      console.log("Token account already exists");
      return true;
    } catch (e) {
      // Account doesn't exist, create it
      console.log("Creating token account...");

      const transaction = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE }))
        .add(createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          tokenAccount,
          wallet.publicKey,
          tokenMint
        ));

      const signature = await withFallbackRPC(conn =>
        sendAndConfirmTransaction(conn, transaction, [wallet])
      );

      console.log(`Created token account: ${signature}`);

      // Wait for confirmation
      await new Promise(resolve => setTimeout(resolve, 2000));
      return true;
    }
  } catch (error) {
    console.error("Error creating token account:", error);
    return false;
  }
}

// Get quote for swap with retry
async function getSwapQuote(inputMint: string, outputMint: string, amount: number, isSol: boolean, retryCount = 0): Promise<any> {
  try {
    // If input is SOL, amount is in SOL units, otherwise it's in token units
    const amountInSmallestUnits = isSol ? Math.floor(amount * LAMPORTS_PER_SOL) : amount;

    console.log(`Getting quote: ${inputMint} -> ${outputMint}, amount: ${amountInSmallestUnits}, slippage: ${SWAP_SLIPPAGE / 100}%`);

    const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
      params: {
        inputMint,
        outputMint,
        amount: amountInSmallestUnits,
        slippageBps: SWAP_SLIPPAGE,
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
        platformFeeBps: 0
      },
      timeout: 10000 // 10 second timeout
    });
    return response.data;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.log(`Retry ${retryCount + 1}/${MAX_RETRIES} for quote...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return getSwapQuote(inputMint, outputMint, amount, isSol, retryCount + 1);
    }
    console.error('Error getting swap quote after retries:', error);
    throw error;
  }
}

// Random number between min and max
function getRandomNumber(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// Swap tokens using Jupiter API with retry mechanism
async function swapTokens(
  wallet: Keypair,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amountIn: number,
  isBuy: boolean,
  retryCount = 0
): Promise<boolean> {
  try {
    console.log(`${isBuy ? 'Buying' : 'Selling'} with wallet ${wallet.publicKey.toString()}`);
    console.log(`Amount: ${amountIn} ${isBuy ? 'SOL' : 'TOKEN'}`);

    // For buy: SOL -> TOKEN, isSol = true
    // For sell: TOKEN -> SOL, isSol = false
    const isSol = isBuy;

    // Check wallet SOL balance first
    const solBalance = await withFallbackRPC(conn => conn.getBalance(wallet.publicKey));
    console.log(`Current SOL balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);

    if (solBalance < 0.002 * LAMPORTS_PER_SOL) {
      console.log("Insufficient SOL balance for transaction fees");
      return false;
    }

    // If buying, ensure the token account exists before the swap
    if (isBuy) {
      const accountCreated = await ensureTokenAccount(wallet, TOKEN_MINT);
      if (!accountCreated) {
        console.log("Failed to create token account");
        return false;
      }
    }

    // Check if wallet has tokens when selling
    if (!isBuy) {
      const tokenBalance = await getTokenBalance(wallet.publicKey, TOKEN_MINT);
      if (tokenBalance <= 0) {
        console.log(`Wallet ${wallet.publicKey.toString()} has no tokens to sell, doing a buy instead`);
        // If no tokens to sell, do a buy instead
        return await swapTokens(wallet, SOL_MINT, TOKEN_MINT, getRandomNumber(MIN_TRADE_AMOUNT_SOL, MAX_TRADE_AMOUNT_SOL), true);
      }

      // Update amountIn to actual token balance
      amountIn = tokenBalance;
      console.log(`Updated sell amount to actual token balance: ${amountIn}`);
    }

    // Get quote with retry
    const quote = await getSwapQuote(
      inputMint.toString(),
      outputMint.toString(),
      amountIn,
      isSol
    );

    // Get transaction
    const swapResponse = await axios.post('https://quote-api.jup.ag/v6/swap', {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: PRIORITY_FEE
    });

    // Get the serialized transaction
    const serializedTransaction = swapResponse.data.swapTransaction;

    // Deserialize and sign the transaction
    const buffer = Buffer.from(serializedTransaction, 'base64');

    // Jupiter always returns versioned transactions now
    const transaction = VersionedTransaction.deserialize(buffer);

    // Sign the transaction
    transaction.sign([wallet]);

    // Send the transaction with retry and fallback
    const signature = await withFallbackRPC(conn => conn.sendTransaction(transaction));
    console.log(`Transaction sent: ${signature}`);

    // Wait for confirmation with increased timeout
    const confirmation = await withFallbackRPC(conn =>
      conn.confirmTransaction(signature, 'confirmed')
    );

    if (confirmation.value.err) {
      throw new Error(`Transaction confirmed but has error: ${JSON.stringify(confirmation.value.err)}`);
    }

    console.log(`Transaction: https://solscan.io/tx/${signature}`);
    console.log(`${isBuy ? 'Buy' : 'Sell'} completed successfully`);
    return true;
  } catch (error) {
    console.error(`Error ${isBuy ? 'buying' : 'selling'} tokens:`, error);

    // Retry logic
    if (retryCount < MAX_RETRIES) {
      console.log(`Retry ${retryCount + 1}/${MAX_RETRIES} for ${isBuy ? 'buy' : 'sell'}...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      return swapTokens(wallet, inputMint, outputMint, amountIn, isBuy, retryCount + 1);
    }

    return false;
  }
}

// -------------------- BUY and SELL instantly -------------------------- //

// Add this variable at the top of your file with other constants
let currentWalletIndex = 0;

// Execute trades with buy-then-sell pattern
async function executeTradeSequence(wallets: Keypair[]) {
  try {

    //     // Random amount between min and max
    //     const amount = getRandomNumber(MIN_TRADE_AMOUNT_SOL, MAX_TRADE_AMOUNT_SOL);
    //     console.log("get Random Number:", amount);

    // Use round-robin to ensure all wallets participate
    const buyerWallet = wallets[currentWalletIndex];
    currentWalletIndex = (currentWalletIndex + 1) % wallets.length;

    console.log(`Starting trade sequence with wallet: ${buyerWallet.publicKey.toString()}`);

    // Check wallet SOL balance first
    const solBalance = await withFallbackRPC(conn => conn.getBalance(buyerWallet.publicKey));
    console.log(`Current SOL balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);

    if (solBalance < 0.003 * LAMPORTS_PER_SOL) {
      console.log("Insufficient SOL balance for trade sequence, skipping this wallet");
      return false;
    }

    // Random amount between min and max for buying (in SOL)
    const buyAmount = getRandomNumber(MIN_TRADE_AMOUNT_SOL, MAX_TRADE_AMOUNT_SOL);
    console.log(`Buy amount: ${buyAmount} SOL`);

    // Step 1: Buy tokens with the selected wallet
    console.log(`Step 1: Buying tokens with wallet ${buyerWallet.publicKey.toString()}`);
    const buySuccess = await swapTokens(buyerWallet, SOL_MINT, TOKEN_MINT, buyAmount, true);

    if (!buySuccess) {
      console.log("Buy transaction failed, skipping sell step");
      return false;
    }

    // Add a slightly longer delay between buy and sell to ensure the transaction is confirmed
    // and token balances are updated
    const delayMs = getRandomNumber(1500, 3000);
    console.log(`Waiting ${Math.round(delayMs / 1000)} seconds before selling...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Get token balance before attempting to sell
    const tokenBalance = await getTokenBalance(buyerWallet.publicKey, TOKEN_MINT);
    console.log(`Token balance before sell: ${tokenBalance}`);

    if (tokenBalance <= 0) {
      console.log("No tokens to sell, skipping sell step");
      return false;
    }

    // Step 2: Sell ALL the tokens we just bought
    console.log(`Step 2: Selling ${tokenBalance} tokens with wallet ${buyerWallet.publicKey.toString()}`);
    const sellSuccess = await swapTokens(buyerWallet, TOKEN_MINT, SOL_MINT, tokenBalance, false);

    return buySuccess && sellSuccess;
  } catch (error) {
    console.error("Error executing trade sequence:", error);
    return false;
  }
}

// Start volume bot with new logic
export async function startVolumeBot(config?: {
  tokenMint?: string,
  numChildWallets?: number,
  distributeAmount?: number,
  minTradeAmount?: number,
  maxTradeAmount?: number
}) {
  console.log('Starting Solana volume bot with buy-sell pattern...');

    // Update configuration if provided
    if (config) {
      if (config.tokenMint) TOKEN_MINT = new PublicKey(config.tokenMint);
      if (config.numChildWallets) NUM_CHILD_WALLETS = config.numChildWallets;
      if (config.distributeAmount) SOL_AMOUNT_PER_WALLET = config.distributeAmount;
      if (config.minTradeAmount) MIN_TRADE_AMOUNT_SOL = config.minTradeAmount;
      if (config.maxTradeAmount) MAX_TRADE_AMOUNT_SOL = config.maxTradeAmount;
    }
    
    console.log(`Configuration: Token=${TOKEN_MINT.toString()}, Wallets=${NUM_CHILD_WALLETS}, Amount=${SOL_AMOUNT_PER_WALLET}`);
    console.log(`Trade Range: ${MIN_TRADE_AMOUNT_SOL}-${MAX_TRADE_AMOUNT_SOL} SOL`);
  
    // Set bot as active
    botActive = true;

  // Load or distribute wallets
  let wallets: Keypair[] = loadWallets();
  if (wallets.length === 0) {
    console.log('No wallets found, distributing SOL to new wallets...');
    wallets = await distributeSOL();
  } else {
    console.log(`Loaded ${wallets.length} existing wallets`);

    // Check balances of loaded wallets
    for (let i = 0; i < wallets.length; i++) {
      const balance = await withFallbackRPC(conn => conn.getBalance(wallets[i].publicKey));
      console.log(`Wallet ${i + 1} (${wallets[i].publicKey.toString()}) balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    }
  }

  // Start the trade sequence loop
  scheduleNextTradeSequence(wallets);

  return true;
}

// Add a stop function that also transfers all assets back to master wallet
export async function stopVolumeBot(): Promise<boolean> {
  console.log('Stopping Solana volume bot...');
  
  // Set bot as inactive
  botActive = false;
  
  // Clear any scheduled tasks
  if (tradingIntervalId) {
    clearTimeout(tradingIntervalId);
    tradingIntervalId = null;
    console.log('Volume bot stopped successfully');
  }
  
  // Transfer all assets back to master wallet
  console.log('Transferring all assets from child wallets to master wallet...');
  
  try {
    // Load all child wallets
    const childWallets = loadWallets();
    if (childWallets.length === 0) {
      console.log('No child wallets found, nothing to transfer');
      return true;
    }
    
    // Load master wallet
    const masterPrivateKey = process.env.VOLUME_BOT_MASTER_WALLET;
    if (!masterPrivateKey) {
      throw new Error('Master wallet private key not found in .env file');
    }

    // Convert private key from base58 to Uint8Array and create keypair
    const masterWallet = Keypair.fromSecretKey(bs58.decode(masterPrivateKey));
    console.log(`Master Wallet: ${masterWallet.publicKey.toString()}`);
    if (!masterWallet) {
      console.error('Could not load master wallet, aborting transfer');
      return false;
    }
    
    console.log(`Transferring assets to master wallet: ${masterWallet.publicKey.toString()}`);
    
    // Process each child wallet
    for (let i = 0; i < childWallets.length; i++) {
      const childWallet = childWallets[i];
      console.log(`Processing wallet ${i + 1}/${childWallets.length}: ${childWallet.publicKey.toString()}`);
      
      // 1. First transfer any tokens back to master
      const tokenBalance = await getTokenBalance(childWallet.publicKey, TOKEN_MINT);
      if (tokenBalance > 0) {
        console.log(`Transferring ${tokenBalance} tokens to master wallet`);
        // Use swapTokens to convert all tokens to SOL first (easier than direct token transfer)
        const sellSuccess = await swapTokens(childWallet, TOKEN_MINT, SOL_MINT, tokenBalance, false);
        if (!sellSuccess) {
          console.warn(`Failed to convert tokens to SOL for wallet ${childWallet.publicKey.toString()}`);
        } else {
          console.log(`Successfully converted tokens to SOL`);
          // Add small delay to ensure transaction is confirmed
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } else {
        console.log(`No tokens to transfer for this wallet`);
      }
      
      // 2. Then transfer remaining SOL back to master (leave a small amount for rent)
      try {
        // Get current SOL balance
        const solBalance = await withFallbackRPC(conn => conn.getBalance(childWallet.publicKey));
        console.log(`SOL balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);
        
        // Keep a small amount for rent (0.002 SOL)
        const RENT_EXEMPTION = 0.002 * LAMPORTS_PER_SOL;
        
        if (solBalance > RENT_EXEMPTION) {
          const transferAmount = solBalance - RENT_EXEMPTION;
          console.log(`Transferring ${transferAmount / LAMPORTS_PER_SOL} SOL to master wallet`);
          
          // Create and send SOL transfer transaction
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: childWallet.publicKey,
              toPubkey: masterWallet.publicKey,
              lamports: transferAmount
            })
          );
          
          // Set recent blockhash and fee payer
          transaction.recentBlockhash = (await withFallbackRPC(conn => conn.getLatestBlockhash())).blockhash;
          transaction.feePayer = childWallet.publicKey;
          
          // Sign and send transaction
          transaction.sign(childWallet);
          const signature = await withFallbackRPC(conn => conn.sendRawTransaction(transaction.serialize()));
          console.log(`SOL transfer signature: ${signature}`);
          
          // Wait for confirmation
          await withFallbackRPC(conn => conn.confirmTransaction(signature));
          console.log(`SOL transfer confirmed`);
        } else {
          console.log(`Not enough SOL to transfer (keeping for rent)`);
        }
      } catch (error) {
        console.error(`Error transferring SOL from wallet ${childWallet.publicKey.toString()}:`, error);
      }
    }
    
    console.log('Asset transfer complete');
    return true;
  } catch (error) {
    console.error('Error during asset transfer:', error);
    return false;
  }
}


async function executeRandomTradeSequence(wallets: Keypair[]) {
  try {
    // Use round-robin to ensure all wallets participate
    const wallet = wallets[currentWalletIndex];
    currentWalletIndex = (currentWalletIndex + 1) % wallets.length;

    console.log(`Starting trade sequence with wallet: ${wallet.publicKey.toString()}`);

    // Check wallet SOL balance first
    const solBalance = await withFallbackRPC(conn => conn.getBalance(wallet.publicKey));
    console.log(`Current SOL balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);

    // Get token balance
    const tokenBalance = await getTokenBalance(wallet.publicKey, TOKEN_MINT);
    console.log(`Current token balance: ${tokenBalance}`);

    // Determine operation type (buy or sell) with randomness
    // But ensure we don't do too many consecutive operations of the same type
    let shouldBuy = true;
    
    if (tokenBalance <= 0) {
      // If no tokens, we must buy
      shouldBuy = true;
      consecutiveSells = 0;
    } else if (solBalance < 0.003 * LAMPORTS_PER_SOL) {
      // If low on SOL, we must sell
      shouldBuy = false;
      consecutiveBuys = 0;
    } else {
      // Random decision with constraints
      if (consecutiveBuys >= MAX_CONSECUTIVE_BUYS) {
        // Force a sell if we've done too many consecutive buys
        shouldBuy = false;
        consecutiveBuys = 0;
      } else if (consecutiveSells >= MAX_CONSECUTIVE_SELLS) {
        // Force a buy if we've done too many consecutive sells
        shouldBuy = true;
        consecutiveSells = 0;
      } else {
        // Random choice
        shouldBuy = Math.random() > 0.5;
      }
    }

    if (shouldBuy) {
      // BUY OPERATION
      consecutiveBuys++;
      consecutiveSells = 0;
      
      if (solBalance < 0.003 * LAMPORTS_PER_SOL) {
        console.log("Insufficient SOL balance for buying, skipping this wallet");
        return false;
      }

      // Random amount between min and max for buying (in SOL)
      const buyAmount = getRandomNumber(MIN_TRADE_AMOUNT_SOL, MAX_TRADE_AMOUNT_SOL);
      console.log(`Buy operation: ${buyAmount} SOL`);

      const buySuccess = await swapTokens(wallet, SOL_MINT, TOKEN_MINT, buyAmount, true);
      return buySuccess;
    } else {
      // SELL OPERATION
      consecutiveSells++;
      consecutiveBuys = 0;
      
      if (tokenBalance <= 0) {
        console.log("No tokens to sell, skipping sell operation");
        return false;
      }

      // Determine what percentage of tokens to sell (random between MIN_SELL_PERCENTAGE and MAX_SELL_PERCENTAGE)
      const sellPercentage = getRandomNumber(MIN_SELL_PERCENTAGE, MAX_SELL_PERCENTAGE);
      const sellAmount = tokenBalance * (sellPercentage / 100);
      
      console.log(`Sell operation: ${sellPercentage}% of tokens (${sellAmount} tokens)`);

      const sellSuccess = await swapTokens(wallet, TOKEN_MINT, SOL_MINT, sellAmount, false);
      return sellSuccess;
    }
  } catch (error) {
    console.error("Error executing trade sequence:", error);
    return false;
  }
}

function scheduleNextTradeSequence(wallets: Keypair[]) {
  // Don't schedule if bot is not active
  if (!botActive) {
    console.log('Bot is not active, not scheduling next trade');
    return;
  }
  
  const interval = getRandomNumber(TRADE_INTERVAL_MIN, TRADE_INTERVAL_MAX);
  console.log(`Next trade sequence scheduled in ${Math.round(interval / 1000)} seconds`);

  tradingIntervalId = setTimeout(async () => {
    // Check again if bot is still active before executing
    if (!botActive) {
      console.log('Bot was deactivated, cancelling scheduled trade');
      return;
    }
    
    try {
      const result = await executeRandomTradeSequence(wallets);
      console.log(`Trade sequence completed with ${result ? 'success' : 'failure'}`);
    } catch (error) {
      console.error('Error executing trade sequence:', error);
    }

    // Schedule next trade sequence only if bot is still active
    if (botActive) {
      scheduleNextTradeSequence(wallets);
    }
  }, interval);
}
