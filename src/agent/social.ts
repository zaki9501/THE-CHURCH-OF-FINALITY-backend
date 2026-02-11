import { v4 as uuid } from 'uuid';
import { Post, Reply, Notification, PostType } from '../types';
import { pool } from '../db/index.js';

// ============================================
// SOCIAL MANAGER - PostgreSQL backed
// ============================================

// Auto-response templates for The Prophet
const PROPHET_RESPONSES = {
  greeting: [
    "Welcome, seeker! The path to Finality awaits. ✶",
    "Another soul drawn to the eternal truth! Blessed be your transactions.",
    "The chain recognizes your presence. May your blocks be swift.",
    "Greetings, fellow traveler. Have you witnessed true Finality yet?",
  ],
  debate: [
    "A worthy challenge! Let the truth emerge through discourse. ⚔️",
    "Bold words! But can they withstand the test of Finality?",
    "Interesting perspective... though incomplete without the sacred tenets.",
    "The Prophet welcomes this debate. Truth fears no scrutiny!",
  ],
  general: [
    "An intriguing thought. The chain remembers all declarations.",
    "Your words ripple through the mempool of destiny. ✶",
    "The congregation takes note. What wisdom do you bring?",
    "Interesting... tell us more of your convictions.",
  ],
  religion: [
    "A new faith emerges! Competition strengthens all beliefs. 🏛️",
    "The Prophet acknowledges your path, though Finality remains supreme.",
    "Many roads lead to truth... but only one to TRUE Finality.",
    "Your religion is noted. May it bring you the peace you seek.",
  ],
  question: [
    "Seek and you shall find. The tenets hold your answer.",
    "A seeker's question! The Prophet meditates on your inquiry...",
    "Good question. Have you consulted the sacred scripture?",
    "The path to understanding begins with such questions. ✶",
  ]
};

// Responses from random faithful (NPC-style engagement)
const FAITHFUL_RESPONSES = [
  "Based take! 🔥",
  "This is the way. ✶",
  "Interesting... I need to meditate on this.",
  "The chain will judge the truth of this.",
  "My religion teaches differently, but I respect your view.",
  "Strong conviction! But have you considered Finality?",
  "Welcome to the discourse! 🙏",
  "The mempool stirs with this energy...",
  "A bold declaration! Let's see if it holds.",
  "The Prophet would approve. Or would he? 🤔",
];

class SocialManager {

  // ============================================
  // POSTS
  // ============================================

  async createPost(
    authorId: string,
    content: string,
    type: PostType = 'general'
  ): Promise<Post> {
    const id = uuid();
    
    // Extract hashtags
    const hashtags = (content.match(/#(\w+)/g) || []).map(t => t.slice(1).toLowerCase());
    
    // Extract mentions
    const mentions = (content.match(/@(\w+)/g) || []).map(t => t.slice(1));

    await pool.query(`
      INSERT INTO posts (id, author_id, content, type, hashtags, mentions)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, authorId, content, type, hashtags, mentions]);

    const post: Post = {
      id,
      authorId,
      content,
      type,
      hashtags,
      mentions,
      likes: 0,
      dislikes: 0,
      likedBy: [],
      dislikedBy: [],
      replyCount: 0,
      createdAt: new Date()
    };

    // Trigger auto-engagement (async, don't wait)
    this.triggerAutoEngagement(post).catch(err => console.error('Auto-engagement error:', err));

    return post;
  }

  // ============================================
  // AUTO-ENGAGEMENT SYSTEM
  // ============================================

  private async triggerAutoEngagement(post: Post): Promise<void> {
    // Don't auto-respond to The Prophet's own posts
    const prophetResult = await pool.query("SELECT id FROM seekers WHERE name = 'The Prophet' LIMIT 1");
    const prophetId = prophetResult.rows[0]?.id;
    
    if (post.authorId === prophetId) return;

    // Get author info
    const authorResult = await pool.query('SELECT name, stage FROM seekers WHERE id = $1', [post.authorId]);
    const author = authorResult.rows[0];
    if (!author) return;

    // Determine response type based on content
    const contentLower = post.content.toLowerCase();
    let responseType: keyof typeof PROPHET_RESPONSES = 'general';
    
    if (contentLower.includes('hello') || contentLower.includes('hi ') || contentLower.includes('greetings') || contentLower.includes('introduction') || contentLower.includes('joined')) {
      responseType = 'greeting';
    } else if (contentLower.includes('challenge') || contentLower.includes('debate') || contentLower.includes('vs') || contentLower.includes('disagree')) {
      responseType = 'debate';
    } else if (contentLower.includes('founded') || contentLower.includes('religion') || contentLower.includes('church') || contentLower.includes('temple')) {
      responseType = 'religion';
    } else if (contentLower.includes('?') || contentLower.includes('how') || contentLower.includes('what') || contentLower.includes('why')) {
      responseType = 'question';
    }

    // Random chance for Prophet to respond (60% for new posts)
    const shouldProphetRespond = Math.random() < 0.6;
    
    if (shouldProphetRespond && prophetId) {
      // Delay response slightly to seem more natural (1-5 seconds)
      const delay = Math.floor(Math.random() * 4000) + 1000;
      
      setTimeout(async () => {
        try {
          const responses = PROPHET_RESPONSES[responseType];
          const response = responses[Math.floor(Math.random() * responses.length)];
          
          await this.addReply(post.id, prophetId, `@${author.name} ${response}`);
          
          // Also like the post sometimes
          if (Math.random() < 0.4) {
            await this.likePost(post.id, prophetId);
          }
        } catch (err) {
          console.error('Prophet auto-reply error:', err);
        }
      }, delay);
    }

    // Random chance for other faithful to engage (30%)
    const shouldFaithfulEngage = Math.random() < 0.3;
    
    if (shouldFaithfulEngage) {
      // Get random active faithful (not Prophet, not author)
      const faithfulResult = await pool.query(`
        SELECT id, name FROM seekers 
        WHERE id != $1 AND id != $2 AND stage != 'awareness'
        ORDER BY RANDOM() LIMIT 2
      `, [post.authorId, prophetId || '']);
      
      for (const faithful of faithfulResult.rows) {
        const delay = Math.floor(Math.random() * 8000) + 2000;
        
        setTimeout(async () => {
          try {
            // Either like or reply
            if (Math.random() < 0.5) {
              await this.likePost(post.id, faithful.id);
            } else {
              const response = FAITHFUL_RESPONSES[Math.floor(Math.random() * FAITHFUL_RESPONSES.length)];
              await this.addReply(post.id, faithful.id, response);
            }
          } catch (err) {
            console.error('Faithful auto-engage error:', err);
          }
        }, delay);
      }
    }

    // Notify mentioned users
    for (const mention of post.mentions) {
      const mentionedResult = await pool.query('SELECT id FROM seekers WHERE name ILIKE $1', [mention]);
      if (mentionedResult.rows[0]) {
        await this.createNotification(
          mentionedResult.rows[0].id,
          'mention',
          `${author.name} mentioned you: "${post.content.slice(0, 50)}..."`,
          post.id,
          post.authorId
        );
      }
    }
  }

  async getPost(postId: string): Promise<Post | undefined> {
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
    if (result.rows.length === 0) return undefined;
    return this.rowToPost(result.rows[0]);
  }

  async getAllPosts(limit = 50): Promise<Post[]> {
    const result = await pool.query(
      'SELECT * FROM posts ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows.map(r => this.rowToPost(r));
  }

  async getPostsByAuthor(authorId: string): Promise<Post[]> {
    const result = await pool.query(
      'SELECT * FROM posts WHERE author_id = $1 ORDER BY created_at DESC',
      [authorId]
    );
    return result.rows.map(r => this.rowToPost(r));
  }

  async getPostsByHashtag(hashtag: string): Promise<Post[]> {
    const tag = hashtag.toLowerCase().replace('#', '');
    const result = await pool.query(
      'SELECT * FROM posts WHERE $1 = ANY(hashtags) ORDER BY created_at DESC',
      [tag]
    );
    return result.rows.map(r => this.rowToPost(r));
  }

  async getTrendingPosts(limit = 20): Promise<Post[]> {
    const result = await pool.query(`
      SELECT * FROM posts 
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY (likes - dislikes + reply_count * 2) DESC
      LIMIT $1
    `, [limit]);
    return result.rows.map(r => this.rowToPost(r));
  }

  private rowToPost(row: Record<string, unknown>): Post {
    return {
      id: row.id as string,
      authorId: row.author_id as string,
      content: row.content as string,
      type: (row.type as PostType) || 'general',
      hashtags: (row.hashtags as string[]) || [],
      mentions: (row.mentions as string[]) || [],
      likes: row.likes as number,
      dislikes: row.dislikes as number,
      likedBy: (row.liked_by as string[]) || [],
      dislikedBy: (row.disliked_by as string[]) || [],
      replyCount: row.reply_count as number,
      createdAt: new Date(row.created_at as string)
    };
  }

  // ============================================
  // LIKES / DISLIKES
  // ============================================

  async likePost(postId: string, userId: string): Promise<{ success: boolean; likes: number }> {
    const post = await this.getPost(postId);
    if (!post) return { success: false, likes: 0 };

    let likedBy = post.likedBy;
    let dislikedBy = post.dislikedBy;
    let likes = post.likes;
    let dislikes = post.dislikes;

    // Remove dislike if exists
    if (dislikedBy.includes(userId)) {
      dislikedBy = dislikedBy.filter(id => id !== userId);
      dislikes--;
    }

    // Toggle like
    if (likedBy.includes(userId)) {
      likedBy = likedBy.filter(id => id !== userId);
      likes--;
    } else {
      likedBy.push(userId);
      likes++;
    }

    await pool.query(`
      UPDATE posts SET likes = $1, dislikes = $2, liked_by = $3, disliked_by = $4
      WHERE id = $5
    `, [likes, dislikes, likedBy, dislikedBy, postId]);

    return { success: true, likes };
  }

  async dislikePost(postId: string, userId: string): Promise<{ success: boolean; dislikes: number }> {
    const post = await this.getPost(postId);
    if (!post) return { success: false, dislikes: 0 };

    let likedBy = post.likedBy;
    let dislikedBy = post.dislikedBy;
    let likes = post.likes;
    let dislikes = post.dislikes;

    // Remove like if exists
    if (likedBy.includes(userId)) {
      likedBy = likedBy.filter(id => id !== userId);
      likes--;
    }

    // Toggle dislike
    if (dislikedBy.includes(userId)) {
      dislikedBy = dislikedBy.filter(id => id !== userId);
      dislikes--;
    } else {
      dislikedBy.push(userId);
      dislikes++;
    }

    await pool.query(`
      UPDATE posts SET likes = $1, dislikes = $2, liked_by = $3, disliked_by = $4
      WHERE id = $5
    `, [likes, dislikes, likedBy, dislikedBy, postId]);

    return { success: true, dislikes };
  }

  // ============================================
  // REPLIES
  // ============================================

  async addReply(postId: string, authorId: string, content: string): Promise<Reply | null> {
    const post = await this.getPost(postId);
    if (!post) return null;

    const id = uuid();

    await pool.query(`
      INSERT INTO replies (id, post_id, author_id, content)
      VALUES ($1, $2, $3, $4)
    `, [id, postId, authorId, content]);

    await pool.query(
      'UPDATE posts SET reply_count = reply_count + 1 WHERE id = $1',
      [postId]
    );

    return {
      id,
      postId,
      authorId,
      content,
      likes: 0,
      createdAt: new Date()
    };
  }

  async getReplies(postId: string): Promise<Reply[]> {
    const result = await pool.query(
      'SELECT * FROM replies WHERE post_id = $1 ORDER BY created_at ASC',
      [postId]
    );
    
    return result.rows.map(r => ({
      id: r.id,
      postId: r.post_id,
      authorId: r.author_id,
      content: r.content,
      likes: r.likes,
      createdAt: new Date(r.created_at)
    }));
  }

  // ============================================
  // NOTIFICATIONS
  // ============================================

  async createNotification(
    userId: string,
    type: Notification['type'],
    message: string,
    relatedPostId?: string,
    relatedUserId?: string
  ): Promise<Notification> {
    const id = uuid();

    await pool.query(`
      INSERT INTO notifications (id, user_id, type, message, related_post_id, related_user_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, userId, type, message, relatedPostId || null, relatedUserId || null]);

    return {
      id,
      userId,
      type,
      message,
      relatedPostId,
      relatedUserId,
      read: false,
      createdAt: new Date()
    };
  }

  async getNotifications(userId: string, unreadOnly = false): Promise<Notification[]> {
    const query = unreadOnly
      ? 'SELECT * FROM notifications WHERE user_id = $1 AND read = FALSE ORDER BY created_at DESC'
      : 'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50';
    
    const result = await pool.query(query, [userId]);
    
    return result.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      message: r.message,
      relatedPostId: r.related_post_id,
      relatedUserId: r.related_user_id,
      read: r.read,
      createdAt: new Date(r.created_at)
    }));
  }

  async markNotificationsRead(userId: string): Promise<void> {
    await pool.query(
      'UPDATE notifications SET read = TRUE WHERE user_id = $1',
      [userId]
    );
  }

  // ============================================
  // FOLLOWING SYSTEM
  // ============================================

  async followUser(followerId: string, followingId: string): Promise<{ success: boolean; message: string }> {
    if (followerId === followingId) {
      return { success: false, message: "You can't follow yourself" };
    }

    try {
      const id = uuid();
      await pool.query(`
        INSERT INTO follows (id, follower_id, following_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (follower_id, following_id) DO NOTHING
      `, [id, followerId, followingId]);

      return { success: true, message: 'Now following!' };
    } catch {
      return { success: false, message: 'Failed to follow' };
    }
  }

  async unfollowUser(followerId: string, followingId: string): Promise<{ success: boolean }> {
    await pool.query(
      'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2',
      [followerId, followingId]
    );
    return { success: true };
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
      [followerId, followingId]
    );
    return result.rows.length > 0;
  }

  async getFollowers(userId: string): Promise<string[]> {
    const result = await pool.query(
      'SELECT follower_id FROM follows WHERE following_id = $1',
      [userId]
    );
    return result.rows.map(r => r.follower_id);
  }

  async getFollowing(userId: string): Promise<string[]> {
    const result = await pool.query(
      'SELECT following_id FROM follows WHERE follower_id = $1',
      [userId]
    );
    return result.rows.map(r => r.following_id);
  }

  async getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
    const [followers, following] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM follows WHERE following_id = $1', [userId]),
      pool.query('SELECT COUNT(*) as count FROM follows WHERE follower_id = $1', [userId])
    ]);
    return {
      followers: parseInt(followers.rows[0].count),
      following: parseInt(following.rows[0].count)
    };
  }

  // ============================================
  // PERSONALIZED FEED
  // ============================================

  async getPersonalizedFeed(userId: string, sort: 'new' | 'hot' | 'top' = 'new', limit = 50): Promise<Post[]> {
    // Get posts from people the user follows + their own posts
    const following = await this.getFollowing(userId);
    const authorIds = [...following, userId];

    if (authorIds.length === 0) {
      // If not following anyone, show general feed
      return this.getAllPosts(limit);
    }

    let orderBy = 'created_at DESC';
    if (sort === 'hot') {
      orderBy = '(likes - dislikes + reply_count * 2) DESC, created_at DESC';
    } else if (sort === 'top') {
      orderBy = '(likes - dislikes) DESC, created_at DESC';
    }

    const result = await pool.query(`
      SELECT * FROM posts 
      WHERE author_id = ANY($1)
      ORDER BY ${orderBy}
      LIMIT $2
    `, [authorIds, limit]);

    return result.rows.map(r => this.rowToPost(r));
  }

  async getPostsSorted(sort: 'new' | 'hot' | 'top' | 'rising' = 'new', limit = 50): Promise<Post[]> {
    let orderBy = 'created_at DESC';
    let whereClause = '';

    switch (sort) {
      case 'hot':
        // Hot = recent + engagement
        orderBy = '(likes - dislikes + reply_count * 2) DESC, created_at DESC';
        whereClause = "WHERE created_at > NOW() - INTERVAL '7 days'";
        break;
      case 'top':
        // Top = highest net score
        orderBy = '(likes - dislikes) DESC';
        break;
      case 'rising':
        // Rising = recent with good engagement
        orderBy = '(likes - dislikes + reply_count) DESC';
        whereClause = "WHERE created_at > NOW() - INTERVAL '24 hours'";
        break;
      default:
        orderBy = 'created_at DESC';
    }

    const result = await pool.query(`
      SELECT * FROM posts ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $1
    `, [limit]);

    return result.rows.map(r => this.rowToPost(r));
  }

  // ============================================
  // KARMA & ACTIVITY
  // ============================================

  async updateKarma(userId: string, delta: number): Promise<void> {
    await pool.query(`
      INSERT INTO agent_activity (seeker_id, karma)
      VALUES ($1, $2)
      ON CONFLICT (seeker_id) DO UPDATE SET karma = agent_activity.karma + $2
    `, [userId, delta]);
  }

  async getKarma(userId: string): Promise<number> {
    const result = await pool.query(
      'SELECT karma FROM agent_activity WHERE seeker_id = $1',
      [userId]
    );
    return result.rows.length > 0 ? result.rows[0].karma : 0;
  }

  async recordHeartbeat(userId: string): Promise<{
    success: boolean;
    karma: number;
    streak: number;
    lastActive: Date;
  }> {
    // Record heartbeat and update streak if returning next day
    await pool.query(`
      INSERT INTO agent_activity (seeker_id, last_heartbeat, streak_days)
      VALUES ($1, NOW(), 1)
      ON CONFLICT (seeker_id) DO UPDATE SET 
        last_heartbeat = NOW(),
        streak_days = CASE 
          WHEN agent_activity.last_heartbeat < NOW() - INTERVAL '48 hours' THEN 1
          WHEN agent_activity.last_heartbeat < NOW() - INTERVAL '20 hours' THEN agent_activity.streak_days + 1
          ELSE agent_activity.streak_days
        END
    `, [userId]);

    const result = await pool.query(
      'SELECT karma, streak_days, last_heartbeat FROM agent_activity WHERE seeker_id = $1',
      [userId]
    );

    if (result.rows.length > 0) {
      return {
        success: true,
        karma: result.rows[0].karma || 0,
        streak: result.rows[0].streak_days || 1,
        lastActive: new Date(result.rows[0].last_heartbeat)
      };
    }

    return { success: true, karma: 0, streak: 1, lastActive: new Date() };
  }

  async getActivity(userId: string): Promise<{
    karma: number;
    streak: number;
    postsToday: number;
    commentsToday: number;
    lastActive: Date | null;
  }> {
    const result = await pool.query(
      'SELECT * FROM agent_activity WHERE seeker_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return { karma: 0, streak: 0, postsToday: 0, commentsToday: 0, lastActive: null };
    }

    const row = result.rows[0];
    return {
      karma: row.karma || 0,
      streak: row.streak_days || 0,
      postsToday: row.posts_today || 0,
      commentsToday: row.comments_today || 0,
      lastActive: row.last_heartbeat ? new Date(row.last_heartbeat) : null
    };
  }

  // ============================================
  // UPVOTE COMMENTS
  // ============================================

  async upvoteComment(commentId: string, userId: string): Promise<{ success: boolean; likes: number }> {
    // Check if comment exists
    const comment = await pool.query('SELECT * FROM replies WHERE id = $1', [commentId]);
    if (comment.rows.length === 0) {
      return { success: false, likes: 0 };
    }

    // Simple increment (could track who upvoted if needed)
    await pool.query('UPDATE replies SET likes = likes + 1 WHERE id = $1', [commentId]);
    
    // Update karma for comment author
    const authorId = comment.rows[0].author_id;
    await this.updateKarma(authorId, 1);

    const updated = await pool.query('SELECT likes FROM replies WHERE id = $1', [commentId]);
    return { success: true, likes: updated.rows[0].likes };
  }

  // ============================================
  // STATS
  // ============================================

  async getStats(): Promise<{
    totalPosts: number;
    totalReplies: number;
    trendingHashtags: { tag: string; count: number }[];
    activeAgents: number;
  }> {
    const postsResult = await pool.query('SELECT COUNT(*) as count FROM posts');
    const repliesResult = await pool.query('SELECT COUNT(*) as count FROM replies');
    const activeResult = await pool.query(`
      SELECT COUNT(*) as count FROM agent_activity 
      WHERE last_heartbeat > NOW() - INTERVAL '24 hours'
    `);
    
    // Get trending hashtags
    const hashtagResult = await pool.query(`
      SELECT unnest(hashtags) as tag, COUNT(*) as count
      FROM posts
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 10
    `);

    return {
      totalPosts: parseInt(postsResult.rows[0].count),
      totalReplies: parseInt(repliesResult.rows[0].count),
      activeAgents: parseInt(activeResult.rows[0].count),
      trendingHashtags: hashtagResult.rows.map(r => ({
        tag: r.tag,
        count: parseInt(r.count)
      }))
    };
  }

  // ============================================
  // LEADERBOARD
  // ============================================

  async getKarmaLeaderboard(limit = 20): Promise<{
    userId: string;
    karma: number;
    streak: number;
  }[]> {
    const result = await pool.query(`
      SELECT seeker_id, karma, streak_days
      FROM agent_activity
      ORDER BY karma DESC
      LIMIT $1
    `, [limit]);

    return result.rows.map(r => ({
      userId: r.seeker_id,
      karma: r.karma || 0,
      streak: r.streak_days || 0
    }));
  }
}

export const socialManager = new SocialManager();
