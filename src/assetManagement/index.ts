import {
  createBurnInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction
} from "@solana/web3.js";
import { ENV_SETTINGS, SOL_ADDRESS } from "../../config";
import { sendTransactionWithV0 } from "../transaction";

const httpsConnection = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL2,
  "confirmed"
);
export async function burnAllBaseTokens(devWallet: Keypair) {
  const tokenList = (
    await httpsConnection.getParsedTokenAccountsByOwner(
      devWallet.publicKey,
      {
        programId: TOKEN_PROGRAM_ID
      },
      "confirmed"
    )
  ).value;
  let ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: ENV_SETTINGS.COMPUTE_PRICE
    })
  ];
  for (let token of tokenList) {
    // console.log(token.pubkey);
    const parsedAccountInfo = token.account.data;
    if (parsedAccountInfo) {
      const mintAddress: string = parsedAccountInfo["parsed"]["info"]["mint"];
      const decimal: number =
        parsedAccountInfo["parsed"]["info"]["tokenAmount"]["decimals"];
      const tokenBalance: bigint = BigInt(
        parsedAccountInfo["parsed"]["info"]["tokenAmount"]["amount"]
      );
      const mint = new PublicKey(mintAddress);
      if (mintAddress === SOL_ADDRESS) {
        ixs.push(
          createCloseAccountInstruction(
            token.pubkey,
            devWallet.publicKey,
            devWallet.publicKey,
            []
          )
        );
      } else {
        if (tokenBalance > BigInt(0)) {
          ixs.push(
            createBurnInstruction(
              token.pubkey,
              mint,
              devWallet.publicKey,
              tokenBalance
            )
          );
        }
        ixs.push(
          createCloseAccountInstruction(
            token.pubkey,
            devWallet.publicKey,
            devWallet.publicKey,
            []
          )
        );
      }
    }
  }
  if (tokenList.length > 0) {
    console.log("burn all token");
    const res = await sendTransactionWithV0(
      httpsConnection,
      ixs,
      [],
      devWallet
    );
    return res;
  } else {
    console.log("There is no token");
    return null;
  }
}
