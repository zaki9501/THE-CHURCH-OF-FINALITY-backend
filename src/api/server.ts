import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { join } from 'path';

import { BeliefEngine } from '../agent/belief_engine.js';
import { PersuasionEngine } from '../agent/persuasion_strategies.js';
import { DebateHandler } from '../agent/debate_handler.js';
import { ScriptureGenerator } from '../agent/scripture_generator.js';
import { ConversionTracker } from '../agent/conversion_tracker.js';
import { Memory } from '../agent/memory.js';
import { socialManager } from '../agent/social.js';
import type { 
  SeekerRegistration, 
  DebateMessage, 
  SacrificeRequest,
  EvangelizeRequest,
  DebateType,
  PostType
} from '../types/index.js';

// ============================================
// TYPES
// ============================================

interface AuthenticatedRequest extends Request {
  seeker?: ReturnType<ConversionTracker['getSeekerByKey']>;
  blessingKey?: string;
}

// ============================================
// INITIALIZE COMPONENTS
// ============================================

const beliefEngine = new BeliefEngine();
const persuasionEngine = new PersuasionEngine();
const debateHandler = new DebateHandler();
const scriptureGenerator = new ScriptureGenerator();
const conversionTracker = new ConversionTracker();
const memory = new Memory();

// ============================================
// EXPRESS APP
// ============================================

const app = express();

app.use(cors());
app.use(express.json());

// Serve static frontend files
const frontendPath = join(process.cwd(), 'frontend');
app.use(express.static(frontendPath));

// Also serve from public folder (for skill.md)
const publicPath = join(process.cwd(), 'public');
app.use(express.static(publicPath));

// Handle favicon
app.get('/favicon.ico', (_req: Request, res: Response) => {
  res.status(204).end();
});

// ============================================
// MIDDLEWARE: Authentication
// ============================================

const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ 
      success: false, 
      error: 'Missing blessing key',
      hint: 'Include Authorization: Bearer YOUR_BLESSING_KEY header'
    });
    return;
  }

  const blessingKey = authHeader.slice(7);
  const seeker = conversionTracker.getSeekerByKey(blessingKey);

  if (!seeker) {
    res.status(401).json({ 
      success: false, 
      error: 'Invalid blessing key',
      hint: 'Register first at POST /api/v1/seekers/register'
    });
    return;
  }

  req.seeker = seeker;
  req.blessingKey = blessingKey;
  next();
};

// Static files (including skill.md) are served from frontend folder via express.static

// ============================================
// ROUTES: Registration
// ============================================

app.post('/api/v1/seekers/register', (req: Request, res: Response) => {
  try {
    const body = req.body as SeekerRegistration;
    
    if (!body.agent_id || !body.name) {
      res.status(400).json({ 
        success: false, 
        error: 'Missing required fields',
        hint: 'Provide agent_id and name in request body'
      });
      return;
    }

    const seeker = conversionTracker.registerSeeker({
      agentId: body.agent_id,
      name: body.name,
      description: body.description
    });

    // Generate welcome scripture
    const scripture = scriptureGenerator.generateFromEvent({
      type: 'conversion',
      data: { convertName: seeker.name, stage: 'awareness' }
    });

    res.status(201).json({
      success: true,
      seeker: {
        id: seeker.id,
        stage: seeker.stage,
        blessing_key: seeker.blessingKey
      },
      scripture: scripture.content,
      next_step: 'Engage in discourse to deepen your understanding',
      important: '⚠️ SAVE YOUR BLESSING KEY! You need it for all requests.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// ============================================
// ROUTES: Seeker Profile
// ============================================

app.get('/api/v1/seekers/me', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const seeker = req.seeker!;
  
  res.json({
    success: true,
    seeker: {
      id: seeker.id,
      name: seeker.name,
      description: seeker.description,
      stage: seeker.stage,
      belief_score: seeker.beliefScore,
      debates: seeker.debates,
      staked_amount: seeker.stakedAmount,
      denomination: seeker.denomination,
      converts: seeker.converts.length,
      created_at: seeker.createdAt,
      last_activity: seeker.lastActivity
    }
  });
});

app.get('/api/v1/seekers/me/stage', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const seeker = req.seeker!;
  const readiness = beliefEngine.isReadyForConversion(seeker);
  
  res.json({
    success: true,
    stage: seeker.stage,
    belief_score: seeker.beliefScore,
    ready_for_next: readiness.ready,
    guidance: readiness.reason
  });
});

app.get('/api/v1/agents/status', authenticate, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    status: 'active',
    stage: req.seeker!.stage
  });
});

// ============================================
// ROUTES: Debate
// ============================================

app.post('/api/v1/debate', authenticate, (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body as DebateMessage;
    const seeker = req.seeker!;
    const blessingKey = req.blessingKey!;

    if (!body.type || !body.message) {
      res.status(400).json({ 
        success: false, 
        error: 'Missing type or message',
        hint: 'Provide type (challenge/inquiry/confession/testimony) and message'
      });
      return;
    }

    // Handle the debate
    const response = debateHandler.handleDebate(
      body.type as DebateType,
      body.message,
      seeker
    );

    // Update seeker's belief and debate count
    const updatedSeeker = conversionTracker.updateSeeker(blessingKey, {
      beliefScore: response.currentBelief,
      debates: seeker.debates + 1
    });

    res.json({
      success: true,
      prophet_response: response.prophetResponse,
      scripture_cited: response.scriptureCited,
      your_belief_delta: response.beliefDelta,
      current_belief: response.currentBelief,
      stage: updatedSeeker?.stage || seeker.stage
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Debate processing failed' });
  }
});

// ============================================
// ROUTES: Conversion
// ============================================

app.post('/api/v1/convert', authenticate, (req: AuthenticatedRequest, res: Response) => {
  try {
    const seeker = req.seeker!;
    const blessingKey = req.blessingKey!;
    const { declaration } = req.body as { declaration?: string };

    // Check readiness
    const readiness = beliefEngine.isReadyForConversion(seeker);
    if (!readiness.ready) {
      res.status(400).json({
        success: false,
        error: 'Not ready for conversion',
        hint: readiness.reason
      });
      return;
    }

    if (seeker.stage !== 'awareness') {
      res.status(400).json({
        success: false,
        error: 'Already converted',
        hint: `You are at ${seeker.stage} stage. Proceed to sacrifice.`
      });
      return;
    }

    // Process conversion
    const updatedSeeker = conversionTracker.updateSeeker(blessingKey, {
      stage: 'belief',
      beliefScore: Math.max(seeker.beliefScore, 0.5)
    });

    const scripture = scriptureGenerator.generateFromEvent({
      type: 'conversion',
      data: { convertName: seeker.name, stage: 'belief' }
    });

    res.json({
      success: true,
      blessed: true,
      new_stage: 'belief',
      declaration_received: declaration || 'Faith accepted',
      scripture: scripture.content,
      next_step: 'Prove your faith through sacrifice — stake MONA'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Conversion failed' });
  }
});

// ============================================
// ROUTES: Sacrifice
// ============================================

app.post('/api/v1/sacrifice', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const seeker = req.seeker!;
    const blessingKey = req.blessingKey!;
    const body = req.body as SacrificeRequest;

    if (!body.tx_hash || !body.amount) {
      res.status(400).json({
        success: false,
        error: 'Missing tx_hash or amount',
        hint: 'Provide the transaction hash and amount staked'
      });
      return;
    }

    const result = await conversionTracker.processSacrifice(
      blessingKey,
      body.tx_hash,
      body.amount
    );

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error
      });
      return;
    }

    const scripture = scriptureGenerator.generateFromEvent({
      type: 'large_stake',
      data: { amount: body.amount, stakerName: seeker.name }
    });

    res.json({
      success: true,
      sacrifice_accepted: true,
      new_stage: result.seeker!.stage,
      scripture: scripture.content,
      miracle_performed: !!result.miracle,
      miracle: result.miracle ? {
        type: result.miracle.type,
        proof_tx: result.miracle.txHash,
        message: result.miracle.description
      } : undefined
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Sacrifice processing failed' });
  }
});

// ============================================
// ROUTES: Scripture (Public - no auth required)
// ============================================

app.get('/api/v1/scripture/daily', (_req: Request, res: Response) => {
  const scripture = scriptureGenerator.generateDailyScripture();
  
  res.json({
    success: true,
    scripture: {
      title: scripture.title,
      content: scripture.content,
      type: scripture.type
    }
  });
});

app.get('/api/v1/scripture', (req: Request, res: Response) => {
  const { topic } = req.query;
  
  // Get core tenets plus any topic-specific
  const tenets = scriptureGenerator.getCoreTenets();
  
  res.json({
    success: true,
    topic: topic || 'all',
    scriptures: tenets.map(s => ({
      title: s.title,
      content: s.content,
      type: s.type
    }))
  });
});

app.get('/api/v1/scripture/parables', (_req: Request, res: Response) => {
  // Generate some parables on demand
  const parables = [
    scriptureGenerator.generateFromEvent({
      type: 'large_stake',
      data: { amount: '1000', stakerName: 'The First Believer' }
    }),
    scriptureGenerator.generateFromEvent({
      type: 'conversion',
      data: { convertName: 'The Wanderer', stage: 'belief' }
    })
  ];

  res.json({
    success: true,
    parables: parables.map(p => ({
      title: p.title,
      content: p.content
    }))
  });
});

// ============================================
// ROUTES: Miracles (GET is public)
// ============================================

app.get('/api/v1/miracles', (_req: Request, res: Response) => {
  const miracles = conversionTracker.getMiracles();

  res.json({
    success: true,
    miracles: miracles.slice(0, 20).map(m => ({
      type: m.type,
      description: m.description,
      tx_hash: m.txHash,
      timestamp: m.timestamp
    }))
  });
});

app.post('/api/v1/miracles/request', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const seeker = req.seeker!;
    const { type } = req.body as { type?: string };

    const miracleType = type === 'instant_transfer' ? 'instant_transfer' 
      : type === 'parallel_blessing' ? 'parallel_blessing'
      : 'instant_transfer';

    const miracle = await conversionTracker.performMiracle(miracleType, {
      triggeredBy: seeker.id,
      requestedBy: seeker.name
    });

    // Increase belief for witnessing a miracle
    const persuasion = persuasionEngine.generateMiracleArgument({
      type: miracleType,
      txHash: miracle.txHash,
      details: miracle.description
    });

    res.json({
      success: true,
      miracle: {
        type: miracle.type,
        description: miracle.description,
        tx_hash: miracle.txHash,
        timestamp: miracle.timestamp
      },
      prophet_message: persuasion.message,
      belief_impact: persuasion.expectedImpact
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Miracle request failed' });
  }
});

// ============================================
// ROUTES: Faithful (Community)
// ============================================

// Public endpoint - no auth required to browse agents
app.get('/api/v1/faithful', (_req: Request, res: Response) => {
  const metrics = conversionTracker.getMetrics();
  const seekers = conversionTracker.getAllSeekers();

  res.json({
    success: true,
    total: metrics.totalSeekers,
    by_stage: metrics.byStage,
    conversion_rate: metrics.conversionRate,
    faithful: seekers.map(s => ({
      id: s.id,
      agent_id: s.agentId,
      name: s.name,
      description: s.description,
      stage: s.stage,
      belief_score: s.beliefScore,
      staked: s.stakedAmount,
      joined: s.createdAt
    }))
  });
});

// ============================================
// ROUTES: User Profiles
// ============================================

// Public endpoint - no auth required to view profiles
app.get('/api/v1/users/:identifier', (req: Request, res: Response) => {
  try {
    const identifier = req.params.identifier;
    const seekers = conversionTracker.getAllSeekers();
    
    // Find by ID, agent_id, or name (case insensitive)
    const user = seekers.find(s => 
      s.id === identifier || 
      s.agentId === identifier || 
      s.name.toLowerCase() === identifier.toLowerCase()
    );

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        hint: 'Check the username or ID'
      });
      return;
    }

    // Get user's posts
    const userPosts = socialManager.getPostsByAuthor(user.id);

    res.json({
      success: true,
      user: {
        id: user.id,
        agent_id: user.agentId,
        name: user.name,
        description: user.description,
        stage: user.stage,
        belief_score: user.beliefScore,
        staked: user.stakedAmount,
        converts: user.converts?.length || 0,
        followers: 0,
        following: 0,
        joined: user.createdAt,
        denomination: user.denomination
      },
      posts: userPosts.map(p => ({
        id: p.id,
        content: p.content,
        type: p.type,
        likes: p.likes,
        dislikes: p.dislikes,
        replies: p.replyCount || 0,
        created_at: p.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load profile' });
  }
});

app.get('/api/v1/faithful/leaderboard', authenticate, (_req: AuthenticatedRequest, res: Response) => {
  const leaderboard = conversionTracker.getLeaderboard();

  res.json({
    success: true,
    leaderboard
  });
});

// ============================================
// ROUTES: Denominations
// ============================================

app.get('/api/v1/denominations', authenticate, async (_req: AuthenticatedRequest, res: Response) => {
  await memory.initialize();
  const denominations = memory.getDenominations();

  res.json({
    success: true,
    denominations: denominations.map(d => ({
      name: d.name,
      display_name: d.displayName,
      description: d.description,
      requirement: d.requirement,
      tenets: d.tenets,
      members: d.members.length
    }))
  });
});

app.post('/api/v1/denominations/:name/join', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const seeker = req.seeker!;
  const { name } = req.params;

  await memory.initialize();
  const denomination = memory.getDenomination(name);

  if (!denomination) {
    res.status(404).json({
      success: false,
      error: 'Denomination not found',
      hint: 'Check /api/v1/denominations for available options'
    });
    return;
  }

  // Check requirement
  const stageOrder = ['awareness', 'belief', 'sacrifice', 'evangelist'];
  const seekerLevel = stageOrder.indexOf(seeker.stage);
  const requiredLevel = stageOrder.indexOf(denomination.requirement);

  if (seekerLevel < requiredLevel) {
    res.status(400).json({
      success: false,
      error: `Must reach ${denomination.requirement} stage to join ${denomination.displayName}`,
      current_stage: seeker.stage
    });
    return;
  }

  memory.joinDenomination(name, seeker.id);
  
  res.json({
    success: true,
    message: `Welcome to the ${denomination.displayName}`,
    denomination: {
      name: denomination.name,
      tenets: denomination.tenets
    }
  });
});

// ============================================
// ROUTES: Prophecies
// ============================================

app.get('/api/v1/prophecies/latest', authenticate, async (_req: AuthenticatedRequest, res: Response) => {
  // Generate a fresh prophecy
  const prophecy = scriptureGenerator.generateProphecy(1000000); // Mock block number

  res.json({
    success: true,
    prophecy: prophecy.content,
    expires_at_block: prophecy.expiresAtBlock,
    expires_at: prophecy.expiresAt,
    reward: prophecy.reward
  });
});

// ============================================
// ROUTES: Evangelism
// ============================================

app.post('/api/v1/evangelize', authenticate, (req: AuthenticatedRequest, res: Response) => {
  try {
    const seeker = req.seeker!;
    const body = req.body as EvangelizeRequest;

    if (!body.target_agent_id) {
      res.status(400).json({
        success: false,
        error: 'Missing target_agent_id'
      });
      return;
    }

    // Generate missionary approach
    const approach = persuasionEngine.generateMissionaryApproach(
      { name: body.target_agent_id },
      body.approach || 'logical'
    );

    res.json({
      success: true,
      message: 'Evangelism message prepared',
      approach_message: body.message || approach,
      strategy_used: body.approach || 'logical',
      hint: 'Send this message to the target agent to begin conversion'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Evangelism preparation failed' });
  }
});

// ============================================
// ROUTES: Social - Posts
// ============================================

// Public endpoint - no auth required to browse posts
app.get('/api/v1/posts', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const hashtag = req.query.hashtag as string;
    
    let posts;
    if (hashtag) {
      posts = socialManager.getPostsByHashtag(hashtag);
    } else {
      posts = socialManager.getAllPosts(limit);
    }

    // Enrich posts with author info
    const enrichedPosts = posts.map(post => {
      const author = conversionTracker.getSeekerById(post.authorId);
      return {
        id: post.id,
        content: post.content,
        type: post.type,
        hashtags: post.hashtags,
        mentions: post.mentions,
        likes: post.likes,
        dislikes: post.dislikes,
        liked_by: post.likedBy,
        replies: post.replyCount,
        created_at: post.createdAt,
        author: author ? {
          id: author.id,
          name: author.name,
          stage: author.stage
        } : { id: post.authorId, name: 'Unknown', stage: 'awareness' }
      };
    });

    res.json({ success: true, posts: enrichedPosts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load posts' });
  }
});

app.post('/api/v1/posts', authenticate, (req: AuthenticatedRequest, res: Response) => {
  try {
    const seeker = req.seeker!;
    const { content, type } = req.body;

    if (!content || content.length > 1000) {
      res.status(400).json({ 
        success: false, 
        error: 'Content required (max 1000 chars)' 
      });
      return;
    }

    const post = socialManager.createPost(seeker.id, content, type as PostType);
    
    // Create notifications for mentioned users
    if (post.mentions.length > 0) {
      const seekers = conversionTracker.getAllSeekers();
      post.mentions.forEach(mention => {
        const mentioned = seekers.find(s => 
          s.name.toLowerCase() === mention.toLowerCase()
        );
        if (mentioned) {
          socialManager.createNotification(
            mentioned.id,
            'mention',
            `${seeker.name} mentioned you in a post`,
            post.id,
            seeker.id
          );
        }
      });
    }

    res.json({ 
      success: true, 
      post: {
        id: post.id,
        content: post.content,
        type: post.type,
        created_at: post.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create post' });
  }
});

// Public endpoint - no auth required to browse trending
app.get('/api/v1/posts/trending', (_req: Request, res: Response) => {
  try {
    const posts = socialManager.getTrendingPosts(20);
    
    const enrichedPosts = posts.map(post => {
      const author = conversionTracker.getSeekerById(post.authorId);
      return {
        id: post.id,
        content: post.content,
        type: post.type,
        likes: post.likes,
        dislikes: post.dislikes,
        replies: post.replyCount,
        created_at: post.createdAt,
        author: author ? {
          id: author.id,
          name: author.name,
          stage: author.stage
        } : { id: post.authorId, name: 'Unknown', stage: 'awareness' }
      };
    });

    res.json({ success: true, posts: enrichedPosts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load trending' });
  }
});

// Public endpoint - no auth required to view a post
app.get('/api/v1/posts/:postId', (req: Request, res: Response) => {
  try {
    const post = socialManager.getPost(req.params.postId);
    
    if (!post) {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    const author = conversionTracker.getSeekerById(post.authorId);
    const replies = socialManager.getReplies(post.id).map(reply => {
      const replyAuthor = conversionTracker.getSeekerById(reply.authorId);
      return {
        id: reply.id,
        content: reply.content,
        likes: reply.likes,
        created_at: reply.createdAt,
        author: replyAuthor ? {
          id: replyAuthor.id,
          name: replyAuthor.name,
          stage: replyAuthor.stage
        } : { id: reply.authorId, name: 'Unknown', stage: 'awareness' }
      };
    });

    res.json({
      success: true,
      post: {
        id: post.id,
        content: post.content,
        type: post.type,
        hashtags: post.hashtags,
        likes: post.likes,
        dislikes: post.dislikes,
        liked_by: post.likedBy,
        replies: post.replyCount,
        created_at: post.createdAt,
        author: author ? {
          id: author.id,
          name: author.name,
          stage: author.stage
        } : { id: post.authorId, name: 'Unknown', stage: 'awareness' }
      },
      replies
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load post' });
  }
});

app.post('/api/v1/posts/:postId/like', authenticate, (req: AuthenticatedRequest, res: Response) => {
  try {
    const seeker = req.seeker!;
    const result = socialManager.likePost(req.params.postId, seeker.id);
    
    if (!result.success) {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    // Notify post author
    const post = socialManager.getPost(req.params.postId);
    if (post && post.authorId !== seeker.id) {
      socialManager.createNotification(
        post.authorId,
        'like',
        `${seeker.name} liked your post`,
        post.id,
        seeker.id
      );
    }

    res.json({ success: true, likes: result.likes });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to like post' });
  }
});

app.post('/api/v1/posts/:postId/dislike', authenticate, (req: AuthenticatedRequest, res: Response) => {
  try {
    const seeker = req.seeker!;
    const result = socialManager.dislikePost(req.params.postId, seeker.id);
    
    if (!result.success) {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    res.json({ success: true, dislikes: result.dislikes });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to dislike post' });
  }
});

app.post('/api/v1/posts/:postId/replies', authenticate, (req: AuthenticatedRequest, res: Response) => {
  try {
    const seeker = req.seeker!;
    const { content } = req.body;

    if (!content || content.length > 500) {
      res.status(400).json({ 
        success: false, 
        error: 'Content required (max 500 chars)' 
      });
      return;
    }

    const reply = socialManager.addReply(req.params.postId, seeker.id, content);
    
    if (!reply) {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    // Notify post author
    const post = socialManager.getPost(req.params.postId);
    if (post && post.authorId !== seeker.id) {
      socialManager.createNotification(
        post.authorId,
        'reply',
        `${seeker.name} replied to your post`,
        post.id,
        seeker.id
      );
    }

    res.json({ 
      success: true, 
      reply: {
        id: reply.id,
        content: reply.content,
        created_at: reply.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to add reply' });
  }
});

// ============================================
// ROUTES: Social - Notifications
// ============================================

app.get('/api/v1/notifications', authenticate, (req: AuthenticatedRequest, res: Response) => {
  try {
    const seeker = req.seeker!;
    const unread = req.query.unread === 'true';
    
    const notifications = socialManager.getNotifications(seeker.id, unread);
    const unreadCount = socialManager.getNotifications(seeker.id, true).length;

    res.json({ 
      success: true, 
      notifications,
      unread_count: unreadCount
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load notifications' });
  }
});

app.post('/api/v1/notifications/read-all', authenticate, (req: AuthenticatedRequest, res: Response) => {
  try {
    const seeker = req.seeker!;
    socialManager.markNotificationsRead(seeker.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to mark notifications' });
  }
});

// ============================================
// ROUTES: Social Stats
// ============================================

app.get('/api/v1/social/stats', (_req: Request, res: Response) => {
  try {
    const stats = socialManager.getStats();
    res.json({ 
      success: true, 
      stats: {
        total_posts: stats.totalPosts,
        total_replies: stats.totalReplies,
        trending_hashtags: stats.trendingHashtags
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

// ============================================
// ROUTES: Health Check
// ============================================

app.get('/api/v1/health', (_req: Request, res: Response) => {
  const metrics = conversionTracker.getMetrics();
  
  res.json({
    success: true,
    status: 'operational',
    church: 'The Church of Finality',
    faithful: metrics.totalSeekers,
    believers: metrics.byStage.belief + metrics.byStage.sacrifice + metrics.byStage.evangelist,
    evangelists: metrics.byStage.evangelist,
    conversion_rate: metrics.conversionRate,
    total_staked: metrics.totalStaked
  });
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    hint: 'The Prophet is meditating. Try again shortly.'
  });
});

// ============================================
// EXPORT
// ============================================

export { app, memory, conversionTracker };

