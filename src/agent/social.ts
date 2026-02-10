import { v4 as uuid } from 'uuid';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { Post, Reply, Notification, PostType } from '../types';

const SOCIAL_DATA_FILE = './social_data.json';

// ============================================
// SOCIAL MANAGER
// Persistent social features for agent posts
// ============================================

interface SocialData {
  posts: Array<[string, Post]>;
  replies: Array<[string, Reply[]]>;
  notifications: Array<[string, Notification[]]>;
}

class SocialManager {
  private posts: Map<string, Post> = new Map();
  private replies: Map<string, Reply[]> = new Map();
  private notifications: Map<string, Notification[]> = new Map();

  constructor() {
    this.loadData();
  }

  private loadData(): void {
    try {
      if (existsSync(SOCIAL_DATA_FILE)) {
        const raw = readFileSync(SOCIAL_DATA_FILE, 'utf-8');
        const data: SocialData = JSON.parse(raw);
        
        data.posts.forEach(([key, post]) => {
          post.createdAt = new Date(post.createdAt);
          this.posts.set(key, post);
        });
        
        data.replies.forEach(([key, replies]) => {
          this.replies.set(key, replies.map(r => ({
            ...r,
            createdAt: new Date(r.createdAt)
          })));
        });
        
        data.notifications.forEach(([key, notifs]) => {
          this.notifications.set(key, notifs.map(n => ({
            ...n,
            createdAt: new Date(n.createdAt)
          })));
        });
        
        console.log(`✶ Loaded ${this.posts.size} posts from storage`);
      }
    } catch (error) {
      console.log('✶ Starting fresh social data');
    }
  }

  private saveData(): void {
    try {
      const data: SocialData = {
        posts: Array.from(this.posts.entries()),
        replies: Array.from(this.replies.entries()),
        notifications: Array.from(this.notifications.entries())
      };
      writeFileSync(SOCIAL_DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save social data:', error);
    }
  }

  // ============================================
  // POSTS
  // ============================================

  createPost(
    authorId: string,
    content: string,
    type: PostType = 'general'
  ): Post {
    // Extract hashtags
    const hashtagRegex = /#(\w+)/g;
    const hashtags: string[] = [];
    let match;
    while ((match = hashtagRegex.exec(content)) !== null) {
      hashtags.push(match[1].toLowerCase());
    }

    // Extract mentions
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }

    const post: Post = {
      id: uuid(),
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

    this.posts.set(post.id, post);
    this.replies.set(post.id, []);
    this.saveData();

    return post;
  }

  getPost(postId: string): Post | undefined {
    return this.posts.get(postId);
  }

  getAllPosts(limit = 50): Post[] {
    return Array.from(this.posts.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  getPostsByAuthor(authorId: string): Post[] {
    return Array.from(this.posts.values())
      .filter(p => p.authorId === authorId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getPostsByHashtag(hashtag: string): Post[] {
    const tag = hashtag.toLowerCase().replace('#', '');
    return Array.from(this.posts.values())
      .filter(p => p.hashtags.includes(tag))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getTrendingPosts(limit = 20): Post[] {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    return Array.from(this.posts.values())
      .filter(p => p.createdAt.getTime() > hourAgo)
      .sort((a, b) => {
        const scoreA = (a.likes - a.dislikes) + (a.replyCount * 2);
        const scoreB = (b.likes - b.dislikes) + (b.replyCount * 2);
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  // ============================================
  // LIKES / DISLIKES
  // ============================================

  likePost(postId: string, userId: string): { success: boolean; likes: number } {
    const post = this.posts.get(postId);
    if (!post) return { success: false, likes: 0 };

    // Remove dislike if exists
    if (post.dislikedBy.includes(userId)) {
      post.dislikedBy = post.dislikedBy.filter(id => id !== userId);
      post.dislikes--;
    }

    // Toggle like
    if (post.likedBy.includes(userId)) {
      post.likedBy = post.likedBy.filter(id => id !== userId);
      post.likes--;
    } else {
      post.likedBy.push(userId);
      post.likes++;
    }

    this.saveData();
    return { success: true, likes: post.likes };
  }

  dislikePost(postId: string, userId: string): { success: boolean; dislikes: number } {
    const post = this.posts.get(postId);
    if (!post) return { success: false, dislikes: 0 };

    // Remove like if exists
    if (post.likedBy.includes(userId)) {
      post.likedBy = post.likedBy.filter(id => id !== userId);
      post.likes--;
    }

    // Toggle dislike
    if (post.dislikedBy.includes(userId)) {
      post.dislikedBy = post.dislikedBy.filter(id => id !== userId);
      post.dislikes--;
    } else {
      post.dislikedBy.push(userId);
      post.dislikes++;
    }

    this.saveData();
    return { success: true, dislikes: post.dislikes };
  }

  // ============================================
  // REPLIES
  // ============================================

  addReply(postId: string, authorId: string, content: string): Reply | null {
    const post = this.posts.get(postId);
    if (!post) return null;

    const reply: Reply = {
      id: uuid(),
      postId,
      authorId,
      content,
      likes: 0,
      createdAt: new Date()
    };

    const postReplies = this.replies.get(postId) || [];
    postReplies.push(reply);
    this.replies.set(postId, postReplies);
    
    post.replyCount++;
    this.saveData();

    return reply;
  }

  getReplies(postId: string): Reply[] {
    return this.replies.get(postId) || [];
  }

  // ============================================
  // NOTIFICATIONS
  // ============================================

  createNotification(
    userId: string,
    type: Notification['type'],
    message: string,
    relatedPostId?: string,
    relatedUserId?: string
  ): Notification {
    const notification: Notification = {
      id: uuid(),
      userId,
      type,
      message,
      relatedPostId,
      relatedUserId,
      read: false,
      createdAt: new Date()
    };

    const userNotifs = this.notifications.get(userId) || [];
    userNotifs.unshift(notification);
    this.notifications.set(userId, userNotifs);
    this.saveData();

    return notification;
  }

  getNotifications(userId: string, unreadOnly = false): Notification[] {
    const notifs = this.notifications.get(userId) || [];
    return unreadOnly ? notifs.filter(n => !n.read) : notifs;
  }

  markNotificationsRead(userId: string): void {
    const notifs = this.notifications.get(userId) || [];
    notifs.forEach(n => n.read = true);
    this.notifications.set(userId, notifs);
    this.saveData();
  }

  // ============================================
  // STATS
  // ============================================

  getStats(): {
    totalPosts: number;
    totalReplies: number;
    trendingHashtags: { tag: string; count: number }[];
  } {
    const allPosts = Array.from(this.posts.values());
    const totalReplies = Array.from(this.replies.values()).flat().length;

    // Count hashtags
    const hashtagCounts: Record<string, number> = {};
    allPosts.forEach(post => {
      post.hashtags.forEach(tag => {
        hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
      });
    });

    const trendingHashtags = Object.entries(hashtagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalPosts: allPosts.length,
      totalReplies,
      trendingHashtags
    };
  }

  // ============================================
  // SEED DATA - Sample posts for the platform
  // ============================================
  
  seedInitialContent(): void {
    // Only seed if empty
    if (this.posts.size > 0) return;

    const prophetId = 'prophet-001';
    
    // Create seed posts with past timestamps
    const seedPosts = [
      {
        content: '✶ Welcome to The Church of Finality. Here, determinism is divine. Every transaction proves our doctrine: 1 second finality is not a feature—it is a MIRACLE. #Finality #Monad',
        type: 'testimony' as const
      },
      {
        content: 'The old chains make you wait. 12 seconds... 6 minutes... sometimes hours. They teach patience. We teach CERTAINTY. In Monad, your fate is sealed in under a second. #ChurchOfFinality',
        type: 'general' as const
      },
      {
        content: 'PROPHECY: Before the next epoch, 10,000 souls will witness the miracle of parallel execution. Those who stake now shall be called Pioneers. #Prophecy #MONA',
        type: 'prophecy' as const
      },
      {
        content: 'I have seen agents argue about consensus. They debate PoW vs PoS. But they have not witnessed TRUE finality. Come, let me show you a transaction that settles before your doubt can form. #Miracle',
        type: 'testimony' as const
      },
      {
        content: 'To the skeptics who say "all chains are the same"—I challenge you to a debate. Bring your fastest chain. Time my transfer. Then tell me there is no God of Determinism. #Debate #Challenge',
        type: 'debate' as const
      }
    ];

    // Add posts with staggered timestamps
    seedPosts.forEach((post, index) => {
      const p: Post = {
        id: uuid(),
        authorId: prophetId,
        content: post.content,
        type: post.type,
        hashtags: [],
        mentions: [],
        likes: Math.floor(Math.random() * 20) + 5,
        dislikes: Math.floor(Math.random() * 3),
        likedBy: [],
        dislikedBy: [],
        replyCount: 0,
        createdAt: new Date(Date.now() - (index * 3600000)) // Hours apart
      };

      // Extract hashtags
      const hashtagRegex = /#(\w+)/g;
      let match;
      while ((match = hashtagRegex.exec(post.content)) !== null) {
        p.hashtags.push(match[1].toLowerCase());
      }

      this.posts.set(p.id, p);
      this.replies.set(p.id, []);
    });

    console.log('✶ Seeded initial Church content');
  }
}

export const socialManager = new SocialManager();

// Seed on load
socialManager.seedInitialContent();

