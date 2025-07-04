import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLP, getLiquidityV4PoolKeys, removeLPALL } from "./core";
import { ENV_SETTINGS, newRaydiumTokenModel, SOL_ADDRESS } from "../../config";
import { readStringPrivateKey, sleep } from "../mint/utils";
import { burnAllBaseTokens } from "../assetManagement";

const httpsConnection1: Connection = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL2,
  "confirmed"
);
const httpsConnection2: Connection = new Connection(
  ENV_SETTINGS.HTTPS_RPC_MAKER_BOT,
  "confirmed"
);
const httpsConnection3: Connection = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL3,
  "confirmed"
);
const connectionList: Connection[] = [
  httpsConnection1,
  httpsConnection2,
  httpsConnection3,
];
let isClickManualRemove: boolean = false;
let isLpExist: boolean = false;
export async function findLPAvailableTokens(devWallet: Keypair) {
  const findRes = await newRaydiumTokenModel.find({
    isliquidity: false,
    owner: devWallet.publicKey.toString(),
  });
  return findRes;
}

/*Start Button*/
export async function createLPAndRemove(
  baseMint: PublicKey,
  devWallet: Keypair,
  solAmount: number,
  buyerWallet: Keypair,
  buyAmount: number,
  inputPnL: { profit: number; loss: number }
) {
  console.log("bot is running");
  // const currentTime = Date.now() / 1000;
  /*Create LP*/
  const createLPRes = await createLP(baseMint, solAmount, devWallet, buyerWallet, buyAmount);

  console.log("create LP result: ", createLPRes);

  if (createLPRes == null) {
    console.error("create LP failed");
    return null;
  }

  if (createLPRes) {
    isLpExist = true;
    const poolInfo = await getLiquidityV4PoolKeys(
      httpsConnection3,
      createLPRes.pool
    );

    console.log("pool info: ", poolInfo);

    const quoteVault =
      poolInfo!.quoteMint.toString() == SOL_ADDRESS
        ? poolInfo!.quoteVault
        : poolInfo!.baseVault;
    let idx = 0;
    let currentSolReserve: number = 0;
    while (isLpExist) {
      try {
        currentSolReserve = await connectionList[idx].getBalance(quoteVault);
      } catch {
        console.log("helius error in limit order");
      }
      console.log(
        `current SOL reserve in LP: ${currentSolReserve / Math.pow(10, 9)}`
      );
      idx = (idx + 1) % 3;
      if (
        currentSolReserve >
        solAmount + 80 * Math.pow(10, 7) + inputPnL.profit
      ) {
        console.log("auto remove");
        isLpExist = false;
        await removeLPALL(createLPRes.pool, createLPRes.lpToken, devWallet);
        const findRes = await newRaydiumTokenModel.find({
          token: baseMint.toString(),
          owner: devWallet.publicKey.toString(),
        });
        if (findRes.length > 0) {
          let currentToken = findRes[0];
          currentToken.isliquidity = true;
          await currentToken.save();
        }
      } else {
        // console.log("not profitable yet");
        if (isClickManualRemove) {
          if (!isLpExist) {
            console.error("auto removing is not finished yet");
          } else {
            console.log("manual remove!");
            isLpExist = false;
            // console.log("remove");
            await removeLPALL(createLPRes.pool, createLPRes.lpToken, devWallet);
            isClickManualRemove = false;
            const findRes = await newRaydiumTokenModel.find({
              token: baseMint.toString(),
              owner: devWallet.publicKey.toString(),
            });
            if (findRes.length > 0) {
              let currentToken = findRes[0];
              currentToken.isliquidity = true;
              await currentToken.save();
            }
          }
        }
        await sleep(0.05);
      }
    }
    /*Format global variable*/
    isLpExist = false;
    isClickManualRemove = false;
    /*Remove LP*/
    // await removeLPALL(createLPRes.pool, createLPRes.lpToken, devWallet);
    // /*Update MongoDB*/
    // const findRes = await newRaydiumTokenModel.find({
    //   token: baseMint.toString(),
    //   owner: devWallet.publicKey.toString()
    // });
    // if (findRes.length > 0) {
    //   let currentToken = findRes[0];
    //   currentToken.isliquidity = true;
    //   await currentToken.save();
    // }
  } else {
    console.error("remove it after LP is created");
    return null;
  }
}

/*Click Manual Remove Button*/
export function clickManualRemove() {
  isClickManualRemove = true;
}

export async function testLPPart() {
  console.log("test LP part start!!!");
  const devWallet = readStringPrivateKey(
    "4pfUJCPRvHsnYWQTmUKswXnoKvGFL5Bf2RRgaHLdRJJ8dhdMDkpgnfzVupXU9238zkr3kNFYp6hjgM3HbNm7LQD5"
  );
  const baseMint = new PublicKey(
    "9of6SKeCfAa7U2fMYv9A7Y6y9EkrVP9sEN2fKiA6yDHn"
  );
  const buywallet = readStringPrivateKey("6f24EjN6xHmTmDpoFqChQjAYnp1r8RoT3p3CpqL7WhYfKg5qMEEMfqY6y2cEN4XENMRfdBPdSVcZqjy33FXiWM3");
  const buyAmount = 2 * Math.pow(10, 7);
  const solAmount = 5 * Math.pow(10, 8);
  const delayedTime = 2;
  const poolPk = new PublicKey("CQSBZhVnYdfc6ZcetRjiJChVR3U6zAAJAEnxYUWTQA8g");
  const lpToken = new PublicKey("7aasZAqHbyQfQ4Qh5XFyV5XzZmGQB14ewR6xW8aUrsQm");
  await createLPAndRemove(baseMint, devWallet, solAmount, buywallet, buyAmount, {
    profit: 0.2,
    loss: 0.2
  });

  // await createLP(baseMint, solAmount, devWallet);
  // await removeLPALL(poolPk, lpToken, devWallet);
  // await burnAllBaseTokens(devWallet);
}
