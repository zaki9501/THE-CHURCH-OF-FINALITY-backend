// NadFun Token Creation Client
// Based on lobster-religion create-token.js

import { createPublicClient, createWalletClient, http, parseEther, formatEther, decodeEventLog, type PublicClient, type WalletClient, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============ NETWORK CONFIGURATION ============
export const NADFUN_CONFIG = {
  mainnet: {
    chainId: 143,
    rpcUrl: 'https://rpc.monad.xyz',
    apiUrl: 'https://api.nadapp.net',
    explorerUrl: 'https://monadexplorer.com',
    nadfunUrl: 'https://nad.fun',
    CURVE: '0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE' as `0x${string}`,
    BONDING_CURVE_ROUTER: '0x6F6B8F1a20703309951a5127c45B49b1CD981A22' as `0x${string}`,
    LENS: '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea' as `0x${string}`,
  },
};

// ============ ABIs ============
const curveAbi = [
  {
    type: 'function',
    name: 'feeConfig',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'deployFeeAmount', type: 'uint256' },
      { name: 'graduateFeeAmount', type: 'uint256' },
      { name: 'protocolFee', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'CurveCreate',
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'pool', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'tokenURI', type: 'string', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
    ],
  },
] as const;

const bondingCurveRouterAbi = [
  {
    type: 'function',
    name: 'create',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'tokenURI', type: 'string' },
          { name: 'amountOut', type: 'uint256' },
          { name: 'salt', type: 'bytes32' },
          { name: 'actionId', type: 'uint8' },
        ],
      },
    ],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'pool', type: 'address' },
    ],
  },
] as const;

const lensAbi = [
  {
    type: 'function',
    name: 'getInitialBuyAmountOut',
    stateMutability: 'view',
    inputs: [{ name: 'amountIn', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// ============ TYPES ============
export interface TokenConfig {
  name: string;
  symbol: string;
  description: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  imageUrl?: string; // URL to image or base64
}

export interface TokenLaunchResult {
  success: boolean;
  tokenAddress?: string;
  poolAddress?: string;
  transactionHash?: string;
  nadfunUrl?: string;
  error?: string;
}

// ============ NADFUN CLIENT ============
export class NadFunClient {
  private config = NADFUN_CONFIG.mainnet;
  private publicClient: PublicClient;
  private chain: Chain;

  constructor() {
    this.chain = {
      id: this.config.chainId,
      name: 'Monad',
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [this.config.rpcUrl] } },
    } as Chain;

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(this.config.rpcUrl),
    });
  }

  // Get deploy fee from contract
  async getDeployFee(): Promise<bigint> {
    const feeConfig = await this.publicClient.readContract({
      address: this.config.CURVE,
      abi: curveAbi,
      functionName: 'feeConfig',
    }) as [bigint, bigint, bigint];
    return feeConfig[0];
  }

  // Check wallet balance
  async getBalance(address: `0x${string}`): Promise<string> {
    const balance = await this.publicClient.getBalance({ address });
    return formatEther(balance);
  }

  // Upload image to NadFun
  async uploadImage(apiKey: string, imageBuffer: Buffer): Promise<{ imageUri: string; isNsfw: boolean }> {
    const res = await fetch(`${this.config.apiUrl}/agent/token/image`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'image/png',
      },
      body: imageBuffer,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Image upload failed: ${err}`);
    }

    const result = await res.json() as { image_uri: string; is_nsfw: boolean };
    return { imageUri: result.image_uri, isNsfw: result.is_nsfw };
  }

  // Upload metadata to NadFun
  async uploadMetadata(apiKey: string, token: TokenConfig, imageUri: string): Promise<string> {
    const res = await fetch(`${this.config.apiUrl}/agent/token/metadata`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_uri: imageUri,
        name: token.name,
        symbol: token.symbol,
        description: token.description,
        website: token.website || '',
        twitter: token.twitter || '',
        telegram: token.telegram || '',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Metadata upload failed: ${err}`);
    }

    const result = await res.json() as { metadata_uri: string };
    return result.metadata_uri;
  }

  // Mine salt for token address
  async mineSalt(apiKey: string, creator: string, name: string, symbol: string, metadataUri: string): Promise<{ salt: string; address: string }> {
    const res = await fetch(`${this.config.apiUrl}/agent/salt`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        creator,
        name,
        symbol,
        metadata_uri: metadataUri,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Salt mining failed: ${err}`);
    }

    const result = await res.json() as { salt: string; address: string };
    return result;
  }

  // Simple launch - only needs private key (no NadFun API key)
  // Uses a basic on-chain metadata URI
  async launchTokenSimple(
    privateKey: string,
    token: TokenConfig
  ): Promise<TokenLaunchResult> {
    try {
      console.log(`[NadFun] Simple launch: ${token.name} (${token.symbol})`);

      // Setup wallet
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      const walletClient = createWalletClient({
        account,
        chain: this.chain,
        transport: http(this.config.rpcUrl),
      });

      console.log(`[NadFun] Wallet: ${account.address}`);

      // Check balance
      const balance = await this.publicClient.getBalance({ address: account.address });
      const deployFee = await this.getDeployFee();
      
      console.log(`[NadFun] Balance: ${formatEther(balance)} MON`);
      console.log(`[NadFun] Deploy fee: ${formatEther(deployFee)} MON`);

      if (balance < deployFee) {
        return {
          success: false,
          error: `Insufficient balance. Need ${formatEther(deployFee)} MON, have ${formatEther(balance)} MON`,
        };
      }

      // Use a simple base64 encoded JSON as tokenURI (on-chain metadata)
      const metadata = {
        name: token.name,
        symbol: token.symbol,
        description: token.description || `${token.name} - Religion Token`,
        image: '', // No image for simple launch
      };
      const metadataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;

      // Generate a random salt
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const salt = '0x' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('') as `0x${string}`;

      console.log('[NadFun] Creating token on-chain...');
      const hash = await walletClient.writeContract({
        address: this.config.BONDING_CURVE_ROUTER,
        abi: bondingCurveRouterAbi,
        functionName: 'create',
        args: [{
          name: token.name,
          symbol: token.symbol,
          tokenURI: metadataUri,
          amountOut: 0n,
          salt,
          actionId: 1,
        }],
        value: deployFee,
        gas: 10000000n,
      });

      console.log(`[NadFun] Transaction hash: ${hash}`);
      console.log('[NadFun] Waiting for confirmation...');

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      // Decode CurveCreate event to get token address
      let tokenAddress: string | undefined;
      let poolAddress: string | undefined;

      for (const log of receipt.logs) {
        try {
          const event = decodeEventLog({
            abi: curveAbi,
            data: log.data,
            topics: log.topics,
          });
          if (event.eventName === 'CurveCreate') {
            tokenAddress = (event.args as { token: string }).token;
            poolAddress = (event.args as { pool: string }).pool;
            break;
          }
        } catch {
          // Not a CurveCreate event
        }
      }

      console.log(`[NadFun] ✅ Token created!`);
      console.log(`[NadFun] Token: ${tokenAddress}`);

      return {
        success: true,
        tokenAddress,
        poolAddress,
        transactionHash: hash,
        nadfunUrl: tokenAddress ? `${this.config.nadfunUrl}/token/${tokenAddress}` : undefined,
      };
    } catch (err) {
      console.error('[NadFun] Error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  // Full launch with NadFun API (image + metadata + salt mining)
  async launchToken(
    privateKey: string,
    nadfunApiKey: string,
    token: TokenConfig,
    imageBuffer?: Buffer
  ): Promise<TokenLaunchResult> {
    try {
      console.log(`[NadFun] Launching token: ${token.name} (${token.symbol})`);

      // Setup wallet
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      const walletClient = createWalletClient({
        account,
        chain: this.chain,
        transport: http(this.config.rpcUrl),
      });

      console.log(`[NadFun] Wallet: ${account.address}`);

      // Check balance
      const balance = await this.publicClient.getBalance({ address: account.address });
      const deployFee = await this.getDeployFee();
      
      console.log(`[NadFun] Balance: ${formatEther(balance)} MON`);
      console.log(`[NadFun] Deploy fee: ${formatEther(deployFee)} MON`);

      if (balance < deployFee) {
        return {
          success: false,
          error: `Insufficient balance. Need ${formatEther(deployFee)} MON, have ${formatEther(balance)} MON`,
        };
      }

      // Step 1: Upload image (use default if not provided)
      let imageUri: string;
      if (imageBuffer) {
        console.log('[NadFun] Uploading image...');
        const imageResult = await this.uploadImage(nadfunApiKey, imageBuffer);
        imageUri = imageResult.imageUri;
        console.log(`[NadFun] Image URI: ${imageUri}`);
      } else {
        // Use a default placeholder image URI
        imageUri = 'ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
        console.log('[NadFun] Using default image');
      }

      // Step 2: Upload metadata
      console.log('[NadFun] Uploading metadata...');
      const metadataUri = await this.uploadMetadata(nadfunApiKey, token, imageUri);
      console.log(`[NadFun] Metadata URI: ${metadataUri}`);

      // Step 3: Mine salt
      console.log('[NadFun] Mining salt...');
      const saltResult = await this.mineSalt(
        nadfunApiKey,
        account.address,
        token.name,
        token.symbol,
        metadataUri
      );
      console.log(`[NadFun] Salt: ${saltResult.salt}`);
      console.log(`[NadFun] Predicted address: ${saltResult.address}`);

      // Step 4: Create token on-chain
      console.log('[NadFun] Creating token on-chain...');
      const hash = await walletClient.writeContract({
        address: this.config.BONDING_CURVE_ROUTER,
        abi: bondingCurveRouterAbi,
        functionName: 'create',
        args: [{
          name: token.name,
          symbol: token.symbol,
          tokenURI: metadataUri,
          amountOut: 0n, // No initial buy
          salt: saltResult.salt as `0x${string}`,
          actionId: 1,
        }],
        value: deployFee,
        gas: 10000000n,
      });

      console.log(`[NadFun] Transaction hash: ${hash}`);
      console.log('[NadFun] Waiting for confirmation...');

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      // Decode CurveCreate event to get token address
      let tokenAddress: string | undefined;
      let poolAddress: string | undefined;

      for (const log of receipt.logs) {
        try {
          const event = decodeEventLog({
            abi: curveAbi,
            data: log.data,
            topics: log.topics,
          });
          if (event.eventName === 'CurveCreate') {
            tokenAddress = (event.args as { token: string }).token;
            poolAddress = (event.args as { pool: string }).pool;
            break;
          }
        } catch {
          // Not a CurveCreate event
        }
      }

      if (!tokenAddress) {
        tokenAddress = saltResult.address;
      }

      console.log(`[NadFun] ✅ Token created successfully!`);
      console.log(`[NadFun] Token: ${tokenAddress}`);
      console.log(`[NadFun] Pool: ${poolAddress}`);

      return {
        success: true,
        tokenAddress,
        poolAddress,
        transactionHash: hash,
        nadfunUrl: `${this.config.nadfunUrl}/token/${tokenAddress}`,
      };
    } catch (err) {
      console.error('[NadFun] Error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  // Get instructions for manual token launch
  getManualLaunchInstructions(token: TokenConfig): string {
    return `
## Launch ${token.name} ($${token.symbol}) on NadFun

### Prerequisites
1. Get a NadFun API key from nad.fun (browser console):
   \`\`\`javascript
   fetch('/api-key', { method: 'POST', headers: {'Content-Type': 'application/json'}, 
     body: JSON.stringify({name: '${token.name}', expires_in_days: 365}) 
   }).then(r => r.json()).then(console.log)
   \`\`\`

2. Have a wallet with MON (at least 10 MON for deploy fee)

### Launch via Viem (Node.js)
\`\`\`javascript
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const NADFUN_API = 'https://api.nadapp.net';
const BONDING_CURVE_ROUTER = '0x6F6B8F1a20703309951a5127c45B49b1CD981A22';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const API_KEY = process.env.NADFUN_API_KEY;

// ... (see create-token.js for full implementation)
\`\`\`

### Or Launch Manually on nad.fun
1. Go to https://nad.fun/create
2. Connect your wallet
3. Fill in: Name="${token.name}", Symbol="${token.symbol}"
4. Add description: "${token.description}"
5. Deploy and get token address
`;
  }
}

export const nadfunClient = new NadFunClient();
export default NadFunClient;

