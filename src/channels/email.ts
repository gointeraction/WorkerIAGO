/**
 * Email Channel — IMAP/SMTP integration for receiving and sending emails
 * 
 * Uses Cloudflare Email Routing for receiving, and any SMTP provider for sending.
 * For receiving: configure Cloudflare Email Routing → forward to Worker
 * For sending: integrate with SendGrid, Mailgun, or native SMTP
 */

export interface EmailConfig {
  // Sending
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  fromEmail?: string;
  fromName?: string;
  
  // Receiving (Cloudflare Email Routing)
  enableInbound?: boolean;
}

export interface EmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    content: string; // base64
  }>;
  headers?: Record<string, string>;
  date: string;
}

export class EmailChannel {
  private config: EmailConfig;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  /**
   * Parse incoming email from Cloudflare Email Routing
   * Cloudflare Workers receive email as MailMessage object
   */
  parseInboundEmail(rawEmail: any): EmailMessage {
    // Cloudflare Email Routing provides structured email data
    return {
      id: rawEmail.headers?.get('message-id') || crypto.randomUUID(),
      from: rawEmail.from?.[0]?.address || '',
      to: rawEmail.to?.[0]?.address || '',
      subject: rawEmail.headers?.get('subject') || '(sin asunto)',
      textBody: rawEmail.text || '',
      htmlBody: rawEmail.html || '',
      headers: Object.fromEntries(rawEmail.headers?.entries?.() || []),
      date: rawEmail.headers?.get('date') || new Date().toISOString(),
    };
  }

  /**
   * Send email via SMTP (simplified — use SendGrid API in production)
   */
  async sendEmail(to: string, subject: string, textBody: string, htmlBody?: string): Promise<boolean> {
    // Using SendGrid API as default (most common)
    const sendgridKey = this.config.smtpUser; // repurpose field for API key
    if (!sendgridKey) {
      console.error('No email provider configured');
      return false;
    }

    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email: to }],
            subject,
          }],
          from: {
            email: this.config.fromEmail || 'bot@workeriago.com',
            name: this.config.fromName || 'WorkerIAGO Bot',
          },
          content: [
            { type: 'text/plain', value: textBody },
            ...(htmlBody ? [{ type: 'text/html', value: htmlBody }] : []),
          ],
        }),
      });
      return res.ok;
    } catch (e) {
      console.error('Email send error:', e);
      return false;
    }
  }

  /**
   * Send email with attachment
   */
  async sendEmailWithAttachment(
    to: string,
    subject: string,
    textBody: string,
    attachment: { filename: string; content: string; type: string }
  ): Promise<boolean> {
    const sendgridKey = this.config.smtpUser;
    if (!sendgridKey) return false;

    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }], subject }],
          from: { email: this.config.fromEmail || 'bot@workeriago.com' },
          content: [{ type: 'text/plain', value: textBody }],
          attachments: [{
            content: attachment.content,
            filename: attachment.filename,
            type: attachment.type,
          }],
        }),
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Parse email from raw MIME string (for non-Cloudflare setups)
   */
  static parseMime(mimeString: string): EmailMessage {
    const headers: Record<string, string> = {};
    const lines = mimeString.split('\r\n');
    let i = 0;
    
    // Parse headers
    for (; i < lines.length; i++) {
      if (lines[i] === '') break;
      const [key, ...valueParts] = lines[i].split(':');
      headers[key.toLowerCase().trim()] = valueParts.join(':').trim();
    }
    
    // Skip blank line
    i++;
    
    // Parse body (simplified — handles basic text/html)
    const body = lines.slice(i).join('\n');
    
    return {
      id: headers['message-id'] || crypto.randomUUID(),
      from: headers['from'] || '',
      to: headers['to'] || '',
      subject: headers['subject'] || '(sin asunto)',
      textBody: body,
      headers,
      date: headers['date'] || new Date().toISOString(),
    };
  }
}
