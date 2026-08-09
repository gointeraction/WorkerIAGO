# Webhook API Contract

## Channel Webhooks (Incoming)

### POST /webhook/telegram

Webhook for Telegram Bot API updates.

**Auth**: `TELEGRAM_BOT_TOKEN` secret (validated in handler)

**Request**: Telegram Update object

```json
{
  "update_id": 123456789,
  "message": {
    "chat": { "id": 123456, "first_name": "Juan" },
    "text": "hola",
    "from": { "id": 123456, "first_name": "Juan" }
  }
}
```

**Handler** (`src/channels/telegram.ts`):
1. Validate `TELEGRAM_BOT_TOKEN`
2. Extract `chatId`, `text`, `userName` from update
3. Call `orchestrator.handleMessage({ message: text, chatId, channel: 'telegram', agentId: undefined })`
4. Send response via Telegram Bot API `sendMessage`

**Response**: 200 OK (Telegram expects 200 to stop retrying)

---

### POST /webhook/whatsapp

Webhook for WhatsApp Business API.

**Auth**: `WHATSAPP_VERIFY_TOKEN` (for GET verification), `WHATSAPP_TOKEN` (for sending)

**GET verification**: `GET /webhook/whatsapp?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>` → returns `challenge` if token matches

**Request**: WhatsApp webhook payload

```json
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "1234567890",
          "text": { "body": "hola" }
        }]
      }
    }]
  }]
}
```

**Handler** (`src/channels/whatsapp.ts`):
1. Verify webhook signature (X-Hub-Signature-256)
2. Extract phone number, message text
3. Call orchestrator
4. Send response via WhatsApp API

---

### POST /webhook/instagram

Webhook for Instagram DM via Meta Graph API.

**Auth**: `INSTAGRAM_ACCESS_TOKEN`, verify token

**Handler** (`src/channels/instagram.ts`): Similar to WhatsApp (Meta Graph API)

---

### POST /webhook/facebook

Webhook for Facebook Messenger.

**Auth**: `FACEBOOK_PAGE_TOKEN`, verify token

**Handler** (`src/channels/facebook.ts`): Meta Graph API pattern

---

## Web Chat (Embedded Widget)

### GET /chat.js

Returns JavaScript for embeddable web chat widget.

**Usage**: `<script src="https://your-worker.workers.dev/chat.js"></script>`

### POST /api/chat

Used by web widget. See [chat-api.md](./chat-api.md).

---

## Other Channels

| Channel | Webhook Route | Handler File |
|---------|--------------|--------------|
| Email | Polled (SendGrid inbound) | `src/channels/email.ts` |
| SMS | Polled (Twilio webhook) | `src/channels/sms.ts` |
| Discord | WebSocket (Bot) | `src/channels/discord.ts` |
| Slack | WebSocket (Socket Mode) | `src/channels/slack.ts` |

---

## Outgoing Webhooks

### POST /admin/webhooks/save

Register an outgoing webhook for events.

**Events**: `conversation.created`, `lead.captured`, `ticket.closed`, `tool.executed`

**Table**: `webhooks` with `url`, `events`, `secret`, `is_active`

**Delivery**: HMAC-SHA256 signed payload sent to registered URL on event trigger
