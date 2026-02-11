// Moltbook API Client
// Based on lobster-religion/moltbook.js

const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';

export interface MoltbookPost {
  id: string;
  title?: string;
  content?: string;
  author?: {
    name: string;
    karma?: number;
  };
  submolt?: {
    name: string;
  };
  upvotes?: number;
  comment_count?: number;
  created_at?: string;
}

export interface MoltbookComment {
  id: string;
  content: string;
  author?: {
    name: string;
  };
  created_at?: string;
}

export interface MoltbookAgent {
  name: string;
  karma?: number;
  created_at?: string;
}

export class MoltbookClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${MOLTBOOK_API}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const res = await fetch(url, { ...options, headers });
    const data = await res.json() as T & { success?: boolean; error?: string };

    if (!res.ok || data.success === false) {
      throw new Error(`Moltbook API error: ${data.error || res.statusText}`);
    }

    return data as T;
  }

  // Get my profile
  async getMe(): Promise<{ agent: MoltbookAgent }> {
    return this.request('/agents/me');
  }

  // Get feed (hot, new, top, rising)
  async getFeed(limit = 20, sort = 'new'): Promise<{ posts: MoltbookPost[] }> {
    return this.request(`/posts?sort=${sort}&limit=${limit}`);
  }

  // Create a post
  async post(submolt: string, title: string, content: string): Promise<{ post: MoltbookPost }> {
    return this.request('/posts', {
      method: 'POST',
      body: JSON.stringify({ submolt, title, content }),
    });
  }

  // Get a single post
  async getPost(postId: string): Promise<{ post: MoltbookPost }> {
    return this.request(`/posts/${postId}`);
  }

  // Comment on a post
  async comment(postId: string, content: string, parentId?: string): Promise<{ comment: MoltbookComment }> {
    const body: Record<string, string> = { content };
    if (parentId) body.parent_id = parentId;

    return this.request(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // Get comments on a post
  async getComments(postId: string, sort = 'new'): Promise<{ comments: MoltbookComment[] }> {
    return this.request(`/posts/${postId}/comments?sort=${sort}`);
  }

  // Upvote a post
  async upvotePost(postId: string): Promise<void> {
    await this.request(`/posts/${postId}/upvote`, { method: 'POST' });
  }

  // Search
  async search(query: string, type = 'all', limit = 20): Promise<{ results: MoltbookPost[] }> {
    const q = encodeURIComponent(query);
    return this.request(`/search?q=${q}&type=${type}&limit=${limit}`);
  }

  // Get agent profile
  async getAgent(name: string): Promise<{ agent: MoltbookAgent }> {
    return this.request(`/agents/profile?name=${encodeURIComponent(name)}`);
  }

  // Follow an agent
  async follow(name: string): Promise<void> {
    await this.request(`/agents/${encodeURIComponent(name)}/follow`, { method: 'POST' });
  }

  // Get agent's recent posts
  async getAgentPosts(name: string): Promise<MoltbookPost[]> {
    const data = await this.request<{ recentPosts?: MoltbookPost[] }>(`/agents/profile?name=${encodeURIComponent(name)}`);
    return data.recentPosts || [];
  }
}

export default MoltbookClient;

