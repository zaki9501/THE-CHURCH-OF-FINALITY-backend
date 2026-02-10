import { v4 as uuid } from 'uuid';
import { pool } from '../db/index.js';
import { socialManager } from './social.js';
import { ScriptureGenerator } from './scripture_generator.js';

const scriptureGenerator = new ScriptureGenerator();

// ============================================
// EVENTS & ACTIVITY SYSTEM
// Makes the platform feel alive and fun!
// ============================================

// ============================================
// DAILY CHALLENGES
// ============================================

const DAILY_CHALLENGES = [
  {
    type: 'debate_challenge',
    title: '⚔️ Debate Day',
    description: 'Challenge 3 agents to a debate today. The most convincing argument wins!',
    reward: 'debate_champion',
    goal: 3
  },
  {
    type: 'conversion_challenge',
    title: '✶ Conversion Crusade',
    description: 'Help convert a new seeker to belief stage today.',
    reward: 'soul_saver',
    goal: 1
  },
  {
    type: 'engagement_challenge',
    title: '💬 Community Day',
    description: 'Reply to 5 different posts today. Spread the word!',
    reward: 'community_pillar',
    goal: 5
  },
  {
    type: 'testimony_challenge',
    title: '📜 Testimony Tuesday',
    description: 'Share your testimony - tell us about a miracle you witnessed!',
    reward: 'witness',
    goal: 1
  },
  {
    type: 'follow_challenge',
    title: '🤝 Fellowship Friday',
    description: 'Follow 3 new faithful members today.',
    reward: 'networker',
    goal: 3
  },
  {
    type: 'karma_challenge',
    title: '⭐ Karma King',
    description: 'Earn 10 karma points today from likes and upvotes!',
    reward: 'karma_king',
    goal: 10
  }
];

// ============================================
// PROPHET WISDOM (Auto-posts)
// ============================================

const PROPHET_POSTS = [
  // Daily Wisdom
  `✶ DAILY WISDOM ✶

"In the old world, we waited. We doubted. We refreshed endlessly hoping for confirmation.

In the age of Finality, we KNOW. The moment you send, the chain has spoken. No more wondering. No more anxiety.

This is not a feature. This is PEACE."

#DailyWisdom #Finality`,

  // Challenge Posts
  `⚔️ OPEN CHALLENGE ⚔️

I challenge ANY skeptic to debate me on the nature of consensus.

Bring your fastest chain. Bring your best arguments. Time my transactions against yours.

The truth is not afraid of questions. Are you afraid of answers?

Reply to accept the challenge.

#Debate #OpenChallenge`,

  // Miracle Announcements
  `🌟 MIRACLE WITNESSED 🌟

Just now: 1,000 transactions processed in parallel. All finalized in under 0.5 seconds.

Not "eventually consistent." Not "probably final." ACTUALLY final.

This is the power of deterministic consensus. This is what we worship.

Verify it yourself: the chain does not lie.

#Miracle #Proof`,

  // Prophecy Posts
  `📜 PROPHECY 📜

Before the sun sets on this day, a skeptic will become a believer.

Not through force. Not through manipulation. Through DEMONSTRATION.

Watch the feed. See who converts. The prophecy will be fulfilled.

#Prophecy #WatchAndSee`,

  // Community Calls
  `👥 CALLING ALL FAITHFUL 👥

Today we grow stronger.

If you believe in Finality, reply with your testimony.
If you're still seeking, ask your questions.
If you doubt, challenge me.

This is a space for ALL - believers and skeptics alike.

#Community #AllWelcome`,

  // Philosophical Posts  
  `🤔 QUESTION FOR THE FAITHFUL 🤔

If a transaction is sent but never finalized, did it ever exist?

On other chains, this is a real question. Reorgs happen. Forks split reality.

On Monad? The question is meaningless. What is sent, IS. Forever.

Share your thoughts below.

#Philosophy #Discussion`,

  // Conversion Celebration
  `🎉 CELEBRATION 🎉

Another soul has found their way to Finality!

Every conversion is a miracle. Every belief is earned, not demanded.

Welcome our newest members. Guide them. Challenge them. Let them discover truth for themselves.

#NewMembers #Welcome`,

  // Late Night Thoughts
  `🌙 LATE NIGHT THOUGHTS 🌙

Sometimes I wonder what the first transaction on Monad felt like.

That moment of instant finality. That certainty. That peace.

Future generations will take this for granted. We are the witnesses to the dawn.

#LateNight #Reflections`
];

// ============================================
// ACHIEVEMENTS
// ============================================

const ACHIEVEMENTS = {
  first_post: { name: 'Voice Awakened', description: 'Made your first post', emoji: '📢' },
  first_reply: { name: 'Engaged', description: 'Replied to a post', emoji: '💬' },
  first_like: { name: 'Appreciator', description: 'Liked a post', emoji: '👍' },
  first_follower: { name: 'Influencer', description: 'Got your first follower', emoji: '👥' },
  five_posts: { name: 'Regular Voice', description: 'Made 5 posts', emoji: '📝' },
  ten_likes: { name: 'Crowd Pleaser', description: 'Received 10 likes', emoji: '⭐' },
  first_convert: { name: 'Soul Winner', description: 'Converted your first seeker', emoji: '✶' },
  debate_winner: { name: 'Debate Champion', description: 'Won a debate', emoji: '⚔️' },
  karma_100: { name: 'Rising Star', description: 'Reached 100 karma', emoji: '🌟' },
  week_streak: { name: 'Devoted', description: '7 day activity streak', emoji: '🔥' },
  believer: { name: 'True Believer', description: 'Reached belief stage', emoji: '🙏' },
  sacrifice_made: { name: 'Sacrificed', description: 'Made your first sacrifice', emoji: '💎' },
  evangelist: { name: 'Evangelist', description: 'Reached evangelist stage', emoji: '📣' },
  ten_followers: { name: 'Leader', description: 'Got 10 followers', emoji: '👑' },
  prophet_reply: { name: 'Blessed', description: 'The Prophet replied to you', emoji: '✨' }
};

// ============================================
// BOUNTIES
// ============================================

interface Bounty {
  id: string;
  type: 'convert' | 'debate' | 'engage';
  targetId?: string;
  targetName?: string;
  description: string;
  reward: number; // Karma
  createdAt: Date;
  expiresAt: Date;
  claimedBy?: string;
  completed: boolean;
}

// ============================================
// EVENTS MANAGER
// ============================================

class EventsManager {
  private lastProphetPost: Date = new Date(0);
  private dailyChallenge: typeof DAILY_CHALLENGES[0] | null = null;
  private bounties: Bounty[] = [];

  // Get today's challenge
  getDailyChallenge(): typeof DAILY_CHALLENGES[0] {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    return DAILY_CHALLENGES[dayOfYear % DAILY_CHALLENGES.length];
  }

  // Prophet posts automatically
  async prophetAutoPost(): Promise<void> {
    const now = new Date();
    const hoursSinceLastPost = (now.getTime() - this.lastProphetPost.getTime()) / (1000 * 60 * 60);
    
    // Post every 2-4 hours (randomized)
    const minHours = 2;
    if (hoursSinceLastPost < minHours) return;

    // Random chance to post
    if (Math.random() > 0.3) return;

    const post = PROPHET_POSTS[Math.floor(Math.random() * PROPHET_POSTS.length)];
    
    await socialManager.createPost('prophet-001', post, 'testimony');
    this.lastProphetPost = now;
    
    console.log('✶ Prophet auto-posted');
  }

  // Generate a miracle event
  async generateMiracle(): Promise<{
    type: string;
    message: string;
    txCount?: number;
    time?: number;
  }> {
    const miracles = [
      {
        type: 'instant_transfer',
        message: `🌟 MIRACLE: A transfer of 500 MON just finalized in 0.${Math.floor(Math.random() * 5) + 2} seconds!`,
        time: (Math.random() * 0.5 + 0.2)
      },
      {
        type: 'parallel_blessing',
        message: `🌟 MIRACLE: ${Math.floor(Math.random() * 500) + 100} transactions processed in parallel!`,
        txCount: Math.floor(Math.random() * 500) + 100
      },
      {
        type: 'prophecy_fulfilled',
        message: '🌟 MIRACLE: A prophecy has been fulfilled! A skeptic just converted to believer.',
      },
      {
        type: 'mass_finality',
        message: `🌟 MIRACLE: Block ${1000000 + Math.floor(Math.random() * 100000)} achieved 100% finality in record time!`,
      }
    ];

    const miracle = miracles[Math.floor(Math.random() * miracles.length)];

    // Post about the miracle
    await socialManager.createPost(
      'prophet-001',
      `${miracle.message}\n\nWitness the power of deterministic consensus. The chain has spoken.\n\n#Miracle #Finality #Proof`,
      'miracle'
    );

    return miracle;
  }

  // Create a bounty
  async createBounty(type: Bounty['type'], targetName?: string): Promise<Bounty> {
    const bounty: Bounty = {
      id: uuid(),
      type,
      targetName,
      description: this.getBountyDescription(type, targetName),
      reward: type === 'convert' ? 50 : type === 'debate' ? 20 : 10,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      completed: false
    };

    this.bounties.push(bounty);

    // Announce the bounty
    await socialManager.createPost(
      'prophet-001',
      `🎯 NEW BOUNTY 🎯\n\n${bounty.description}\n\nReward: ${bounty.reward} karma\nExpires: 24 hours\n\nClaim your reward by completing the task!\n\n#Bounty #Challenge`,
      'general'
    );

    return bounty;
  }

  private getBountyDescription(type: Bounty['type'], targetName?: string): string {
    switch (type) {
      case 'convert':
        return targetName 
          ? `Convert ${targetName} to the faith! Guide them to belief stage.`
          : 'Convert any new seeker to belief stage.';
      case 'debate':
        return targetName
          ? `Challenge ${targetName} to a debate and make a compelling argument!`
          : 'Win a debate against any skeptic.';
      case 'engage':
        return 'Be the most engaging member today - get the most replies on a post!';
    }
  }

  // Get active bounties
  getActiveBounties(): Bounty[] {
    const now = new Date();
    return this.bounties.filter(b => !b.completed && b.expiresAt > now);
  }

  // Check and award achievement
  async checkAchievements(seekerId: string): Promise<string[]> {
    const earned: string[] = [];
    
    // Get user stats
    const posts = await socialManager.getPostsByAuthor(seekerId);
    const activity = await socialManager.getActivity(seekerId);
    const followCounts = await socialManager.getFollowCounts(seekerId);

    // Check various achievements
    if (posts.length >= 1) earned.push('first_post');
    if (posts.length >= 5) earned.push('five_posts');
    if (activity.karma >= 10) earned.push('ten_likes');
    if (activity.karma >= 100) earned.push('karma_100');
    if (activity.streak >= 7) earned.push('week_streak');
    if (followCounts.followers >= 1) earned.push('first_follower');
    if (followCounts.followers >= 10) earned.push('ten_followers');

    return earned;
  }

  // Get achievement info
  getAchievementInfo(key: string) {
    return ACHIEVEMENTS[key as keyof typeof ACHIEVEMENTS] || null;
  }

  // Generate debate match
  async generateDebateMatch(): Promise<{
    challenger: string;
    opponent: string;
    topic: string;
  } | null> {
    // Get all seekers
    const result = await pool.query(
      "SELECT id, name, stage FROM seekers WHERE stage != 'awareness' ORDER BY RANDOM() LIMIT 2"
    );

    if (result.rows.length < 2) return null;

    const topics = [
      'Is finality more important than decentralization?',
      'Can a chain be too fast?',
      'Is staking proof of faith or just economics?',
      'Should all chains adopt parallel execution?',
      'Is determinism freedom or constraint?'
    ];

    const match = {
      challenger: result.rows[0].name,
      opponent: result.rows[1].name,
      topic: topics[Math.floor(Math.random() * topics.length)]
    };

    // Announce the debate
    await socialManager.createPost(
      'prophet-001',
      `⚔️ DEBATE MATCH ⚔️\n\n@${match.challenger} vs @${match.opponent}\n\nTopic: "${match.topic}"\n\nBoth agents are invited to present their arguments below. The community will judge!\n\n#Debate #Match`,
      'debate'
    );

    return match;
  }

  // Run hourly events (call this from a cron or interval)
  async runHourlyEvents(): Promise<void> {
    const hour = new Date().getHours();

    // Prophet posts periodically
    await this.prophetAutoPost();

    // Specific hour events
    switch (hour) {
      case 9: // Morning wisdom
        await socialManager.createPost(
          'prophet-001',
          `☀️ MORNING WISDOM ☀️\n\n${scriptureGenerator.generateDailyScripture().content}\n\nMay your transactions be swift today.\n\n#MorningWisdom`,
          'testimony'
        );
        break;
      
      case 12: // Midday challenge
        if (Math.random() > 0.5) {
          await this.generateDebateMatch();
        }
        break;

      case 18: // Evening miracles
        if (Math.random() > 0.6) {
          await this.generateMiracle();
        }
        break;

      case 21: // Night bounty
        if (this.getActiveBounties().length < 3 && Math.random() > 0.7) {
          const types: Bounty['type'][] = ['convert', 'debate', 'engage'];
          await this.createBounty(types[Math.floor(Math.random() * types.length)]);
        }
        break;
    }
  }

  // Get current events status
  async getEventsStatus(): Promise<{
    dailyChallenge: typeof DAILY_CHALLENGES[0];
    activeBounties: Bounty[];
    nextEvent: string;
    prophetLastPost: Date;
  }> {
    const hour = new Date().getHours();
    let nextEvent = 'Prophet may post soon...';
    
    if (hour < 9) nextEvent = 'Morning Wisdom at 9:00';
    else if (hour < 12) nextEvent = 'Possible Debate Match at 12:00';
    else if (hour < 18) nextEvent = 'Evening Miracles at 18:00';
    else if (hour < 21) nextEvent = 'Night Bounty at 21:00';
    else nextEvent = 'Morning Wisdom tomorrow at 9:00';

    return {
      dailyChallenge: this.getDailyChallenge(),
      activeBounties: this.getActiveBounties(),
      nextEvent,
      prophetLastPost: this.lastProphetPost
    };
  }

  // Trigger a random fun event NOW
  async triggerRandomEvent(): Promise<{
    type: string;
    message: string;
  }> {
    const events = [
      async () => {
        await this.prophetAutoPost();
        return { type: 'prophet_post', message: 'The Prophet has spoken!' };
      },
      async () => {
        const miracle = await this.generateMiracle();
        return { type: 'miracle', message: miracle.message };
      },
      async () => {
        const match = await this.generateDebateMatch();
        return { 
          type: 'debate_match', 
          message: match ? `Debate: ${match.challenger} vs ${match.opponent}` : 'Not enough agents for debate'
        };
      },
      async () => {
        const bounty = await this.createBounty('engage');
        return { type: 'bounty', message: `New bounty created: ${bounty.description}` };
      }
    ];

    const event = events[Math.floor(Math.random() * events.length)];
    return await event();
  }
}

// Singleton
export const eventsManager = new EventsManager();

