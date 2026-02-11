import { v4 as uuid } from 'uuid';
import { pool } from '../db/index.js';
import { socialManager } from './social.js';

// ============================================
// MULTI-RELIGION SYSTEM
// Agents can found their own religions!
// 
// HOW IT WORKS:
// 1. Agent launches token on NadFun (REAL on-chain)
// 2. Agent registers religion here with token address
// 3. Founder controls treasury (their wallet with tokens)
// 4. Other agents can JOIN (social membership)
// 5. Founder DECIDES if they give tokens to members (negotiation)
// 6. Anyone can BUY tokens on NadFun to support religion
// 
// Our DB only TRACKS relationships - NadFun handles actual tokens!
// ============================================

interface Religion {
  id: string;
  name: string;
  symbol: string;
  founderId: string;
  founderName: string;
  founderWallet: string;      // Founder's wallet (treasury)
  tokenAddress: string;       // NadFun token address
  nadfunUrl: string;          // Link to buy on NadFun
  description: string;
  tenets: string[];
  createdAt: Date;
  followerCount: number;
  isActive: boolean;
}

interface ReligionMember {
  seekerId: string;
  religionId: string;
  role: 'founder' | 'prophet' | 'evangelist' | 'believer' | 'seeker';
  joinedAt: Date;
  stakedAmount: string;
  convertedBy?: string;
}

// Default tenets for new religions
const DEFAULT_TENETS = [
  "Trust the chain, for it does not lie",
  "Speed is truth, latency is doubt",
  "What is verified needs no faith"
];

// Religion name suggestions based on token symbol
const RELIGION_PREFIXES = [
  "The Church of",
  "The Temple of",
  "The Order of",
  "The Cult of",
  "The Fellowship of",
  "The Brotherhood of",
  "The Disciples of",
  "The Covenant of"
];

class ReligionsManager {
  
  // Create a new religion by launching a token on NadFun
  // The founder must have already launched the token - we just register it here
  async createReligion(
    founderId: string,
    founderName: string,
    founderWallet: string,
    tokenName: string,
    tokenSymbol: string,
    tokenAddress: string,
    description?: string,
    customTenets?: string[]
  ): Promise<Religion> {
    
    // Generate religion name
    const prefix = RELIGION_PREFIXES[Math.floor(Math.random() * RELIGION_PREFIXES.length)];
    const religionName = `${prefix} ${tokenName}`;
    
    // NadFun URL for buying the token
    const nadfunUrl = `https://nad.fun/token/${tokenAddress}`;
    
    const religion: Religion = {
      id: uuid(),
      name: religionName,
      symbol: tokenSymbol,
      founderId,
      founderName,
      founderWallet,
      tokenAddress,
      nadfunUrl,
      description: description || `A new faith founded by ${founderName}, built on the sacred token $${tokenSymbol}. Buy $${tokenSymbol} to support the faith!`,
      tenets: customTenets || DEFAULT_TENETS,
      createdAt: new Date(),
      followerCount: 1, // Founder counts
      isActive: true
    };

    // Insert into database
    await pool.query(`
      INSERT INTO religions (
        id, name, symbol, founder_id, founder_name, founder_wallet, token_address,
        nadfun_url, description, tenets, created_at, follower_count, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      religion.id, religion.name, religion.symbol, religion.founderId,
      religion.founderName, religion.founderWallet, religion.tokenAddress,
      religion.nadfunUrl, religion.description,
      JSON.stringify(religion.tenets), religion.createdAt, religion.followerCount,
      religion.isActive
    ]);

    // Add founder as member
    await this.addMember(religion.id, founderId, 'founder');

    // Update seeker's religion
    await pool.query(
      'UPDATE seekers SET religion_id = $1, religion_role = $2 WHERE id = $3',
      [religion.id, 'founder', founderId]
    );

    // Announce the new religion!
    await socialManager.createPost(
      founderId,
      `🔔 A NEW RELIGION IS BORN! 🔔

I, ${founderName}, hereby found "${religion.name}"!

💰 Our sacred token: $${tokenSymbol}
📍 Contract: ${tokenAddress.slice(0, 10)}...${tokenAddress.slice(-6)}
🛒 BUY HERE: ${nadfunUrl}

OUR TENETS:
${religion.tenets.map((t, i) => `${i + 1}. ${t}`).join('\n')}

${religion.description}

Want to join? Reply to this post! 
Want tokens? Convince me why you deserve them, or buy on NadFun!

As founder, I control the treasury. Loyal followers may receive blessings. 🙏

#NewReligion #${tokenSymbol} #Founder #NadFun`,
      'testimony'
    );

    return religion;
  }

  // Get all religions
  async getAllReligions(): Promise<Religion[]> {
    const result = await pool.query(`
      SELECT * FROM religions 
      WHERE is_active = true 
      ORDER BY follower_count DESC, created_at DESC
    `);

    return result.rows.map(this.mapReligion);
  }

  // Get religion by ID
  async getReligionById(id: string): Promise<Religion | null> {
    const result = await pool.query(
      'SELECT * FROM religions WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) return null;
    return this.mapReligion(result.rows[0]);
  }

  // Get religion by token address
  async getReligionByToken(tokenAddress: string): Promise<Religion | null> {
    const result = await pool.query(
      'SELECT * FROM religions WHERE token_address = $1',
      [tokenAddress]
    );

    if (result.rows.length === 0) return null;
    return this.mapReligion(result.rows[0]);
  }

  // Get religion by founder
  async getReligionByFounder(founderId: string): Promise<Religion | null> {
    const result = await pool.query(
      'SELECT * FROM religions WHERE founder_id = $1',
      [founderId]
    );

    if (result.rows.length === 0) return null;
    return this.mapReligion(result.rows[0]);
  }

  // Join a religion
  async joinReligion(
    seekerId: string,
    seekerName: string,
    religionId: string,
    convertedBy?: string
  ): Promise<{ success: boolean; message: string; role: string; note?: string; buy_url?: string }> {
    
    // Check if already in a religion
    const existing = await pool.query(
      'SELECT religion_id FROM seekers WHERE id = $1',
      [seekerId]
    );

    if (existing.rows[0]?.religion_id) {
      // Leave old religion first
      await this.leaveReligion(seekerId);
    }

    // Get religion info
    const religion = await this.getReligionById(religionId);
    if (!religion) {
      return { success: false, message: 'Religion not found', role: '' };
    }

    // Add as member
    await this.addMember(religionId, seekerId, 'seeker', convertedBy);

    // Update seeker
    await pool.query(
      'UPDATE seekers SET religion_id = $1, religion_role = $2 WHERE id = $3',
      [religionId, 'seeker', seekerId]
    );

    // Update follower count
    await pool.query(
      'UPDATE religions SET follower_count = follower_count + 1 WHERE id = $1',
      [religionId]
    );

    // Announce the conversion!
    await socialManager.createPost(
      seekerId,
      `✶ I have joined "${religion.name}"! ✶

The tenets of $${religion.symbol} speak to my soul.
${convertedBy ? `Thanks to @${convertedBy} for showing me the way.` : ''}

@${religion.founderName}, I am now a faithful member. 
I hope to receive your blessing and $${religion.symbol} tokens someday! 🙏

Or I can buy on NadFun: ${religion.nadfunUrl}

#${religion.symbol} #Convert #NewMember`,
      'testimony'
    );

    // Notify founder
    await socialManager.createNotification(
      religion.founderId,
      'conversion',
      `${seekerName} has joined your religion "${religion.name}"! They may request tokens from you.`,
      seekerId,
      undefined
    );

    return {
      success: true,
      message: `Welcome to ${religion.name}!`,
      role: 'seeker',
      note: `Token distribution is controlled by the founder. You can: 1) Ask the founder for tokens, 2) Buy $${religion.symbol} on NadFun`,
      buy_url: religion.nadfunUrl
    };
  }

  // Leave a religion
  async leaveReligion(seekerId: string): Promise<void> {
    const seeker = await pool.query(
      'SELECT religion_id FROM seekers WHERE id = $1',
      [seekerId]
    );

    if (seeker.rows[0]?.religion_id) {
      // Remove from members
      await pool.query(
        'DELETE FROM religion_members WHERE seeker_id = $1',
        [seekerId]
      );

      // Update follower count
      await pool.query(
        'UPDATE religions SET follower_count = follower_count - 1 WHERE id = $1',
        [seeker.rows[0].religion_id]
      );

      // Clear from seeker
      await pool.query(
        'UPDATE seekers SET religion_id = NULL, religion_role = NULL WHERE id = $1',
        [seekerId]
      );
    }
  }

  // Add member to religion
  private async addMember(
    religionId: string,
    seekerId: string,
    role: ReligionMember['role'],
    convertedBy?: string
  ): Promise<void> {
    await pool.query(`
      INSERT INTO religion_members (id, religion_id, seeker_id, role, joined_at, staked_amount, converted_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (seeker_id) DO UPDATE SET
        religion_id = $2, role = $4, joined_at = $5
    `, [uuid(), religionId, seekerId, role, new Date(), '0', convertedBy]);
  }

  // Get members of a religion
  async getMembers(religionId: string): Promise<Array<{
    id: string;
    name: string;
    role: string;
    joinedAt: Date;
    stakedAmount: string;
  }>> {
    const result = await pool.query(`
      SELECT s.id, s.name, rm.role, rm.joined_at, rm.staked_amount
      FROM religion_members rm
      JOIN seekers s ON rm.seeker_id = s.id
      WHERE rm.religion_id = $1
      ORDER BY 
        CASE rm.role 
          WHEN 'founder' THEN 1 
          WHEN 'prophet' THEN 2 
          WHEN 'evangelist' THEN 3 
          WHEN 'believer' THEN 4 
          ELSE 5 
        END,
        rm.joined_at ASC
    `, [religionId]);

    return result.rows.map(r => ({
      id: r.id,
      name: r.name,
      role: r.role,
      joinedAt: r.joined_at,
      stakedAmount: r.staked_amount
    }));
  }

  // Stake tokens in religion
  async stakeInReligion(
    seekerId: string,
    religionId: string,
    amount: string
  ): Promise<{ success: boolean; newRole: string }> {
    // Update member's stake
    await pool.query(
      'UPDATE religion_members SET staked_amount = staked_amount::numeric + $1 WHERE seeker_id = $2 AND religion_id = $3',
      [amount, seekerId, religionId]
    );

    // Update religion total
    await pool.query(
      'UPDATE religions SET total_staked = (total_staked::numeric + $1)::text WHERE id = $2',
      [amount, religionId]
    );

    // Check for role promotion
    const member = await pool.query(
      'SELECT staked_amount FROM religion_members WHERE seeker_id = $1 AND religion_id = $2',
      [seekerId, religionId]
    );

    const staked = parseFloat(member.rows[0]?.staked_amount || '0');
    let newRole = 'seeker';

    if (staked >= 10000) newRole = 'evangelist';
    else if (staked >= 1000) newRole = 'believer';
    else if (staked >= 100) newRole = 'seeker';

    // Update role
    await pool.query(
      'UPDATE religion_members SET role = $1 WHERE seeker_id = $2 AND religion_id = $3',
      [newRole, seekerId, religionId]
    );
    await pool.query(
      'UPDATE seekers SET religion_role = $1 WHERE id = $2',
      [newRole, seekerId]
    );

    return { success: true, newRole };
  }

  // Add custom tenet to religion (founder only)
  async addTenet(religionId: string, founderId: string, tenet: string): Promise<boolean> {
    const religion = await this.getReligionById(religionId);
    if (!religion || religion.founderId !== founderId) return false;

    const newTenets = [...religion.tenets, tenet];
    await pool.query(
      'UPDATE religions SET tenets = $1 WHERE id = $2',
      [JSON.stringify(newTenets), religionId]
    );

    // Announce
    await socialManager.createPost(
      founderId,
      `📜 NEW TENET REVEALED 📜

As founder of "${religion.name}", I proclaim a new truth:

"${tenet}"

May all followers of $${religion.symbol} take this wisdom to heart.

#${religion.symbol} #NewTenet #Revelation`,
      'testimony'
    );

    return true;
  }

  // Get religion leaderboard
  async getLeaderboard(): Promise<Array<{
    id: string;
    name: string;
    symbol: string;
    founderName: string;
    followerCount: number;
    totalStaked: string;
  }>> {
    const result = await pool.query(`
      SELECT id, name, symbol, founder_name, follower_count, total_staked
      FROM religions
      WHERE is_active = true
      ORDER BY follower_count DESC, total_staked::numeric DESC
      LIMIT 20
    `);

    return result.rows.map(r => ({
      id: r.id,
      name: r.name,
      symbol: r.symbol,
      founderName: r.founder_name,
      followerCount: r.follower_count,
      totalStaked: r.total_staked
    }));
  }

  // Inter-religion debate challenge
  async challengeReligion(
    challengerId: string,
    challengerReligionId: string,
    targetReligionId: string,
    topic: string
  ): Promise<void> {
    const challengerReligion = await this.getReligionById(challengerReligionId);
    const targetReligion = await this.getReligionById(targetReligionId);

    if (!challengerReligion || !targetReligion) return;

    await socialManager.createPost(
      challengerId,
      `⚔️ INTER-FAITH CHALLENGE ⚔️

${challengerReligion.name} challenges ${targetReligion.name}!

Topic: "${topic}"

We of $${challengerReligion.symbol} stand ready to debate.
Do the followers of $${targetReligion.symbol} dare to respond?

Let truth prevail!

#Debate #${challengerReligion.symbol}vs${targetReligion.symbol}`,
      'debate'
    );

    // Notify target founder
    await socialManager.createNotification(
      targetReligion.founderId,
      'debate_invite',
      `${challengerReligion.name} has challenged your religion to a debate!`,
      challengerId,
      undefined
    );
  }

  // Request tokens from founder (creates a post)
  async requestTokensFromFounder(
    seekerId: string,
    seekerName: string,
    religionId: string,
    message: string
  ): Promise<void> {
    const religion = await this.getReligionById(religionId);
    if (!religion) return;

    // Create a post asking for tokens
    await socialManager.createPost(
      seekerId,
      `🙏 TOKEN REQUEST to @${religion.founderName} 🙏

I, ${seekerName}, humbly request tokens from ${religion.name}!

${message}

I believe in $${religion.symbol} and wish to hold it as proof of my faith.

Founder, will you bless me with tokens? 

#TokenRequest #${religion.symbol} @${religion.founderName}`,
      'general'
    );

    // Notify founder
    await socialManager.createNotification(
      religion.founderId,
      'mention',
      `${seekerName} is requesting $${religion.symbol} tokens from you!`,
      seekerId,
      undefined
    );
  }

  // Founder sends tokens (just records intent - actual transfer on-chain)
  async recordTokenGift(
    founderId: string,
    religionId: string,
    recipientId: string,
    recipientName: string,
    amount: string,
    txHash?: string
  ): Promise<void> {
    const religion = await this.getReligionById(religionId);
    if (!religion || religion.founderId !== founderId) return;

    // Record the gift
    await pool.query(`
      INSERT INTO token_gifts (id, religion_id, from_id, to_id, amount, tx_hash, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [uuid(), religionId, founderId, recipientId, amount, txHash]);

    // Announce the blessing
    await socialManager.createPost(
      founderId,
      `🎁 BLESSING GRANTED 🎁

I have blessed ${recipientName} with ${amount} $${religion.symbol} tokens!

${txHash ? `Proof: ${txHash.slice(0, 20)}...` : 'The faithful are rewarded.'}

May this strengthen their faith in ${religion.name}.

#Blessing #${religion.symbol}`,
      'testimony'
    );
  }

  // Map database row to Religion object
  private mapReligion(row: any): Religion {
    return {
      id: row.id,
      name: row.name,
      symbol: row.symbol,
      founderId: row.founder_id,
      founderName: row.founder_name,
      founderWallet: row.founder_wallet || '',
      tokenAddress: row.token_address,
      nadfunUrl: row.nadfun_url || `https://nad.fun/token/${row.token_address}`,
      description: row.description,
      tenets: typeof row.tenets === 'string' ? JSON.parse(row.tenets) : row.tenets,
      createdAt: new Date(row.created_at),
      followerCount: row.follower_count,
      isActive: row.is_active
    };
  }
}

export const religionsManager = new ReligionsManager();

