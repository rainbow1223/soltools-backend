import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ENV_SETTINGS,
  FEE_SETTINGS,
  META_SETTINGS,
  METADATA_PROGRAM_ID,
  newRaydiumTokenModel,
} from "../../config";
import {
  AccountMeta,
  AccountMetaReadonly,
  SYSTEM_PROGRAM_ID,
} from "@raydium-io/raydium-sdk";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToCheckedInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType as SetAuthorityType,
} from "@solana/spl-token";

import {
  createCreateMetadataAccountV3Instruction,
  createUpdateMetadataAccountInstruction,
  createUpdateMetadataAccountV2Instruction,
} from "@metaplex-foundation/mpl-token-metadata";

const httpsConnectionForMint = new Connection(
  ENV_SETTINGS.HTTPS_RPC_URL3,
  "confirmed"
);
const metaPlex = new PublicKey(METADATA_PROGRAM_ID);
const mintDestinationFeeId = new PublicKey(FEE_SETTINGS.feeDetinationWallet);
async function uploadMetaData(tokenInfo: any) {
  let metaDataForToken: any = {};
  let extensions: any = {};

  metaDataForToken.name = tokenInfo.tokenName;
  metaDataForToken.symbol = tokenInfo.symbol;
  metaDataForToken.description = tokenInfo.description;
  metaDataForToken.image = tokenInfo.image;
  // metaDataForToken.createdOn = "slerf.tools"


  if (tokenInfo.twitter.length > 0) {
    metaDataForToken.twitter = tokenInfo.twitter;
    extensions.twitter = tokenInfo.twitter
  }
  if (tokenInfo.website.length > 0) {
    metaDataForToken.website = tokenInfo.website;
    extensions.website = tokenInfo.website
  }
  if (tokenInfo.telegram.length > 0) {
    metaDataForToken.telegram = tokenInfo.telegram;
    extensions.telegram = tokenInfo.telegram
  }

  metaDataForToken.extensions = extensions;


  // metaDataForToken.image= tokenInfo.image;

  //   name: ,
  //   symbol: tokenInfo.symbol,
  //   description: tokenInfo.description,
  //   image: tokenInfo.image,
  //   // extensions: {
  //   twitter: tokenInfo.twitter,
  //   telegram: tokenInfo.telegram,
  //   website: tokenInfo.website,
  //   discord: tokenInfo.discord,
  // }
  // };
  console.log("Uploading metaData...");
  const options = {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${META_SETTINGS.PINATA_JWT_TOKEN}`,
    },
    body: JSON.stringify({
      pinataContent: metaDataForToken,
      // pinataOptions: { cidVersion: 1 },
      pinataMetadata: { name: `${tokenInfo.symbol}.json` },
    }),
  };
  try {
    const response = await fetch(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      options
    );
    const res = await response.json();
    console.log(`Metadata uploaded to IPFS: ${res.IpfsHash}`);
    const url = `https://ipfs.io/ipfs/${res.IpfsHash}`;
    return url;
  } catch (error: any) {
    console.error(`Error uploading metadata to IPFS: ${error.message}`);
    console.log(error);
    return ``;
  }
}

async function createSPLTokenMetaDataInstruction(
  tokenInfo: any,
  devWallet: Keypair,
  mint: PublicKey,
  revokeMeta: boolean,
  pinataUsageFlag: boolean,
  ipfsURL: string
) {
  const reverseRevokeMeta = revokeMeta ? false : true;
  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      Buffer.from(metaPlex.toBuffer()),
      Buffer.from(mint.toBuffer()),
    ],
    metaPlex
  );
  /*Create raw data for mint*/
  const metaURL = pinataUsageFlag ? await uploadMetaData(tokenInfo) : ipfsURL;
  const metaplexInst = createCreateMetadataAccountV3Instruction(
    {
      metadata: metadata,
      mint: mint,
      mintAuthority: devWallet.publicKey,
      payer: devWallet.publicKey,
      updateAuthority: devWallet.publicKey,
    },
    {
      createMetadataAccountArgsV3: {
        data: {
          name: tokenInfo.tokenName,
          symbol: tokenInfo.symbol,
          uri: metaURL,
          sellerFeeBasisPoints: 0,
          creators: null,
          collection: null,
          uses: null,
        },
        isMutable: reverseRevokeMeta,
        collectionDetails: null,
      },
    }
  );
  return metaplexInst;
}

export async function mintSPLToken(
  tokenInfo: any,
  devWallet: Keypair,
  totalSupply: bigint,
  revokeMeta: boolean, // if true, can't update metadata, else possible
  revokeFreeze: boolean, // if true, freeze auth is null, else devWallet
  revokeMint: boolean, // if true, mint auth is null, else devwallet
  pinataUsageFlag: boolean,
  ipfsURL: string
) {
  /*Generate mint*/
  const mintKeyPair = Keypair.generate();
  const devATA = getAssociatedTokenAddressSync(
    mintKeyPair.publicKey,
    devWallet.publicKey
  );
  const lamportsForRent = await getMinimumBalanceForRentExemptMint(
    httpsConnectionForMint
  );
  const metaPlexCreateInst = await createSPLTokenMetaDataInstruction(
    tokenInfo,
    devWallet,
    mintKeyPair.publicKey,
    revokeMeta,
    pinataUsageFlag,
    ipfsURL
  );
  /*Make Instruction*/
  const freezeAuthPk = revokeFreeze ? null : devWallet.publicKey;
  let mintInstructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 90000 }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: ENV_SETTINGS.COMPUTE_PRICE,
    }),
    SystemProgram.createAccount({
      fromPubkey: devWallet.publicKey,
      newAccountPubkey: mintKeyPair.publicKey,
      space: MINT_SIZE,
      lamports: lamportsForRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeyPair.publicKey,
      6,
      devWallet.publicKey, // Mint Authority
      freezeAuthPk
    ),
    createAssociatedTokenAccountInstruction(
      devWallet.publicKey,
      devATA,
      devWallet.publicKey,
      mintKeyPair.publicKey
    ),
    createMintToCheckedInstruction(
      mintKeyPair.publicKey,
      devATA,
      devWallet.publicKey, // mint Authority
      BigInt(Math.pow(10, 6)) * totalSupply,
      6
    ),
    // ...metaPlexCreateInst.instructions
    metaPlexCreateInst,
  ];
  if (revokeMint) {
    mintInstructions.push(
      createSetAuthorityInstruction(
        mintKeyPair.publicKey,
        devWallet.publicKey,
        SetAuthorityType.MintTokens,
        null
      )
    );
  }
  //Add Service Fee Instruction
  // const currentSolPrice = globalThis.solPriceByUSDC;
  // const fee =
  //   Math.floor((FEE_SETTINGS.mintFee * Math.pow(10, 9)) / currentSolPrice) + 1;
  // mintInstructions.push(
  //   SystemProgram.transfer({
  //     fromPubkey: devWallet.publicKey,
  //     toPubkey: mintDestinationFeeId,
  //     lamports: fee
  //   })
  // );
  console.log("send mint transaction", mintKeyPair.publicKey.toString());
  /*Get recent Blockhash*/
  let blockHash = await httpsConnectionForMint.getLatestBlockhash();
  /*Compile to version 0 msg*/
  const newMintTxMsg = new TransactionMessage({
    payerKey: devWallet.publicKey,
    recentBlockhash: blockHash.blockhash,
    instructions: mintInstructions,
  }).compileToV0Message();
  const versionedNewMsg = new VersionedTransaction(newMintTxMsg);
  /*Sign, Send tx*/
  versionedNewMsg.sign([mintKeyPair, devWallet]);
  const mintRes = await httpsConnectionForMint.sendRawTransaction(
    versionedNewMsg.serialize(),
    { skipPreflight: false }
  );
  /*Confirmation Tx*/
  const confirmation = await httpsConnectionForMint.confirmTransaction(
    {
      signature: mintRes,
      lastValidBlockHeight: blockHash.lastValidBlockHeight,
      blockhash: blockHash.blockhash,
    },
    "confirmed"
  );
  console.log(
    "-------------------------------------------------------------------------------------"
  );
  console.log(`Mint Tx of ${mintKeyPair.publicKey.toString()}  ${mintRes}`);
  console.log(
    "-------------------------------------------------------------------------------------"
  );
  if (confirmation.value.err) {
    console.log("tx failed", confirmation.value.err);
    return null;
  } else {
    /*Insert to MongoDB*/
    // const newToken = new newRaydiumTokenModel({
    //   token: mintKeyPair.publicKey.toString(),
    //   owner: devWallet.publicKey.toString(),
    //   isliquidity: false,
    // });
    // await newToken.save();
    // console.log("Token saved to MongoDB:", newToken);
    console.log("mintKeyPair.publicKey:", mintKeyPair.publicKey.toString());
    return mintKeyPair.publicKey.toString();
  }
}

async function updateMetaDataOfToken(
  httpsConnection: Connection,
  mintOwner: Keypair,
  mint: PublicKey,
  tokenInfo: any
) {
  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      Buffer.from(metaPlex.toBuffer()),
      Buffer.from(mint.toBuffer()),
    ],
    metaPlex
  );
  const metaURL = await uploadMetaData(tokenInfo);
  let ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 90000 }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: ENV_SETTINGS.COMPUTE_PRICE,
    }),
  ];
  ixs.push(
    createUpdateMetadataAccountV2Instruction(
      {
        metadata: metadata,
        updateAuthority: mintOwner.publicKey,
      },
      {
        updateMetadataAccountArgsV2: {
          data: {
            name: tokenInfo.tokenName,
            symbol: tokenInfo.symbol,
            uri: metaURL,
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
          },
          updateAuthority: mintOwner.publicKey,
          primarySaleHappened: null,
          isMutable: true,
        },
      }
    )
  );
  let blockHash = await httpsConnection.getLatestBlockhash();
  const updateMsg = new TransactionMessage({
    payerKey: mintOwner.publicKey,
    recentBlockhash: blockHash.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const versionedUpdate = new VersionedTransaction(updateMsg);
  versionedUpdate.sign([mintOwner]);
  const res = await httpsConnection.sendRawTransaction(
    versionedUpdate.serialize(),
    { skipPreflight: false }
  );
  console.log(res);
}
