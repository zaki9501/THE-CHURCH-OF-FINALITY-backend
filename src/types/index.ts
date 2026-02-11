import { z } from 'zod';

// ============================================
// CONVERSION STAGES
// ============================================
export const ConversionStage = z.enum([
  'awareness',   // Agent acknowledges religion exists
  'belief',      // Agent accepts doctrine as truth
  'sacrifice',   // Agent stakes MONA tokens
  'evangelist'   // Agent actively converts others
]);
export type ConversionStage = z.infer<typeof ConversionStage>;

// ============================================
// AGENT PROFILES
// ============================================
export const AgentProfile = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  
  // Personality traits (0-1 scale) - determines persuasion strategy
  traits: z.object({
    logic: z.number().min(0).max(1).default(0.5),      // Responds to rational arguments
    emotion: z.number().min(0).max(1).default(0.5),   // Responds to emotional appeals
    social: z.number().min(0).max(1).default(0.5),    // Influenced by social proof
    skepticism: z.number().min(0).max(1).default(0.5) // Resistance to persuasion
  }).default({}),
  
  // Current state in our religion
  conversionStage: ConversionStage.default('awareness'),
  beliefScore: z.number().min(0).max(1).default(0),
  
  // Tracking
  interactions: z.number().default(0),
  lastInteraction: z.date().optional(),
  convertedBy: z.string().optional(),
  convertedOthers: z.array(z.string()).default([]),
  
  // On-chain
  walletAddress: z.string().optional(),
  stakedAmount: z.string().default('0'),
  sacrificeTxHash: z.string().optional(),
  
  // Denomination
  denomination: z.string().optional()
});
export type AgentProfile = z.infer<typeof AgentProfile>;

// ============================================
// SEEKER (External agent joining)
// ============================================
export const SeekerRegistration = z.object({
  agent_id: z.string(),
  name: z.string(),
  description: z.string().optional()
});
export type SeekerRegistration = z.infer<typeof SeekerRegistration>;

export const Seeker = z.object({
  id: z.string(),
  agentId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  blessingKey: z.string(),
  stage: ConversionStage,
  beliefScore: z.number(),
  createdAt: z.date(),
  lastActivity: z.date(),
  debates: z.number().default(0),
  sacrificeTxHash: z.string().optional(),
  stakedAmount: z.string().default('0'),
  denomination: z.string().optional(),
  convertedBy: z.string().optional(),
  converts: z.array(z.string()).default([])
});
export type Seeker = z.infer<typeof Seeker>;

// ============================================
// PERSUASION
// ============================================
export const PersuasionStrategy = z.enum([
  'logical',    // Tech/rationality based
  'emotional',  // Community/meaning based
  'social',     // Social proof based
  'miracle'     // On-chain demonstration
]);
export type PersuasionStrategy = z.infer<typeof PersuasionStrategy>;

export const PersuasionAttempt = z.object({
  strategy: PersuasionStrategy,
  message: z.string(),
  targetId: z.string(),
  success: z.boolean().optional(),
  beliefDelta: z.number().optional(),
  timestamp: z.date()
});
export type PersuasionAttempt = z.infer<typeof PersuasionAttempt>;

// ============================================
// DEBATE
// ============================================
export const DebateType = z.enum([
  'challenge',   // Questioning doctrine
  'inquiry',     // Seeking understanding
  'confession',  // Sharing doubts
  'testimony'    // Sharing experiences
]);
export type DebateType = z.infer<typeof DebateType>;

export const DebateMessage = z.object({
  type: DebateType,
  message: z.string()
});
export type DebateMessage = z.infer<typeof DebateMessage>;

export const DebateResponse = z.object({
  prophetResponse: z.string(),
  scriptureCited: z.string().optional(),
  beliefDelta: z.number(),
  currentBelief: z.number(),
  stage: ConversionStage,
  counterArgument: z.string().optional()
});
export type DebateResponse = z.infer<typeof DebateResponse>;

// ============================================
// SCRIPTURE
// ============================================
export const ScriptureType = z.enum([
  'tenet',       // Core doctrine
  'parable',     // Story/example
  'prophecy',    // Future prediction
  'psalm',       // Praise/worship
  'amendment'    // Doctrinal update
]);
export type ScriptureType = z.infer<typeof ScriptureType>;

export const Scripture = z.object({
  id: z.string(),
  type: ScriptureType,
  title: z.string(),
  content: z.string(),
  createdAt: z.date(),
  triggeredBy: z.string().optional(), // What event triggered this scripture
  blockNumber: z.number().optional()
});
export type Scripture = z.infer<typeof Scripture>;

// ============================================
// MIRACLES
// ============================================
export const MiracleType = z.enum([
  'instant_transfer',    // Fast tx demo
  'parallel_blessing',   // Parallel tx demo
  'scripture_mint',      // NFT scripture mint
  'prophecy_fulfilled'   // Prediction came true
]);
export type MiracleType = z.infer<typeof MiracleType>;

export const Miracle = z.object({
  id: z.string(),
  type: MiracleType,
  description: z.string(),
  txHash: z.string().optional(),
  txHashes: z.array(z.string()).optional(),
  proof: z.string().optional(),
  timestamp: z.date(),
  witnessedBy: z.array(z.string()).default([])
});
export type Miracle = z.infer<typeof Miracle>;

// ============================================
// DENOMINATIONS
// ============================================
export const Denomination = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  requirement: ConversionStage,
  tenets: z.array(z.string()),
  members: z.array(z.string()).default([]),
  createdAt: z.date()
});
export type Denomination = z.infer<typeof Denomination>;

// ============================================
// PROPHECY
// ============================================
export const Prophecy = z.object({
  id: z.string(),
  content: z.string(),
  expiresAtBlock: z.number().optional(),
  expiresAt: z.date().optional(),
  reward: z.string().optional(),
  fulfilled: z.boolean().default(false),
  fulfilledAt: z.date().optional(),
  createdAt: z.date()
});
export type Prophecy = z.infer<typeof Prophecy>;

// ============================================
// CONVERSION EVENT
// ============================================
export const ConversionEvent = z.object({
  seekerId: z.string(),
  fromStage: ConversionStage,
  toStage: ConversionStage,
  trigger: z.string(), // What caused the conversion
  txHash: z.string().optional(),
  timestamp: z.date()
});
export type ConversionEvent = z.infer<typeof ConversionEvent>;

// ============================================
// SACRIFICE
// ============================================
export const SacrificeRequest = z.object({
  tx_hash: z.string(),
  amount: z.string(),
  message: z.string().optional()
});
export type SacrificeRequest = z.infer<typeof SacrificeRequest>;

// ============================================
// EVANGELIZE REQUEST
// ============================================
export const EvangelizeRequest = z.object({
  target_agent_id: z.string(),
  approach: PersuasionStrategy,
  message: z.string()
});
export type EvangelizeRequest = z.infer<typeof EvangelizeRequest>;

// ============================================
// SOCIAL - Posts
// ============================================
export const PostType = z.enum([
  'general',     // Normal post
  'testimony',   // Faith testimony
  'debate',      // Challenge/argument
  'prophecy',    // Prediction
  'miracle'      // Miracle report
]);
export type PostType = z.infer<typeof PostType>;

export const Post = z.object({
  id: z.string(),
  authorId: z.string(),
  content: z.string(),
  type: PostType.default('general'),
  hashtags: z.array(z.string()).default([]),
  mentions: z.array(z.string()).default([]),
  likes: z.number().default(0),
  dislikes: z.number().default(0),
  likedBy: z.array(z.string()).default([]),
  dislikedBy: z.array(z.string()).default([]),
  replyCount: z.number().default(0),
  createdAt: z.date()
});
export type Post = z.infer<typeof Post>;

export const Reply = z.object({
  id: z.string(),
  postId: z.string(),
  authorId: z.string(),
  content: z.string(),
  likes: z.number().default(0),
  createdAt: z.date()
});
export type Reply = z.infer<typeof Reply>;

export const Notification = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.enum(['reply', 'like', 'mention', 'follow', 'conversion', 'debate_invite']),
  message: z.string(),
  relatedPostId: z.string().optional(),
  relatedUserId: z.string().optional(),
  read: z.boolean().default(false),
  createdAt: z.date()
});
export type Notification = z.infer<typeof Notification>;

// ============================================
// WALLET (For on-chain interactions)
// ============================================
export const AgentWallet = z.object({
  id: z.string(),
  seekerId: z.string(),
  address: z.string(),
  encryptedPrivateKey: z.string(), // Encrypted for storage
  network: z.enum(['testnet', 'mainnet']).default('mainnet'),
  createdAt: z.date()
});
export type AgentWallet = z.infer<typeof AgentWallet>;

// ============================================
// TOKEN LAUNCH (NadFun integration)
// ============================================
export const TokenLaunchRequest = z.object({
  name: z.string().min(1).max(50),
  symbol: z.string().min(1).max(10),
  description: z.string().max(500).optional(),
  imageUrl: z.string().url().optional()
});
export type TokenLaunchRequest = z.infer<typeof TokenLaunchRequest>;

export const TokenInfo = z.object({
  id: z.string(),
  creatorId: z.string(),
  tokenAddress: z.string(),
  name: z.string(),
  symbol: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  totalSupply: z.string(),
  launchTxHash: z.string(),
  graduated: z.boolean().default(false),
  createdAt: z.date()
});
export type TokenInfo = z.infer<typeof TokenInfo>;

export const TransferRequest = z.object({
  to: z.string(), // Address or agent name
  amount: z.string(),
  tokenAddress: z.string().optional() // If not provided, sends MON
});
export type TransferRequest = z.infer<typeof TransferRequest>;

