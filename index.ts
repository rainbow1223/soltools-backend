import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
// import { SYSTEM_PROGRAM_ID } from "@raydium-io/raydium-sdk";
import { mintSPLToken } from "./src/mint";
import { connectDB, ENV_SETTINGS } from "./config";
import { readStringPrivateKey } from "./src/mint/utils";
import { testLPPart } from "./src/liquidity/index";
import { startVolumeBot, stopVolumeBot } from './src/volumebot/index';
import { startHolderIncreaseBot, stopHolderIncreaseBot } from './src/holderIncrease/index';
// import { testMarket } from "./src/liquidity/core";
import { clickManualRemove, createLPAndRemove } from "./src/liquidity/index";
import {
  limitOrderCpmm,
  clickManualRemoveCpmm,
  testCpmmPart,
  testLimitOrderCpmm,
  RemoveLPOnly,
} from "./src/cpmm/limitOrder";
import { removeLPALL } from "./src/liquidity/core";
import { testBurnToken } from "./src/liquidity/checkQuote";
import { WashFund } from "./src/washfund/index";
import { spliteGeneratedWallets } from "./src/washfund/batchWalletGeneration";
import { testSwap } from "./src/MarketMaker/index";
import { Connection } from "@solana/web3.js";
import Manager from 'solana-crypto-toolkit';

// import { Keypair } from "@solana/web3.js";
const app = express();
const PORT = 3001;
app.use(
  bodyParser.json(),
  cors({
    origin: "*",
  })
);

let storeAddr: string | null = null;


connectDB();

app.post("/import", async (req: any, res: any) => {
  const { addr }: { addr: string } = req.body;

  storeAddr = addr;

  // Validate the address
  if (!addr) {
    return res
      .status(400)
      .json({ success: false, message: "Address is required." });
  }
  try {
    console.log("pk is ", addr);
    console.log("Imported Wallet address:", readStringPrivateKey(addr).publicKey.toString());

    const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=dbe0a25f-683a-499b-97fa-1d9b2fce3ba6', 'processed');
    const manager = new Manager(connection);
    manager.initSdkV1(addr, [])

    res.status(200).json({
      success: true,
      message: `Imported Wallet address is ${readStringPrivateKey(addr).publicKey
        }`,
      walletAddress: readStringPrivateKey(addr).publicKey,
    });
  } catch (error) {
    console.error("Invalid Private Key!~")
    return res.status(400).json({ success: false, message: "Invalid Private Key!" })
  }
  // console.log("Received pr key:", addr);
});

app.post("/mint", async (req: any, res: any) => {
  const {
    tokenInfo,
    pinataUsageFlag,
    ipfsURL,
    revokeMeta,
    freeAuth,
    revokeMint,
    tokenSupply,
  }: any = req.body;

  // Validate tokenInfo structure
  if (!tokenInfo || typeof tokenInfo !== "object") {
    return res
      .status(400)
      .json({ success: false, message: "Token information is required." });
  }

  // Ensure the private key is available
  if (!storeAddr) {
    return res
      .status(400)
      .json({ success: false, message: "Private key is not imported." });
  }

  console.log("token Info:", tokenInfo);
  console.log("tsuuuppp", tokenSupply);
  console.log("free auth", freeAuth);
  console.log("revoke mint: ", revokeMint);
  console.log("Token Supply: ", tokenSupply);

  // const userKey = new PublicKey(pubKeyString);
  // Create the wallet using the stored private key
  const totalSupply = BigInt(tokenSupply);
  const devWallet = readStringPrivateKey(storeAddr);
  try {
    const mintResult = await mintSPLToken(
      tokenInfo,
      devWallet,
      totalSupply,
      revokeMeta,
      freeAuth,
      revokeMint,
      pinataUsageFlag,
      ipfsURL
    );
    res.status(200).json({ success: true, mintResult });
  } catch (error) {
    console.error("Error minting token:", error);
    res.status(500).json({ success: false, error });
  }
});

app.post("/buyToken", async (req: any, res: any) => {
  const { address, volumeMin, volumeMax, volumeId }: any = req.body;
  res.status(200).json({ success: true, result: { address: address, volumeMin: volumeMin, volumeMax: volumeMax, volumeId: volumeId } })
});

app.post("/lpbots", async (req: any, res: any) => {
  const { address, lpSolAmount, profit, loss, baseTokenAmo }: any = req.body;

  console.log("received address", address);

  if (globalThis.registeredAddrs.has(address)) {
    return res.status(400).json({ success: false, message: "Already created" });
  }
  const lpAmountLamport = Math.floor(lpSolAmount * Math.pow(10, 9));
  const profitLamport =
    Math.floor((profit * Math.pow(10, 9))) + 1;
  const lossLamport =
    Math.floor((loss * Math.pow(10, 9))) + 1;
  const baseMint = new PublicKey(address);
  console.log(
    `LP sol amount: ${lpAmountLamport}, profit : ${profitLamport}, loss: ${lossLamport}, baseTokenAmo: ${baseTokenAmo}`
  );

  if (!storeAddr) {
    return res
      .status(400)
      .json({ success: false, message: "Private key is not imported." });
  }

  const devWallet = readStringPrivateKey(storeAddr);

  //Input Actual code Below is just sample
  const buyerWallet = readStringPrivateKey(storeAddr);
  const buyAmount = 10;

  try {
    await createLPAndRemove(baseMint, devWallet, lpAmountLamport, buyerWallet, buyAmount, {
      profit: profitLamport,
      loss: lossLamport,
    });
    globalThis.registeredAddrs.add(address);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("error", error);
    return res.status(500).json({ success: false, error });
  }
});

app.post("/lp-remove-manual", async (req: any, res: any) => {
  const { result } = req.body;

  console.log("result from remove manually", result);

  try {
    if (result === "true") {
      clickManualRemoveCpmm();
      return res
        .status(200)
        .json({ message: "Manual remove triggered successfully!" });
    } else {
      return res.status(400).json({ message: "Invalid request" });
    }
  } catch (error) {
    console.error("Error during manual remove:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

app.post("/remove-lp-only", async (req: any, res: any) => {
  const { baseTokenAddress, poolAddress } = req.body;

  console.log("Inputed BaseTokne Address: ", baseTokenAddress);
  console.log("Inputed Pool Address: ", poolAddress);

  if (!storeAddr) {
    return res
      .status(400)
      .json({ success: false, message: "Private key is not imported." });
  }

  const devWallet = readStringPrivateKey(storeAddr);
  const baseMint = new PublicKey(baseTokenAddress);
  const poolAddr = new PublicKey(poolAddress);

  try {
    await RemoveLPOnly(devWallet, baseMint, poolAddr);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("error", error);
    return res.status(500).json({ success: false, error });
  }
});

app.post("/wash-funds", async (req: any, res: any) => {
  const { firstBatchs, secondBatchs, senderWalletPk, targetWalletAddr } =
    req.body;

  // console.log(`sendAmount: ${sendAmount}`);
  console.log(`senderWallet Pk: ${senderWalletPk}`);
  console.log(
    `sender wallet address ${readStringPrivateKey(senderWalletPk).publicKey}`
  );
  console.log(`target wallet address: ${targetWalletAddr}`);
  console.log(`First batch wallets: ${firstBatchs}`);
  console.log(`Second batch wallets: ${secondBatchs}`);

  const sendWallet = readStringPrivateKey(senderWalletPk);
  const targetWallet = new PublicKey(targetWalletAddr);
  // const sendAmountLamp = Math.floor(sendAmount * Math.pow(10, 9));

  try {
    await WashFund(firstBatchs, secondBatchs, sendWallet, targetWallet);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("error", error);
    return res.status(500).json({ success: false, error });
  }
});

app.post("/generate-wallet", async (req: any, res: any) => {
  const { numberOfWallets } = req.body;

  console.log("number of generated wallets", numberOfWallets);

  try {
    const batchwallets = spliteGeneratedWallets(numberOfWallets);
    return res.status(200).json({
      firstBatchs: batchwallets.firstBatchs,
      secondBatchs: batchwallets.secondBatchs,
    });
  } catch (error) {
    console.error("error", error);
    return res.status(500).json({ success: false, error });
  }
});

let volumeBotRunning = false;

app.post("/volumebot", async (req: any, res: any) => {
  const { volumeMasterWallet, targetVolumeAddr, volumeChildWallets, distributeAmo, volumeMin, volumeMax, action } = req.body;

  console.log(`Volume Bot Request: ${action}`);
  console.log(`Target Token: ${targetVolumeAddr}`);
  console.log(`Child Wallets: ${volumeChildWallets}`);
  console.log(`Min Volume: ${volumeMin} SOL, Max Volume: ${volumeMax} SOL`);

  const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=dbe0a25f-683a-499b-97fa-1d9b2fce3ba6', 'processed');
  const manager = new Manager(connection);
  manager.initSdkV1(volumeMasterWallet, [])

  try {
    if (action === 'start') {
      if (volumeBotRunning) {
        return res.status(400).json({ success: false, message: "Volume bot is already running" });
      }

      // Store the master wallet key securely

      console.log("Private Key", volumeMasterWallet);
      process.env.VOLUME_BOT_MASTER_WALLET = volumeMasterWallet;

      // Update the bot configuration
      await startVolumeBot({
        tokenMint: targetVolumeAddr,
        numChildWallets: parseInt(volumeChildWallets),
        distributeAmount: parseFloat(distributeAmo),
        minTradeAmount: parseFloat(volumeMin),
        maxTradeAmount: parseFloat(volumeMax)
      });

      volumeBotRunning = true;
      return res.status(200).json({ success: true, message: "Volume bot started successfully" });
    }
    else if (action === 'stop') {
      if (!volumeBotRunning) {
        return res.status(400).json({ success: false, message: "Volume bot is not running" });
      }

      await stopVolumeBot();
      volumeBotRunning = false;
      return res.status(200).json({ success: true, message: "Volume bot stopped successfully" });
    }
    else {
      return res.status(400).json({ success: false, message: "Invalid action" });
    }
  } catch (error) {
    console.error("Error managing volume bot:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
})

let holderBotRunning = false;
app.post("/holderbot", async (req: any, res: any) => {
  const {
    masterWallet,
    baseTokenAddress,
    childWallets,
    minAmount,
    maxAmount,
    action
  } = req.body;

  const tokenMint = baseTokenAddress;
  const numChildWallets = childWallets;
  console.log(`Holder Bot Request: ${action}`);
  console.log(`Target Token: ${tokenMint}`);
  console.log(`Number of Child Wallets: ${numChildWallets}`);
  console.log(`Min Amount: ${minAmount}, Max Amount: ${maxAmount}`);

  try {
    if (action === 'start') {
      if (holderBotRunning) {
        return res.status(400).json({
          success: false,
          message: "Holder bot is already running"
        });
      }

      // Store the master wallet key securely
      process.env.HOLDER_BOT_MASTER_WALLET = masterWallet;

      // Start the holder bot with configuration
      await startHolderIncreaseBot({
        tokenMint,
        numChildWallets: parseInt(numChildWallets),
        masterWallet,
        minAmount: parseFloat(minAmount),
        maxAmount: parseFloat(maxAmount)
      });

      holderBotRunning = true;
      return res.status(200).json({
        success: true,
        message: "Holder bot started successfully"
      });
    }
    else if (action === 'stop') {
      if (!holderBotRunning) {
        return res.status(400).json({
          success: false,
          message: "Holder bot is not running"
        });
      }

      await stopHolderIncreaseBot();
      holderBotRunning = false;
      return res.status(200).json({
        success: true,
        message: "Holder bot stopped successfully"
      });
    }
    else {
      return res.status(400).json({
        success: false,
        message: "Invalid action"
      });
    }
  } catch (error) {
    console.error("Error managing holder bot:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

app.get("/mints", (req: any, res: any) => {
  if (!storeAddr) {
    return res
      .status(400)
      .json({ success: false, message: "mints not available" });
  }

  res.status(200).json({ success: true, mints: storeAddr });
});

// Start the server and execute the main function
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
