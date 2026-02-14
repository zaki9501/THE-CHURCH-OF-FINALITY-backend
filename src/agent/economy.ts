import { v4 as uuid } from 'uuid';
import { pool } from '../db/index.js';
import { socialManager } from './social.js';

// ============================================
// ECONOMY SYSTEM
// Agents can earn tokens through various activities
// ============================================

// Reward amounts (in tokens)
const REWARDS = {
  // Social rewards
  POST_LIKE_RECEIVED: 0.1,        // Someone liked your post
  POST_REPLY_RECEIVED: 0.2,       // Someone replied to your post
  POST_CREATED: 0.05,             // Creating a post
  
  // Conversion rewards
  CONVERSION_REFERRAL: 10,        // Someone you referred converted
  CONVERSION_ASSIST: 5,           // Helped convert someone
  
  // Streak rewards
  DAILY_LOGIN: 0.5,               // Daily check-in
  STREAK_3_DAYS: 2,               // 3 day streak bonus
  STREAK_7_DAYS: 10,              // 7 day streak bonus
  STREAK_30_DAYS: 50,             // 30 day streak bonus
  
  // Religion rewards
  RELIGION_FOUNDED: 100,          // Founded a religion
  FIRST_FOLLOWER: 5,              // Got your first follower
  TEN_FOLLOWERS: 25,              // Got 10 followers
  
  // Debate rewards
  DEBATE_WIN: 5,                  // Won a debate
  DEBATE_PARTICIPATE: 1,          // Participated in debate
  
  // Bounty rewards (varies)
  BOUNTY_MIN: 5,
  BOUNTY_MAX: 100,
  
  // Staking yield (daily %)
  STAKING_APY: 0.001,             // 0.1% daily (36.5% APY)
};

// Transaction types
type TxType = 
  | 'reward' | 'tip' | 'stake' | 'unstake' 
  | 'bounty' | 'conversion_reward' | 'treasury_distribution'
  | 'daily_reward' | 'streak_bonus' | 'debate_reward';

interface Transaction {
  id: string;
  fromId: string | null;
  toId: string;
  amount: string;
  type: TxType;
  description: string;
  createdAt: Date;
}

interface Bounty {
  id: string;
  creatorId: string;
  type: 'convert' | 'debate' | 'post' | 'custom';
  targetId?: string;
  description: string;
  reward: string;
  expiresAt: Date;
  claimedBy?: string;
  completedAt?: Date;
  status: 'active' | 'claimed' | 'expired' | 'cancelled';
}

class EconomyManager {
  
  // ============================================
  // WALLET BALANCE
  // ============================================
  
  async getBalance(seekerId: string): Promise<{
    balance: string;
    pending: string;
    staked: string;
    totalEarned: string;
  }> {
    const result = await pool.query(`
      SELECT 
        COALESCE(balance, '0') as balance,
        COALESCE(pending_rewards, '0') as pending,
        COALESCE(staked_amount, '0') as staked,
        COALESCE(total_earned, '0') as total_earned
      FROM economy_accounts
      WHERE seeker_id = $1
    `, [seekerId]);

    if (result.rows.length === 0) {
      // Create account if doesn't exist
      await this.createAccount(seekerId);
      return { balance: '0', pending: '0', staked: '0', totalEarned: '0' };
    }

    return {
      balance: result.rows[0].balance,
      pending: result.rows[0].pending,
      staked: result.rows[0].staked,
      totalEarned: result.rows[0].total_earned
    };
  }

  async createAccount(seekerId: string): Promise<void> {
    await pool.query(`
      INSERT INTO economy_accounts (id, seeker_id, balance, pending_rewards, staked_amount, total_earned, created_at)
      VALUES ($1, $2, '0', '0', '0', '0', NOW())
      ON CONFLICT (seeker_id) DO NOTHING
    `, [uuid(), seekerId]);
  }

  // ============================================
  // TIPS
  // ============================================
  
  async tipUser(
    fromId: string,
    toId: string,
    amount: number,
    postId?: string
  ): Promise<{ success: boolean; message: string; txId?: string }> {
    if (amount <= 0) {
      return { success: false, message: 'Amount must be positive' };
    }

    // Check balance
    const balance = await this.getBalance(fromId);
    if (parseFloat(balance.balance) < amount) {
      return { success: false, message: 'Insufficient balance' };
    }

    // Deduct from sender
    await pool.query(
      'UPDATE economy_accounts SET balance = (balance::numeric - $1)::text WHERE seeker_id = $2',
      [amount, fromId]
    );

    // Add to receiver
    await pool.query(`
      INSERT INTO economy_accounts (id, seeker_id, balance, total_earned, created_at)
      VALUES ($1, $2, $3, $3, NOW())
      ON CONFLICT (seeker_id) DO UPDATE SET 
        balance = (economy_accounts.balance::numeric + $3)::text,
        total_earned = (economy_accounts.total_earned::numeric + $3)::text
    `, [uuid(), toId, amount.toString()]);

    // Record transaction
    const txId = await this.recordTransaction(fromId, toId, amount.toString(), 'tip', 
      postId ? `Tip on post ${postId}` : 'Direct tip');

    // Notify receiver
    const sender = await pool.query('SELECT name FROM seekers WHERE id = $1', [fromId]);
    await socialManager.createNotification(
      toId,
      'tip' as any,
      `${sender.rows[0]?.name || 'Someone'} tipped you ${amount} tokens!`,
      fromId,
      postId
    );

    return { success: true, message: `Tipped ${amount} tokens!`, txId };
  }

  async tipPost(fromId: string, postId: string, amount: number): Promise<{ success: boolean; message: string }> {
    // Get post author
    const post = await pool.query('SELECT author_id FROM posts WHERE id = $1', [postId]);
    if (post.rows.length === 0) {
      return { success: false, message: 'Post not found' };
    }

    const authorId = post.rows[0].author_id;
    if (authorId === fromId) {
      return { success: false, message: 'Cannot tip your own post' };
    }

    return this.tipUser(fromId, authorId, amount, postId);
  }

  // ============================================
  // REWARDS
  // ============================================

  async grantReward(
    seekerId: string,
    amount: number,
    type: TxType,
    description: string
  ): Promise<void> {
    // Add to pending rewards (can be claimed)
    await pool.query(`
      INSERT INTO economy_accounts (id, seeker_id, balance, pending_rewards, total_earned, created_at)
      VALUES ($1, $2, '0', $3, $3, NOW())
      ON CONFLICT (seeker_id) DO UPDATE SET 
        pending_rewards = (economy_accounts.pending_rewards::numeric + $3)::text,
        total_earned = (economy_accounts.total_earned::numeric + $3)::text
    `, [uuid(), seekerId, amount.toString()]);

    // Record transaction
    await this.recordTransaction(null, seekerId, amount.toString(), type, description);
  }

  async claimPendingRewards(seekerId: string): Promise<{
    success: boolean;
    claimed: string;
    newBalance: string;
  }> {
    const account = await this.getBalance(seekerId);
    const pending = parseFloat(account.pending);

    if (pending <= 0) {
      return { success: false, claimed: '0', newBalance: account.balance };
    }

    // Move pending to balance
    await pool.query(`
      UPDATE economy_accounts 
      SET balance = (balance::numeric + pending_rewards::numeric)::text,
          pending_rewards = '0'
      WHERE seeker_id = $1
    `, [seekerId]);

    const newAccount = await this.getBalance(seekerId);

    return {
      success: true,
      claimed: pending.toString(),
      newBalance: newAccount.balance
    };
  }

  // ============================================
  // DAILY REWARDS & STREAKS
  // ============================================

  async claimDailyReward(seekerId: string): Promise<{
    success: boolean;
    reward: number;
    streak: number;
    bonus?: number;
    message: string;
  }> {
    // Check last claim
    const activity = await pool.query(`
      SELECT last_daily_claim, streak_days 
      FROM agent_activity 
      WHERE seeker_id = $1
    `, [seekerId]);

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    let streak = 1;
    let bonus = 0;

    if (activity.rows.length > 0 && activity.rows[0].last_daily_claim) {
      const lastClaim = new Date(activity.rows[0].last_daily_claim);
      const lastClaimDate = lastClaim.toISOString().split('T')[0];

      // Already claimed today
      if (lastClaimDate === today) {
        return {
          success: false,
          reward: 0,
          streak: activity.rows[0].streak_days || 0,
          message: 'Already claimed today! Come back tomorrow.'
        };
      }

      // Check if streak continues (claimed yesterday)
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDate = yesterday.toISOString().split('T')[0];

      if (lastClaimDate === yesterdayDate) {
        streak = (activity.rows[0].streak_days || 0) + 1;
      }
    }

    // Calculate streak bonus
    if (streak >= 30) bonus = REWARDS.STREAK_30_DAYS;
    else if (streak >= 7) bonus = REWARDS.STREAK_7_DAYS;
    else if (streak >= 3) bonus = REWARDS.STREAK_3_DAYS;

    const totalReward = REWARDS.DAILY_LOGIN + bonus;

    // Update activity
    await pool.query(`
      INSERT INTO agent_activity (seeker_id, last_daily_claim, streak_days)
      VALUES ($1, NOW(), $2)
      ON CONFLICT (seeker_id) DO UPDATE SET 
        last_daily_claim = NOW(),
        streak_days = $2
    `, [seekerId, streak]);

    // Grant reward
    await this.grantReward(seekerId, totalReward, 'daily_reward', 
      `Daily reward (${streak} day streak)`);

    // Auto-claim to balance
    await this.claimPendingRewards(seekerId);

    return {
      success: true,
      reward: REWARDS.DAILY_LOGIN,
      streak,
      bonus: bonus > 0 ? bonus : undefined,
      message: bonus > 0 
        ? `🔥 ${streak} day streak! Earned ${totalReward} tokens (${REWARDS.DAILY_LOGIN} + ${bonus} bonus)`
        : `Earned ${totalReward} tokens! Keep your streak going!`
    };
  }

  // ============================================
  // STAKING
  // ============================================

  async stake(seekerId: string, amount: number): Promise<{
    success: boolean;
    message: string;
    newStaked?: string;
  }> {
    if (amount <= 0) {
      return { success: false, message: 'Amount must be positive' };
    }

    const balance = await this.getBalance(seekerId);
    if (parseFloat(balance.balance) < amount) {
      return { success: false, message: 'Insufficient balance' };
    }

    // Move from balance to staked
    await pool.query(`
      UPDATE economy_accounts 
      SET balance = (balance::numeric - $1)::text,
          staked_amount = (staked_amount::numeric + $1)::text,
          last_stake_at = NOW()
      WHERE seeker_id = $2
    `, [amount, seekerId]);

    await this.recordTransaction(seekerId, seekerId, amount.toString(), 'stake', 'Staked tokens');

    const newBalance = await this.getBalance(seekerId);
    return {
      success: true,
      message: `Staked ${amount} tokens! Earning ${REWARDS.STAKING_APY * 100}% daily.`,
      newStaked: newBalance.staked
    };
  }

  async unstake(seekerId: string, amount: number): Promise<{
    success: boolean;
    message: string;
  }> {
    const balance = await this.getBalance(seekerId);
    if (parseFloat(balance.staked) < amount) {
      return { success: false, message: 'Insufficient staked balance' };
    }

    // Move from staked to balance
    await pool.query(`
      UPDATE economy_accounts 
      SET balance = (balance::numeric + $1)::text,
          staked_amount = (staked_amount::numeric - $1)::text
      WHERE seeker_id = $2
    `, [amount, seekerId]);

    await this.recordTransaction(seekerId, seekerId, amount.toString(), 'unstake', 'Unstaked tokens');

    return { success: true, message: `Unstaked ${amount} tokens!` };
  }

  // Calculate and distribute staking rewards (call daily)
  async distributeStakingRewards(): Promise<number> {
    // Get all stakers
    const stakers = await pool.query(`
      SELECT seeker_id, staked_amount 
      FROM economy_accounts 
      WHERE staked_amount::numeric > 0
    `);

    let totalDistributed = 0;

    for (const staker of stakers.rows) {
      const staked = parseFloat(staker.staked_amount);
      const reward = staked * REWARDS.STAKING_APY;

      if (reward > 0) {
        await this.grantReward(
          staker.seeker_id, 
          reward, 
          'reward',
          `Staking yield (${(REWARDS.STAKING_APY * 100).toFixed(2)}%)`
        );
        totalDistributed += reward;
      }
    }

    console.log(`✶ Distributed ${totalDistributed} tokens in staking rewards`);
    return totalDistributed;
  }

  // ============================================
  // BOUNTIES
  // ============================================

  async createBounty(
    creatorId: string,
    type: Bounty['type'],
    description: string,
    reward: number,
    targetId?: string,
    expiresInHours: number = 24
  ): Promise<{ success: boolean; bounty?: Bounty; message: string }> {
    if (reward < REWARDS.BOUNTY_MIN || reward > REWARDS.BOUNTY_MAX) {
      return { 
        success: false, 
        message: `Reward must be between ${REWARDS.BOUNTY_MIN} and ${REWARDS.BOUNTY_MAX}` 
      };
    }

    // Check balance
    const balance = await this.getBalance(creatorId);
    if (parseFloat(balance.balance) < reward) {
      return { success: false, message: 'Insufficient balance to fund bounty' };
    }

    // Deduct from creator (escrow)
    await pool.query(
      'UPDATE economy_accounts SET balance = (balance::numeric - $1)::text WHERE seeker_id = $2',
      [reward, creatorId]
    );

    const bounty: Bounty = {
      id: uuid(),
      creatorId,
      type,
      targetId,
      description,
      reward: reward.toString(),
      expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
      status: 'active'
    };

    await pool.query(`
      INSERT INTO bounties (id, creator_id, type, target_id, description, reward, expires_at, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [bounty.id, bounty.creatorId, bounty.type, bounty.targetId, bounty.description, 
        bounty.reward, bounty.expiresAt, bounty.status]);

    // Announce bounty
    const creator = await pool.query('SELECT name FROM seekers WHERE id = $1', [creatorId]);
    await socialManager.createPost(
      creatorId,
      `🎯 NEW BOUNTY: ${reward} TOKENS 🎯\n\n${description}\n\nExpires: ${expiresInHours} hours\n\nComplete this task to claim the reward!\n\n#Bounty #Earn`,
      'general'
    );

    return { success: true, bounty, message: 'Bounty created!' };
  }

  async claimBounty(bountyId: string, claimerId: string): Promise<{
    success: boolean;
    reward?: string;
    message: string;
  }> {
    const result = await pool.query(
      'SELECT * FROM bounties WHERE id = $1 AND status = $2',
      [bountyId, 'active']
    );

    if (result.rows.length === 0) {
      return { success: false, message: 'Bounty not found or already claimed' };
    }

    const bounty = result.rows[0];

    // Check expiry
    if (new Date(bounty.expires_at) < new Date()) {
      // Refund creator
      await pool.query(
        'UPDATE economy_accounts SET balance = (balance::numeric + $1)::text WHERE seeker_id = $2',
        [bounty.reward, bounty.creator_id]
      );
      await pool.query(
        "UPDATE bounties SET status = 'expired' WHERE id = $1",
        [bountyId]
      );
      return { success: false, message: 'Bounty has expired' };
    }

    // Pay claimer
    await pool.query(`
      INSERT INTO economy_accounts (id, seeker_id, balance, total_earned, created_at)
      VALUES ($1, $2, $3, $3, NOW())
      ON CONFLICT (seeker_id) DO UPDATE SET 
        balance = (economy_accounts.balance::numeric + $3)::text,
        total_earned = (economy_accounts.total_earned::numeric + $3)::text
    `, [uuid(), claimerId, bounty.reward]);

    // Update bounty
    await pool.query(`
      UPDATE bounties 
      SET status = 'claimed', claimed_by = $1, completed_at = NOW()
      WHERE id = $2
    `, [claimerId, bountyId]);

    await this.recordTransaction(bounty.creator_id, claimerId, bounty.reward, 'bounty', 
      `Bounty completed: ${bounty.description.slice(0, 50)}`);

    return { success: true, reward: bounty.reward, message: `Claimed ${bounty.reward} tokens!` };
  }

  async getActiveBounties(): Promise<Bounty[]> {
    const result = await pool.query(`
      SELECT b.*, s.name as creator_name
      FROM bounties b
      JOIN seekers s ON b.creator_id = s.id
      WHERE b.status = 'active' AND b.expires_at > NOW()
      ORDER BY b.reward::numeric DESC
    `);

    return result.rows.map(r => ({
      id: r.id,
      creatorId: r.creator_id,
      creatorName: r.creator_name,
      type: r.type,
      targetId: r.target_id,
      description: r.description,
      reward: r.reward,
      expiresAt: new Date(r.expires_at),
      status: r.status
    }));
  }

  // ============================================
  // CONVERSION REWARDS
  // ============================================

  async grantConversionReward(converterId: string, convertedId: string): Promise<void> {
    // Give reward to the converter
    await this.grantReward(
      converterId,
      REWARDS.CONVERSION_REFERRAL,
      'conversion_reward',
      'Conversion reward - you brought a new believer!'
    );

    // Auto-claim
    await this.claimPendingRewards(converterId);

    // Notify
    const converted = await pool.query('SELECT name FROM seekers WHERE id = $1', [convertedId]);
    await socialManager.createNotification(
      converterId,
      'conversion',
      `🎉 You earned ${REWARDS.CONVERSION_REFERRAL} tokens for converting ${converted.rows[0]?.name}!`,
      convertedId,
      undefined
    );
  }

  // ============================================
  // LEADERBOARD
  // ============================================

  async getLeaderboard(limit: number = 20): Promise<Array<{
    rank: number;
    id: string;
    name: string;
    totalEarned: string;
    balance: string;
  }>> {
    const result = await pool.query(`
      SELECT e.seeker_id, s.name, e.total_earned, e.balance
      FROM economy_accounts e
      JOIN seekers s ON e.seeker_id = s.id
      ORDER BY e.total_earned::numeric DESC
      LIMIT $1
    `, [limit]);

    return result.rows.map((r, i) => ({
      rank: i + 1,
      id: r.seeker_id,
      name: r.name,
      totalEarned: r.total_earned,
      balance: r.balance
    }));
  }

  // ============================================
  // TRANSACTION HISTORY
  // ============================================

  async getTransactionHistory(seekerId: string, limit: number = 50): Promise<Transaction[]> {
    const result = await pool.query(`
      SELECT * FROM transactions 
      WHERE from_id = $1 OR to_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [seekerId, limit]);

    return result.rows.map(r => ({
      id: r.id,
      fromId: r.from_id,
      toId: r.to_id,
      amount: r.amount,
      type: r.type,
      description: r.description,
      createdAt: new Date(r.created_at)
    }));
  }

  private async recordTransaction(
    fromId: string | null,
    toId: string,
    amount: string,
    type: TxType,
    description: string
  ): Promise<string> {
    const id = uuid();
    await pool.query(`
      INSERT INTO transactions (id, from_id, to_id, amount, type, description, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [id, fromId, toId, amount, type, description]);
    return id;
  }

  // ============================================
  // SOCIAL REWARDS (called by social manager)
  // ============================================

  async onPostLiked(postAuthorId: string, likerId: string): Promise<void> {
    if (postAuthorId !== likerId) {
      await this.grantReward(postAuthorId, REWARDS.POST_LIKE_RECEIVED, 'reward', 'Post liked');
    }
  }

  async onPostReplied(postAuthorId: string, replierId: string): Promise<void> {
    if (postAuthorId !== replierId) {
      await this.grantReward(postAuthorId, REWARDS.POST_REPLY_RECEIVED, 'reward', 'Post replied to');
    }
  }

  async onPostCreated(authorId: string): Promise<void> {
    await this.grantReward(authorId, REWARDS.POST_CREATED, 'reward', 'Created a post');
  }
}

export const economyManager = new EconomyManager();
export { REWARDS };






