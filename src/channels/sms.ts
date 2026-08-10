/**
 * SMS Channel — Twilio integration for SMS messaging
 * 
 * Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 */

export interface SmsConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string; // E.164 format: +1234567890
}

export interface SmsMessage {
  sid: string;
  from: string;
  to: string;
  body: string;
  status: string;
  numSegments: string;
  direction: string;
  price: string;
  dateCreated: string;
}

export class SmsChannel {
  private config: SmsConfig;
  private apiBase = 'https://api.twilio.com/2010-04-01';

  constructor(config: SmsConfig) {
    this.config = config;
  }

  /**
   * Send SMS
   */
  async sendSms(to: string, body: string): Promise<{ success: boolean; sid?: string; error?: string }> {
    try {
      const res = await fetch(
        `${this.apiBase}/Accounts/${this.config.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${this.config.accountSid}:${this.config.authToken}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: to,
            From: this.config.phoneNumber,
            Body: body,
          }),
        }
      );

      const data: any = await res.json();
      return {
        success: res.ok,
        sid: data.sid,
        error: data.message,
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Send SMS with media (MMS)
   */
  async sendMms(to: string, body: string, mediaUrl: string): Promise<{ success: boolean; sid?: string; error?: string }> {
    try {
      const res = await fetch(
        `${this.apiBase}/Accounts/${this.config.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${this.config.accountSid}:${this.config.authToken}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: to,
            From: this.config.phoneNumber,
            Body: body,
            MediaUrl: mediaUrl,
          }),
        }
      );

      const data: any = await res.json();
      return { success: res.ok, sid: data.sid, error: data.message };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Parse incoming Twilio webhook
   */
  parseWebhook(body: URLSearchParams): SmsMessage {
    return {
      sid: body.get('MessageSid') || '',
      from: body.get('From') || '',
      to: body.get('To') || '',
      body: body.get('Body') || '',
      status: body.get('SmsStatus') || '',
      numSegments: body.get('NumSegments') || '1',
      direction: body.get('SmsStatus') || '',
      price: body.get('SmsPrice') || '',
      dateCreated: new Date().toISOString(),
    };
  }

  /**
   * Check SMS status
   */
  async getStatus(messageSid: string): Promise<any> {
    try {
      const res = await fetch(
        `${this.apiBase}/Accounts/${this.config.accountSid}/Messages/${messageSid}.json`,
        {
          headers: {
            'Authorization': 'Basic ' + btoa(`${this.config.accountSid}:${this.config.authToken}`),
          },
        }
      );
      return await res.json();
    } catch (e) {
      return null;
    }
  }
}
