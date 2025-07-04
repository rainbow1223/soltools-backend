import { Connection, PublicKey } from "@solana/web3.js";
import { ENV_SETTINGS } from "../../config";

const wssConnection: Connection = new Connection(ENV_SETTINGS.HTTPS_RPC_URL2, {
  wsEndpoint: ENV_SETTINGS.WSS_RPC_URL2,
  commitment: "confirmed"
});

const httpsConnection1: Connection = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL2,
  "confirmed"
);
const httpsConnection2: Connection = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL,
  "confirmed"
);

async function getLogs(target: PublicKey) {
  const id = await wssConnection.onLogs(
    target,
    (logs, context) => console.log(logs),
    "confirmed"
  );
}
async function trackLiquidity(
  quoteVault: PublicKey,
  initSOLReserve: number,
  inputPnL: { profit: number; loss: number }
) {
  const connectionList: Connection[] = [httpsConnection1, httpsConnection2];
  let idx = 0;
  let currentReserveSol: number = 0;
  while (true) {
    currentReserveSol = await connectionList[idx].getBalance(quoteVault);
    idx = (idx + 1) % 2;
    if (
      currentReserveSol >
        initSOLReserve + 75 * Math.pow(10, 7) + inputPnL.profit ||
      currentReserveSol < initSOLReserve + 75 * Math.pow(10, 7) - inputPnL.loss
    ) {
      console.log("remove LP automatically");
    }
  }
}
