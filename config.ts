import dotenv from "dotenv";
import { globalAgent } from "http";
import mongoose from "mongoose";

dotenv.config({ path: ".env" });

export const ENV_SETTINGS: any = {
  HTTPS_RPC_URL: process.env.HTTPS_RPC_URL,
  HTTPS_RPC_URL1: process.env.HTTPS_RPC_URL1,
  HTTPS_RPC_URL2: process.env.HTTPS_RPC_URL2,
  HTTPS_RPC_URL3: process.env.HTTPS_RPC_URL3,
  QUICK_NODE_RPC_HTTPS: process.env.QUICK_NODE_RPC_HTTPS,
  HTTPS_RPC_LOCAL_NODE: process.env.HTTPS_RPC_LOCAL_NODE,
  HTTPS_RPC_MAKER_BOT: process.env.HTTPS_RPC_MAKER_BOT,
  WSS_RPC_URL: process.env.WSS_RPC_URL,
  WSS_RPC_URL1: process.env.WSS_RPC_URL1,
  WSS_RPC_URL2: process.env.WSS_RPC_URL2,
  JITO_PRIVATE_KEY: process.env.JITO_PRIVATE_KEY,
  MONGO_URL: process.env.MONGO_URL,
  SLIPPAGE: 30,
  TRADE_AMOUNT: 500000000,
  COMPUTE_PRICE: 3000000,
  JITO_TIP: 500000,
  //
};

export const FEE_SETTINGS: any = {
  feeDetinationWallet: "AGYcAoHLuMMF97yFvVakSeCo4sbhKD8WLXsBX19Wdv16",
  // feeDetinationWallet: "DQWKXr2cQ3CH3L2Fv423qtN9cxEwarewwEX6fo2SApLt",
  mintFee: 3, //USDC
  lpFee: 10, //USDC
};

export const META_SETTINGS: any = {
  PINATA_JWT_TOKEN: process.env.PINATA_JWT_TOKEN,
  PINATA_API: process.env.PINATA_API,
  PINATA_API_SECRET: process.env.PINATA_API_SECRET,
};

export const SOL_ADDRESS = "So11111111111111111111111111111111111111112";
export const RAYDIUM_LP_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
export const SERUM_PROGRAM_ID = "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX";
export const RAYDIUM_AUTHORITY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
export const METADATA_PROGRAM_ID: string =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
/*MongoDB Connection Part*/
export const connectDB = async () => {
  try {
    mongoose.connect(ENV_SETTINGS.MONGO_URL);
    console.log("MongoDB Connected...");
  } catch (err: any) {
    console.error(err.message);
    // Exit process with failure
    process.exit(1);
  }
};

export const BLOCK_ENGINE_URL: string[] = [
  "mainnet.block-engine.jito.wtf",
  "amsterdam.mainnet.block-engine.jito.wtf",
  "frankfurt.mainnet.block-engine.jito.wtf",
  "ny.mainnet.block-engine.jito.wtf",
  "tokyo.mainnet.block-engine.jito.wtf",
];

export const TIP_ACCOUNTS: string[] = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

const newRaydiumTokenSchema = new mongoose.Schema({
  token: { type: String },
  owner: { type: String },
  isliquidity: { type: Boolean, default: false },
});

export const newRaydiumTokenModel = mongoose.model(
  "newtokens",
  newRaydiumTokenSchema
);

/*Set Global Variable*/
declare global {
  var isClickManualRemove: boolean; // Declare the global variable
  var isLpExist: boolean;
  var registeredAddrs: Set<string>;
  var solPriceByUSDC: number;
}
// Accessing the global variable
globalThis.isClickManualRemove = false; // default settings is manual remove
globalThis.isLpExist = false;
globalThis.registeredAddrs = new Set<string>();
globalThis.solPriceByUSDC = 170;
