import {
  Connection,
  Keypair,
  Signer,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import base58 from "bs58";

import {
  SearcherClient,
  searcherClient as jitoSearcherClient,
} from "jito-ts/dist/sdk/block-engine/searcher";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types";
import { BLOCK_ENGINE_URL, ENV_SETTINGS } from "../config";
import { PublicKey } from "@solana/web3.js";

const FROM_JITO_PRIVATE_KEY = base58.decode(ENV_SETTINGS.JITO_PRIVATE_KEY);
const jitoKeypair = Keypair.fromSecretKey(FROM_JITO_PRIVATE_KEY);
const BLOCK_ENGINE_URLS = BLOCK_ENGINE_URL;

export async function sendTransactionWithV0(
  connection: Connection,
  ixs: TransactionInstruction[],
  ixsSigners: Signer[],
  feePayer: Keypair
) {
  const blockHash = await connection.getLatestBlockhash();
  const newMsg = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: blockHash.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const versionedMsg = new VersionedTransaction(newMsg);
  versionedMsg.sign([feePayer, ...ixsSigners]);
  const res = await connection.sendRawTransaction(versionedMsg.serialize(), {
    skipPreflight: true,
  });

  console.log("Transaction sent:", res);

  const confirmRes = await connection.confirmTransaction({
    signature: res,
    lastValidBlockHeight: blockHash.lastValidBlockHeight,
    blockhash: blockHash.blockhash,
  });

  return confirmRes;
}

export const searcherClients = BLOCK_ENGINE_URLS.map((url) => {
  console.log("Jito URL:", url);
  return jitoSearcherClient(url, jitoKeypair, {
    "grpc.keepalive_timeout_ms": 5000,
  });
});

export async function sendTxWithBundle(
  clientNumber: number,
  bundledTxns: VersionedTransaction[],
) {
  try {
    const bundle = new Bundle(bundledTxns, bundledTxns.length);
    console.log("bundle tx length:", bundledTxns.length);
    console.log("bundle tx:", bundle);
    const bundleId = await searcherClients[clientNumber].sendBundle(bundle);
    console.log(`BundleID ${bundleId} sent.`);
    return bundleId;
  } catch (error) {
    console.error("Error sending bundle:", error);
    return null;
  }
}

export async function sendTxUsingJitoEndpoint(
  serializedTxs: string[]
): Promise<string> {
  let endpoint = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

  let payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [serializedTxs],
  };

  let res = await fetch(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });

  let json = await res.json();
  console.log("json: ", json);
  if (json.error) {
    console.log(json.error);
    throw new Error(json.error.message);
  }

  // return bundle ID
  return json.result;
}

export async function getBundleStatuesEndpoint(bundleId: string) {
  let endpoint = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

  let payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getBundleStatuses",
    params: [[bundleId]],
  };

  let res = await fetch(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });

  let json = await res.json();
  console.log("json in get Bundle: ", json);

  if (json.error) {
    console.log(json.error);
    throw new Error(json.error.message);
  }

  return json;
}
