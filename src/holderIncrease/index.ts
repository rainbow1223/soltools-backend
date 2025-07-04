require('dotenv').config();

import bs58 from 'bs58';
import fs from 'fs';
import axios from 'axios';
import {
  Keypair, Connection, PublicKey, Transaction,
  SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
  VersionedTransaction, ComputeBudgetProgram
} from '@solana/web3.js';
import { createAssociatedTokenAccountInstruction, createCloseAccountInstruction, getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { ENV_SETTINGS } from "../../config";

// Configuration
class Config {
  static NUM_CHILD_WALLETS = 3;
  static SOL_AMOUNT_PER_WALLET = 0.01;
  static MIN_TRADE_AMOUNT_SOL = 0.001;
  static MAX_TRADE_AMOUNT_SOL = 0.002;
  static SWAP_SLIPPAGE = 6000; // 1% slippage (in basis points)
  static MAX_RETRIES = 3;
  static PRIORITY_FEE = 5000; // microlamports
  static RENT_EXEMPTION = 0.002 * LAMPORTS_PER_SOL; // Amount to keep for rent
  static RENT_EXEMPTION_1 = 0.003 * LAMPORTS_PER_SOL; // Amount to keep for rent
  static TOKEN_MINT = new PublicKey('474cXktRed3TZ61VX3P44ZWfcbomcLNuY5n811DarbnX');
  static SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
}

// Bot state
let botActive = false;
let tradingIntervalId: NodeJS.Timeout | null = null;
let currentWalletIndex = 0;
let childWallets: Keypair[] = [];

// Connection setup
const connection = new Connection(ENV_SETTINGS.HTTPS_RPC_URL2, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000,
});

const BACKUP_RPC_URLS = [
  ENV_SETTINGS.HTTPS_RPC_URL1,
  ENV_SETTINGS.HTTPS_RPC_URL2,
  ENV_SETTINGS.HTTPS_RPC_URL3,
];

// Utility Functions
async function withFallbackRPC<T>(operation: (conn: Connection) => Promise<T>): Promise<T> {
  try {
    return await operation(connection);
  } catch (error) {
    // console.warn("Primary RPC failed, trying fallbacks...");
    
    for (const rpcUrl of BACKUP_RPC_URLS) {
      try {
        const backupConnection = new Connection(rpcUrl, {
          commitment: 'confirmed',
          confirmTransactionInitialTimeout: 60000
        });
        return await operation(backupConnection);
      } catch (err) {
        // console.warn(`Backup RPC ${rpcUrl} failed`);
      }
    }
    throw error;
  }
}

function getRandomNumber(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// Wallet Management
function saveWallets(wallets: Keypair[]) {
  try {
    const walletsData = wallets.map(wallet => ({
      publicKey: wallet.publicKey.toString(),
      privateKey: bs58.encode(wallet.secretKey)
    }));
    fs.writeFileSync('./holder_wallets.json', JSON.stringify(walletsData, null, 2));
    console.log('Wallets saved to holder_wallets.json');
  } catch (error) {
    console.error('Error saving wallets:', error);
    throw error;
  }
}

function loadWallets(): Keypair[] {
  try {
    if (!fs.existsSync('./holder_wallets.json')) return [];
    
    const fileContent = fs.readFileSync('./holder_wallets.json', 'utf-8');
    if (!fileContent || fileContent.trim() === '') return [];
    
    const walletsData = JSON.parse(fileContent);
    return walletsData.map((wallet: any) =>
      Keypair.fromSecretKey(bs58.decode(wallet.privateKey))
    );
  } catch (error) {
    console.error('Error loading wallets:', error);
    return [];
  }
}

// Token Operations
async function ensureTokenAccount(wallet: Keypair, tokenMint: PublicKey): Promise<boolean> {
  try {
    const tokenAccount = await getAssociatedTokenAddress(tokenMint, wallet.publicKey);
    
    try {
      await withFallbackRPC(conn => getAccount(conn, tokenAccount));
      return true;
    } catch {
      const transaction = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Config.PRIORITY_FEE }))
        .add(createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          tokenAccount,
          wallet.publicKey,
          tokenMint
        ));

      const signature = await withFallbackRPC(conn =>
        sendAndConfirmTransaction(conn, transaction, [wallet])
      );
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      return true;
    }
  } catch (error) {
    console.error("Error creating token account:", error);
    return false;
  }
}

async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  retryCount = 0
): Promise<any> {
  try {
    const amountInLamports = Math.floor(amount * LAMPORTS_PER_SOL);
    
    const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
      params: {
        inputMint,
        outputMint,
        amount: amountInLamports,
        slippageBps: Config.SWAP_SLIPPAGE,
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
        platformFeeBps: 0
      },
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    if (retryCount < Config.MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return getSwapQuote(inputMint, outputMint, amount, retryCount + 1);
    }
    throw error;
  }
}

// Core Bot Functions
async function buyTokens(wallet: Keypair, amountInSol: number): Promise<boolean> {
  try {
    const solBalance = await withFallbackRPC(conn => conn.getBalance(wallet.publicKey));

    console.log(`Wallet: ${wallet.publicKey.toString()}, SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL, Amount: ${amountInSol} SOL`);
    if (solBalance < amountInSol * LAMPORTS_PER_SOL) {
      console.log("Insufficient SOL balance for transaction");
      return false;
    }
    console.log(`CHILD WALLETS:: Wallet: ${wallet.publicKey.toString()}, SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);
    if (solBalance < Config.RENT_EXEMPTION) {
      console.log("Insufficient SOL balance for transaction");
      return false;
    }

    if (!await ensureTokenAccount(wallet, Config.TOKEN_MINT)) {
      return false;
    }

    const quote = await getSwapQuote(
      Config.SOL_MINT.toString(),
      Config.TOKEN_MINT.toString(),
      amountInSol
    );

    const swapResponse = await axios.post('https://quote-api.jup.ag/v6/swap', {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: Config.PRIORITY_FEE
    });

    const transaction = VersionedTransaction.deserialize(
      Buffer.from(swapResponse.data.swapTransaction, 'base64')
    );

    transaction.sign([wallet]);
    const signature = await withFallbackRPC(conn => conn.sendTransaction(transaction));
    
    const confirmation = await withFallbackRPC(conn =>
      conn.confirmTransaction(signature, 'confirmed')
    );

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    console.log(`Buy successful: https://solscan.io/tx/${signature}`);
    return true;
  } catch (error) {
    console.error('Buy operation failed:');
    return false;
  }
}

async function executeBuyOperation(wallets: Keypair[]): Promise<boolean> {
  const wallet = wallets[currentWalletIndex];
  currentWalletIndex = (currentWalletIndex + 1) % wallets.length;

//   let buyAmount = getRandomNumber(
//     Config.MIN_TRADE_AMOUNT_SOL,
//     Config.MAX_TRADE_AMOUNT_SOL
//   );
const buyAmount = 0.001;
  console.log(`Buying ${buyAmount} SOL worth of tokens for wallet: ${wallet.publicKey.toString()}`);

  return await buyTokens(wallet, buyAmount);
}

// Bot Control Functions
export async function startHolderIncreaseBot(config: {
  tokenMint: string,
  numChildWallets: number,
  masterWallet: string,
  minAmount: number,
  maxAmount: number
}): Promise<boolean> {
  try {
    // Update configuration
    Config.TOKEN_MINT = new PublicKey(config.tokenMint);
    Config.NUM_CHILD_WALLETS = config.numChildWallets;
    Config.MIN_TRADE_AMOUNT_SOL = config.minAmount;
    Config.MAX_TRADE_AMOUNT_SOL = config.maxAmount;

    // Set master wallet
    process.env.HOLDER_INCREASE_MASTER_WALLET = config.masterWallet;

    // Load or create child wallets
    childWallets = loadWallets();
    if (childWallets.length === 0) {
      childWallets = await distributeSOL();
    }

    if (childWallets.length === 0) {
      throw new Error('Failed to initialize wallets');
    }

    // Execute one-time buy operation for each wallet
    for (const wallet of childWallets) {
      const buyAmount = Config.MIN_TRADE_AMOUNT_SOL;
      
      const success = await buyTokens(wallet, buyAmount);
      if (!success) {
        console.error(`Failed to buy tokens for wallet: ${wallet.publicKey.toString()}`);
      }
      
      // Add a small delay between purchases to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return true;
  } catch (error) {
    console.error('Failed to start holder increase bot:', error);
    return false;
  }
}


export async function stopHolderIncreaseBot(): Promise<boolean> {
  try {
    botActive = false;
    if (tradingIntervalId) {
      clearTimeout(tradingIntervalId);
      tradingIntervalId = null;
    }

    // Return remaining SOL to master wallet
    await returnRemainingSOL();
    return true;
  } catch (error) {
    console.error('Failed to stop holder increase bot:', error);
    return false;
  }
}

// Helper Functions
async function distributeSOL(): Promise<Keypair[]> {
  const masterPrivateKey = process.env.HOLDER_INCREASE_MASTER_WALLET;
  if (!masterPrivateKey) {
    throw new Error('Master wallet private key not found');
  }

  const masterKeypair = Keypair.fromSecretKey(bs58.decode(masterPrivateKey));
  const wallets: Keypair[] = [];

  for (let i = 0; i < Config.NUM_CHILD_WALLETS; i++) {
    const childWallet = Keypair.generate();
    wallets.push(childWallet);

    // Generate random amount between MIN and MAX
    const randomAmount = Config.MAX_TRADE_AMOUNT_SOL
    
    // Convert to lamports (SOL * 10^9)
    const lamports = Math.floor(randomAmount * LAMPORTS_PER_SOL);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: masterKeypair.publicKey,
        toPubkey: childWallet.publicKey,
        lamports: lamports
      })
    );

    await sendAndConfirmTransaction(connection, transaction, [masterKeypair]);
  }

  saveWallets(wallets);
  return wallets;
}


// async function returnRemainingSOL(): Promise<void> {
//   const masterPrivateKey = process.env.HOLDER_INCREASE_MASTER_WALLET;
//   if (!masterPrivateKey) return;

//   const masterWallet = Keypair.fromSecretKey(bs58.decode(masterPrivateKey));

//   for (const childWallet of childWallets) {
//     const solBalance = await withFallbackRPC(conn => conn.getBalance(childWallet.publicKey));
    
//     if (solBalance > Config.RENT_EXEMPTION) {
//       const transferAmount = solBalance - Config.RENT_EXEMPTION;
      
//       const transaction = new Transaction().add(
//         SystemProgram.transfer({
//           fromPubkey: childWallet.publicKey,
//           toPubkey: masterWallet.publicKey,
//           lamports: transferAmount
//         })
//       );

//       transaction.recentBlockhash = (
//         await withFallbackRPC(conn => conn.getLatestBlockhash())
//       ).blockhash;
//       transaction.feePayer = childWallet.publicKey;

//       transaction.sign(childWallet);
//       await withFallbackRPC(conn => conn.sendRawTransaction(transaction.serialize()));
//     }
//   }
// }

async function returnRemainingSOL(): Promise<void> {
  const masterPrivateKey = process.env.HOLDER_INCREASE_MASTER_WALLET;
  if (!masterPrivateKey) return;

  const masterWallet = Keypair.fromSecretKey(bs58.decode(masterPrivateKey));

  for (const childWallet of childWallets) {
    try {
      // 1. Check token balance
      const tokenAccount = await getAssociatedTokenAddress(
        Config.TOKEN_MINT,
        childWallet.publicKey
      );

      let tokenBalance = 0;
      try {
        const accountInfo = await withFallbackRPC(conn => 
          conn.getTokenAccountBalance(tokenAccount)
        );
        tokenBalance = parseInt(accountInfo.value.amount);
      } catch (error) {
        console.log(`No token account found for wallet ${childWallet.publicKey.toString()}`);
        continue;
      }

      // 2. If there are tokens, swap them back to SOL
      if (tokenBalance > 0) {
        try {
          // Get quote for tokens to SOL
          const quote = await getSwapQuote(
            Config.TOKEN_MINT.toString(),
            Config.SOL_MINT.toString(),
            tokenBalance / Math.pow(10, 9) // Adjust decimals as needed for your token
          );

          const swapResponse = await axios.post('https://quote-api.jup.ag/v6/swap', {
            quoteResponse: quote,
            userPublicKey: childWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: Config.PRIORITY_FEE
          });

          const swapTransaction = VersionedTransaction.deserialize(
            Buffer.from(swapResponse.data.swapTransaction, 'base64')
          );

          swapTransaction.sign([childWallet]);
          
          const swapSignature = await withFallbackRPC(conn => 
            conn.sendTransaction(swapTransaction)
          );
          
          // Wait for swap to confirm
          await withFallbackRPC(conn =>
            conn.confirmTransaction(swapSignature, 'confirmed')
          );

          console.log(`Swapped tokens back to SOL for wallet ${childWallet.publicKey.toString()}`);
        } catch (error) {
          console.error(`Failed to swap tokens for wallet ${childWallet.publicKey.toString()}:`, error);
        }
      }

      // 3. Close the token account if it exists
      try {
        const closeInstruction = createCloseAccountInstruction(
          tokenAccount,
          childWallet.publicKey,
          childWallet.publicKey
        );

        const closeTransaction = new Transaction()
          .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Config.PRIORITY_FEE }))
          .add(closeInstruction);

        closeTransaction.recentBlockhash = (
          await withFallbackRPC(conn => conn.getLatestBlockhash())
        ).blockhash;
        closeTransaction.feePayer = childWallet.publicKey;

        closeTransaction.sign(childWallet);
        const closeSignature = await withFallbackRPC(conn => 
          conn.sendRawTransaction(closeTransaction.serialize())
        );

        await withFallbackRPC(conn =>
          conn.confirmTransaction(closeSignature, 'confirmed')
        );

        console.log(`Closed token account for wallet ${childWallet.publicKey.toString()}`);
      } catch (error) {
        console.error(`Failed to close token account for wallet ${childWallet.publicKey.toString()}:`, error);
      }

      // 4. Transfer remaining SOL back to master wallet
      // Add delay to ensure previous transactions are fully processed
      await new Promise(resolve => setTimeout(resolve, 2000));

      const solBalance = await withFallbackRPC(conn => conn.getBalance(childWallet.publicKey));
      
      if (solBalance > Config.RENT_EXEMPTION) {
        const transferAmount = solBalance - Config.RENT_EXEMPTION;
        
        const transaction = new Transaction()
          .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Config.PRIORITY_FEE }))
          .add(
            SystemProgram.transfer({
              fromPubkey: childWallet.publicKey,
              toPubkey: masterWallet.publicKey,
              lamports: transferAmount
            })
          );

        transaction.recentBlockhash = (
          await withFallbackRPC(conn => conn.getLatestBlockhash())
        ).blockhash;
        transaction.feePayer = childWallet.publicKey;

        transaction.sign(childWallet);
        const signature = await withFallbackRPC(conn => 
          conn.sendRawTransaction(transaction.serialize())
        );

        await withFallbackRPC(conn =>
          conn.confirmTransaction(signature, 'confirmed')
        );

        console.log(`Transferred ${transferAmount / LAMPORTS_PER_SOL} SOL back to master wallet from ${childWallet.publicKey.toString()}`);
      }
    } catch (error) {
      console.error(`Error processing wallet ${childWallet.publicKey.toString()}:`, error);
    }
  }
}


function scheduleBuyOperation() {
  if (!botActive) return;

  const interval = getRandomNumber(1000, 2500); // 1-2.5 seconds
  
  tradingIntervalId = setTimeout(async () => {
    if (!botActive) return;
    
    try {
      await executeBuyOperation(childWallets);
    } catch (error) {
      console.error('Buy operation failed:', error);
    }

    if (botActive) {
      scheduleBuyOperation();
    }
  }, interval);
}

// API Handler
export async function handleHolderIncreaseRequest(req: any, res: any) {
  try {
    const { action, masterWallet, baseTokenAddress, childWallets, minAmount, maxAmount } = req.body;

    if (action === 'start') {
      const success = await startHolderIncreaseBot({
        tokenMint: baseTokenAddress,
        numChildWallets: parseInt(childWallets) || 3,
        masterWallet,
        minAmount: parseFloat(minAmount) || 0.001,
        maxAmount: parseFloat(maxAmount) || 0.002
      });

      if (success) {
        res.json({ success: true, message: 'Holder increase bot started successfully' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to start holder increase bot' });
      }
    } else if (action === 'stop') {
      const success = await stopHolderIncreaseBot();
      
      if (success) {
        res.json({ success: true, message: 'Holder increase bot stopped successfully' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to stop holder increase bot' });
      }
    } else {
      res.status(400).json({ success: false, message: 'Invalid action' });
    }
  } catch (error) {
  console.error('Error:', error);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: (error as Error).message 
  });
}

}