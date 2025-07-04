import {
  SPL_ACCOUNT_LAYOUT,
  TOKEN_PROGRAM_ID,
  TokenAccount
} from "@raydium-io/raydium-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export function sleep(s: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.floor(s * 1000)));
}

export function bufferFromString(value: string) {
  const buffer = Buffer.alloc(4 + value.length);
  buffer.writeUInt32LE(value.length, 0);
  buffer.write(value, 4);
  return buffer;
}

export function bufferFromUInt64(value: number | string) {
  let buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

export function readStringPrivateKey(key: string) {
  return Keypair.fromSecretKey(bs58.decode(key));
}

export async function getWalletTokenAccount(
  connection: Connection,
  baseATA: PublicKey,
  quoteATA: PublicKey
): Promise<TokenAccount[]> {
  const [baseATAInfo, quoteATAInfo] = await connection.getMultipleAccountsInfo([
    baseATA,
    quoteATA
  ]);
  console.log(baseATAInfo, quoteATAInfo);
  if (baseATAInfo && quoteATAInfo) {
    console.log("get token accounts");
    return [
      {
        accountInfo: SPL_ACCOUNT_LAYOUT.decode(baseATAInfo.data),
        programId: TOKEN_PROGRAM_ID,
        pubkey: baseATA
      },
      {
        accountInfo: SPL_ACCOUNT_LAYOUT.decode(quoteATAInfo.data),
        programId: TOKEN_PROGRAM_ID,
        pubkey: quoteATA
      }
    ];
  } else {
    return [];
  }
}
