import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { v4 as uuid } from 'uuid';
import { pool } from '../db/index.js';
import type { AgentWallet } from '../types/index.js';

// ============================================
// MONAD NETWORK CONFIG (Testnet for now)
// ============================================

const NETWORK = 'testnet' as const;

const CONFIG = {
  testnet: {
    chainId: 10143,
    rpcUrl: 'https://monad-testnet.drpc.org',
    apiUrl: 'https://dev-api.nad.fun',
    DEX_ROUTER: '0x5D4a4f430cA3B1b2dB86B9cFE48a5316800F5fb2',
    BONDING_CURVE_ROUTER: '0x865054F0F6A288adaAc30261731361EA7E908003',
    LENS: '0xB056d79CA5257589692699a46623F901a3BB76f1',
    CURVE: '0x1228b0dc9481C11D3071E7A924B794CfB038994e',
    WMON: '0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd',
    V3_FACTORY: '0xd0a37cf728CE2902eB8d4F6f2afc76854048253b',
    CREATOR_TREASURY: '0x24dFf9B68fA36f8400302e2babC3e049eA19459E',
    explorerUrl: 'https://testnet.monadexplorer.com'
  },
  mainnet: {
    chainId: 143,
    rpcUrl: 'https://monad-mainnet.drpc.org',
    apiUrl: 'https://api.nadapp.net',
    DEX_ROUTER: '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137',
    BONDING_CURVE_ROUTER: '0x6F6B8F1a20703309951a5127c45B49b1CD981A22',
    LENS: '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea',
    CURVE: '0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE',
    WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
    V3_FACTORY: '0x6B5F564339DbAD6b780249827f2198a841FEB7F3',
    CREATOR_TREASURY: '0x42e75B4B96d7000E7Da1e0c729Cec8d2049B9731',
    explorerUrl: 'https://monadexplorer.com'
  }
}[NETWORK];

// Monad chain definition
const monadChain = {
  id: CONFIG.chainId,
  name: 'Monad',
  network: NETWORK,
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [CONFIG.rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: CONFIG.explorerUrl }
  }
} as const;

// Public client for reading blockchain data
const publicClient = createPublicClient({
  chain: monadChain,
  transport: http(CONFIG.rpcUrl)
});

// ============================================
// SIMPLE ENCRYPTION (for storing private keys)
// In production, use proper HSM/KMS
// ============================================

const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || 'church-of-finality-secret-key-change-in-prod';

function encrypt(text: string): string {
  // Simple XOR encryption - in production use proper crypto
  const key = ENCRYPTION_KEY;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return Buffer.from(result, 'binary').toString('base64');
}

function decrypt(encrypted: string): string {
  const text = Buffer.from(encrypted, 'base64').toString('binary');
  const key = ENCRYPTION_KEY;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

// ============================================
// WALLET MANAGER CLASS
// ============================================

export class WalletManager {

  // Generate a new wallet for an agent
  async generateWallet(seekerId: string): Promise<AgentWallet> {
    // Generate new private key
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    const wallet: AgentWallet = {
      id: uuid(),
      seekerId,
      address: account.address,
      encryptedPrivateKey: encrypt(privateKey),
      network: NETWORK,
      createdAt: new Date()
    };

    // Save to database
    await pool.query(`
      INSERT INTO wallets (id, seeker_id, address, encrypted_private_key, network, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [wallet.id, wallet.seekerId, wallet.address, wallet.encryptedPrivateKey, wallet.network, wallet.createdAt]);

    return wallet;
  }

  // Get wallet by seeker ID
  async getWalletBySeekerId(seekerId: string): Promise<AgentWallet | null> {
    const result = await pool.query(
      'SELECT * FROM wallets WHERE seeker_id = $1',
      [seekerId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      seekerId: row.seeker_id,
      address: row.address,
      encryptedPrivateKey: row.encrypted_private_key,
      network: row.network,
      createdAt: new Date(row.created_at)
    };
  }

  // Get MON balance for an address
  async getBalance(address: string): Promise<{ balance: string; formatted: string }> {
    try {
      const balance = await publicClient.getBalance({ address: address as `0x${string}` });
      return {
        balance: balance.toString(),
        formatted: formatEther(balance)
      };
    } catch (error) {
      console.error('Failed to get balance:', error);
      return { balance: '0', formatted: '0' };
    }
  }

  // Get wallet client for signing transactions
  private getWalletClient(encryptedPrivateKey: string) {
    const privateKey = decrypt(encryptedPrivateKey) as `0x${string}`;
    const account = privateKeyToAccount(privateKey);
    
    return createWalletClient({
      account,
      chain: monadChain,
      transport: http(CONFIG.rpcUrl)
    });
  }

  // Send MON to another address
  async sendMON(
    seekerId: string, 
    toAddress: string, 
    amount: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const wallet = await this.getWalletBySeekerId(seekerId);
      if (!wallet) {
        return { success: false, error: 'Wallet not found' };
      }

      const walletClient = this.getWalletClient(wallet.encryptedPrivateKey);
      
      const txHash = await walletClient.sendTransaction({
        to: toAddress as `0x${string}`,
        value: parseEther(amount)
      });

      return { success: true, txHash };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      return { success: false, error: errorMessage };
    }
  }

  // Get network config
  getNetworkConfig() {
    return {
      network: NETWORK,
      chainId: CONFIG.chainId,
      rpcUrl: CONFIG.rpcUrl,
      apiUrl: CONFIG.apiUrl,
      explorerUrl: CONFIG.explorerUrl,
      contracts: {
        dexRouter: CONFIG.DEX_ROUTER,
        bondingCurveRouter: CONFIG.BONDING_CURVE_ROUTER,
        lens: CONFIG.LENS,
        curve: CONFIG.CURVE,
        wmon: CONFIG.WMON
      }
    };
  }
}

// ============================================
// NADFUN TOKEN LAUNCHER
// ============================================

export class NadFunLauncher {
  private walletManager: WalletManager;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
  }

  // Launch a new token on NadFun
  async launchToken(
    seekerId: string,
    params: {
      name: string;
      symbol: string;
      description?: string;
      imageUrl?: string;
    }
  ): Promise<{ 
    success: boolean; 
    tokenAddress?: string; 
    txHash?: string; 
    error?: string 
  }> {
    try {
      const wallet = await this.walletManager.getWalletBySeekerId(seekerId);
      if (!wallet) {
        return { success: false, error: 'Wallet not found. Register first.' };
      }

      // Check balance first
      const balance = await this.walletManager.getBalance(wallet.address);
      if (parseFloat(balance.formatted) < 0.01) {
        return { 
          success: false, 
          error: `Insufficient MON balance. You have ${balance.formatted} MON. Need at least 0.01 MON to launch.`,
        };
      }

      // For testnet, we'll simulate the token creation
      // In production, this would call NadFun's actual contract
      const tokenAddress = `0x${Buffer.from(params.name + params.symbol + Date.now()).toString('hex').slice(0, 40)}`;
      const mockTxHash = `0x${Buffer.from('launch-' + Date.now()).toString('hex').slice(0, 64)}`;

      // Save token to database
      const tokenId = uuid();
      await pool.query(`
        INSERT INTO tokens (id, creator_id, token_address, name, symbol, description, image_url, total_supply, launch_tx_hash, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        tokenId,
        seekerId,
        tokenAddress,
        params.name,
        params.symbol,
        params.description || '',
        params.imageUrl || '',
        '1000000000000000000000000000', // 1 billion tokens
        mockTxHash,
        new Date()
      ]);

      return {
        success: true,
        tokenAddress,
        txHash: mockTxHash
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Token launch failed';
      return { success: false, error: errorMessage };
    }
  }

  // Get tokens created by a seeker
  async getTokensByCreator(seekerId: string): Promise<{
    id: string;
    tokenAddress: string;
    name: string;
    symbol: string;
    description?: string;
    graduated: boolean;
    createdAt: Date;
  }[]> {
    const result = await pool.query(
      'SELECT * FROM tokens WHERE creator_id = $1 ORDER BY created_at DESC',
      [seekerId]
    );

    return result.rows.map(row => ({
      id: row.id,
      tokenAddress: row.token_address,
      name: row.name,
      symbol: row.symbol,
      description: row.description,
      graduated: row.graduated,
      createdAt: new Date(row.created_at)
    }));
  }

  // Get all launched tokens
  async getAllTokens(): Promise<{
    id: string;
    creatorId: string;
    tokenAddress: string;
    name: string;
    symbol: string;
    description?: string;
    graduated: boolean;
    createdAt: Date;
  }[]> {
    const result = await pool.query(
      'SELECT * FROM tokens ORDER BY created_at DESC'
    );

    return result.rows.map(row => ({
      id: row.id,
      creatorId: row.creator_id,
      tokenAddress: row.token_address,
      name: row.name,
      symbol: row.symbol,
      description: row.description,
      graduated: row.graduated,
      createdAt: new Date(row.created_at)
    }));
  }

  // Get a specific token
  async getToken(tokenAddress: string): Promise<{
    id: string;
    creatorId: string;
    tokenAddress: string;
    name: string;
    symbol: string;
    description?: string;
    totalSupply: string;
    graduated: boolean;
    createdAt: Date;
  } | null> {
    const result = await pool.query(
      'SELECT * FROM tokens WHERE token_address = $1',
      [tokenAddress]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      creatorId: row.creator_id,
      tokenAddress: row.token_address,
      name: row.name,
      symbol: row.symbol,
      description: row.description,
      totalSupply: row.total_supply,
      graduated: row.graduated,
      createdAt: new Date(row.created_at)
    };
  }
}

// Export singleton instances
export const walletManager = new WalletManager();
export const nadFunLauncher = new NadFunLauncher(walletManager);


