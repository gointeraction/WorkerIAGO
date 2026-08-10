/**
 * MCP Connectors — External service integrations (Google Drive, Notion, etc.)
 * 
 * These are pre-built MCP tools that sync knowledge from external sources.
 * Each connector defines its auth flow, sync logic, and tool definition.
 */

export interface ConnectorConfig {
  id: string;
  name: string;
  type: 'google_drive' | 'notion' | 'confluence' | 'rss' | 'webhook';
  is_active: boolean;
  config: Record<string, any>;
  last_sync_at?: string;
  sync_status?: 'ok' | 'error' | 'syncing';
  items_synced?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Google Drive Connector
// ═══════════════════════════════════════════════════════════════════════════════
export const GOOGLE_DRIVE_CONNECTOR = {
  name: 'Google Drive',
  type: 'google_drive' as const,
  description: 'Sincroniza documentos de Google Drive (Docs, PDFs, Sheets)',
  auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  
  // Convert Google Doc to plain text
  async exportDocument(accessToken: string, fileId: string, mimeType: string): Promise<string> {
    if (mimeType === 'application/vnd.google-apps.document') {
      // Export Google Doc as plain text
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return await res.text();
    } else if (mimeType === 'application/pdf') {
      // For PDFs, we'd need a PDF parser — return metadata for now
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,size`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const meta = await res.json() as any;
      return `[PDF: ${meta.name} — Upload to R2 for full text extraction]`;
    }
    return '';
  },

  async listFiles(accessToken: string, query?: string): Promise<any[]> {
    const q = query ? `name contains '${query}'` : "mimeType != 'application/vnd.google-apps.folder'";
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json() as any;
    return data.files || [];
  },

  getAuthUrl(redirectUri: string, clientId: string): string {
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(this.scopes.join(' '))}&access_type=offline`;
  },

  async exchangeCode(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<any> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    });
    return await res.json();
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Notion Connector
// ═══════════════════════════════════════════════════════════════════════════════
export const NOTION_CONNECTOR = {
  name: 'Notion',
  type: 'notion' as const,
  description: 'Sincroniza páginas y bases de datos de Notion',
  auth_url: 'https://api.notion.com/v1/oauth/authorize',
  
  async listPages(apiKey: string): Promise<any[]> {
    const res = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: { value: 'page', property: 'object' },
        page_size: 20,
      }),
    });
    const data: any = await res.json();
    return data.results || [];
  },

  async getPageContent(apiKey: string, pageId: string): Promise<string> {
    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
      },
    });
    const data: any = await res.json();
    
    // Extract text from blocks
    const lines: string[] = [];
    for (const block of data.results || []) {
      if (block.type === 'paragraph' && block.paragraph?.rich_text) {
        lines.push(block.paragraph.rich_text.map((t: any) => t.plain_text).join(''));
      } else if (block.type === 'heading_1' && block.heading_1?.rich_text) {
        lines.push('# ' + block.heading_1.rich_text.map((t: any) => t.plain_text).join(''));
      } else if (block.type === 'heading_2' && block.heading_2?.rich_text) {
        lines.push('## ' + block.heading_2.rich_text.map((t: any) => t.plain_text).join(''));
      } else if (block.type === 'heading_3' && block.heading_3?.rich_text) {
        lines.push('### ' + block.heading_3.rich_text.map((t: any) => t.plain_text).join(''));
      } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
        lines.push('- ' + block.bulleted_list_item.rich_text.map((t: any) => t.plain_text).join(''));
      } else if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
        lines.push('1. ' + block.numbered_list_item.rich_text.map((t: any) => t.plain_text).join(''));
      }
    }
    return lines.join('\n');
  },

  getAuthUrl(redirectUri: string, clientId: string): string {
    return `${this.auth_url}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&owner=user`;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// RSS Connector
// ═══════════════════════════════════════════════════════════════════════════════
export const RSS_CONNECTOR = {
  name: 'RSS Feed',
  type: 'rss' as const,
  description: 'Sigue feeds RSS y sincroniza artículos como knowledge base',

  async fetchFeed(url: string): Promise<any[]> {
    const res = await fetch(url);
    const text = await res.text();
    
    // Simple RSS parser
    const items: any[] = [];
    const itemMatches = text.matchAll(/<item>([\s\S]*?)<\/item>/gi);
    
    for (const match of itemMatches) {
      const item = match[1];
      const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || '';
      const description = item.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() || '';
      const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
      const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
      
      // Strip HTML from description
      const cleanDesc = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      
      if (title) {
        items.push({ title, description: cleanDesc, link, pubDate });
      }
    }
    
    return items;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Connector Registry — available connectors
// ═══════════════════════════════════════════════════════════════════════════════
export const CONNECTORS = {
  google_drive: GOOGLE_DRIVE_CONNECTOR,
  notion: NOTION_CONNECTOR,
  rss: RSS_CONNECTOR,
};

export function getConnector(type: string): any {
  return CONNECTORS[type as keyof typeof CONNECTORS] || null;
}

export function listConnectors(): Array<{ name: string; type: string; description: string }> {
  return Object.values(CONNECTORS).map(c => ({
    name: c.name,
    type: c.type,
    description: c.description,
  }));
}
