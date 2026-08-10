/**
 * Discord Channel — Discord Bot integration
 * 
 * Requires: DISCORD_BOT_TOKEN
 */

export interface DiscordConfig {
  botToken: string;
  applicationId: string;
}

export class DiscordChannel {
  private config: DiscordConfig;
  private apiBase = 'https://discord.com/api/v10';

  constructor(config: DiscordConfig) {
    this.config = config;
  }

  /**
   * Send message to Discord channel
   */
  async sendMessage(channelId: string, content: string, embed?: any): Promise<boolean> {
    try {
      const body: any = { content };
      if (embed) body.embeds = [embed];

      const res = await fetch(`${this.apiBase}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch (e) {
      console.error('Discord send error:', e);
      return false;
    }
  }

  /**
   * Send embed message
   */
  async sendEmbed(channelId: string, title: string, description: string, color = 0x06b6d4): Promise<boolean> {
    return this.sendMessage(channelId, '', {
      title,
      description,
      color,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send DM to user
   */
  async sendDM(userId: string, content: string): Promise<boolean> {
    try {
      // Create DM channel
      const dmRes = await fetch(`${this.apiBase}/users/@me/channels`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recipient_id: userId }),
      });
      const dm: any = await dmRes.json();

      if (!dm.id) return false;

      return this.sendMessage(dm.id, content);
    } catch (e) {
      console.error('Discord DM error:', e);
      return false;
    }
  }

  /**
   * React to message
   */
  async addReaction(channelId: string, messageId: string, emoji: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.apiBase}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
        {
          method: 'PUT',
          headers: { 'Authorization': `Bot ${this.config.botToken}` },
        }
      );
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Parse Discord interaction (slash command)
   */
  parseInteraction(body: any): any {
    if (body.type === 3) { // Application command
      return {
        type: 'command',
        command: body.data?.name,
        options: body.data?.options || [],
        user: body.member?.user || body.user,
        channel_id: body.channel_id,
        guild_id: body.guild_id,
        token: body.token,
        interaction_id: body.id,
      };
    }
    if (body.type === 0) { // Message create
      return {
        type: 'message',
        content: body.content,
        author: body.author,
        channel_id: body.channel_id,
        guild_id: body.guild_id,
        message_id: body.id,
      };
    }
    return null;
  }

  /**
   * Respond to slash command
   */
  async respondInteraction(token: string, content: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/interactions/${token}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
          data: { content },
        }),
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }
}
