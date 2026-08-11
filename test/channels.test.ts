import { describe, it, expect, vi } from "vitest";
import { WhatsAppChannel } from "../src/channels/whatsapp";
import { TelegramChannel } from "../src/channels/telegram";
import { WebChannel } from "../src/channels/web";
import { SlackChannel } from "../src/channels/slack";
import { SmsChannel } from "../src/channels/sms";

function makeOrchestrator(over: any = {}) {
  return {
    processMessage: vi.fn().mockResolvedValue({ response: "respuesta" }),
    ...over,
  } as any;
}

describe("channel adapters", () => {
  it("whatsapp: should ignore webhook without messages", async () => {
    const channel = new WhatsAppChannel("tok", "phone1");
    const orch = makeOrchestrator();
    const res = await channel.handleWebhook({ entry: [{ changes: [{ value: {} }] }] }, orch);
    expect(res).toEqual({ ok: true });
    expect(orch.processMessage).not.toHaveBeenCalled();
  });

  it("whatsapp: should process message text and send reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    const channel = new WhatsAppChannel("tok", "phone1");
    const orch = makeOrchestrator();
    const body = {
      entry: [{ changes: [{ value: { messages: [{ from: "1234", text: { body: "Hola" } }] } }] }],
    };
    await channel.handleWebhook(body, orch);
    expect(orch.processMessage).toHaveBeenCalledWith("Hola", "1234", "whatsapp");
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain("graph.facebook.com");
    expect(init.headers.Authorization).toBe("Bearer tok");
    const payload = JSON.parse(init.body);
    expect(payload.to).toBe("1234");
    expect(payload.text.body).toBe("respuesta");
    vi.unstubAllGlobals();
  });

  it("whatsapp: should send a template message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const channel = new WhatsAppChannel("tok", "phone1");
    await channel.sendTemplate("1234", "welcome", "es");
    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(payload.type).toBe("template");
    expect(payload.template.name).toBe("welcome");
    expect(payload.template.language.code).toBe("es");
    vi.unstubAllGlobals();
  });

  it("telegram: should handle /start command", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    const channel = new TelegramChannel("tok");
    const orch = makeOrchestrator();
    const res = await channel.handleUpdate({
      message: { text: "/start", chat: { id: 42 }, from: { first_name: "Ana" } },
    }, orch);
    expect(orch.processMessage).not.toHaveBeenCalled();
    expect(res).toBeDefined();
    vi.unstubAllGlobals();
  });

  it("telegram: should process text message and send typing action", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const channel = new TelegramChannel("tok");
    const orch = makeOrchestrator();
    await channel.handleUpdate({
      message: { text: "cuánto cuesta?", chat: { id: 42 }, from: { first_name: "Ana" } },
    }, orch);
    expect(orch.processMessage).toHaveBeenCalledWith("cuánto cuesta?", "42", "telegram");
    // typing action + send message = 2 fetches
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(init.body).text).toBe("respuesta");
    vi.unstubAllGlobals();
  });

  it("telegram: should ignore updates without text", async () => {
    const channel = new TelegramChannel("tok");
    const orch = makeOrchestrator();
    expect(await channel.handleUpdate({ update_id: 1 }, orch)).toEqual({ ok: true });
    expect(orch.processMessage).not.toHaveBeenCalled();
  });

  it("web: should proxy orchestrator result", async () => {
    const channel = new WebChannel();
    const orch = makeOrchestrator();
    const res = await channel.handleMessage("hola", "chat1", "agent1", orch);
    expect(orch.processMessage).toHaveBeenCalledWith("hola", "chat1", "web", [], "agent1");
    expect(res.response).toBe("respuesta");
  });

  it("slack: should send message and return ok flag", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const channel = new SlackChannel({ botToken: "xoxb-tok", signingSecret: "sec" });
    const ok = await channel.sendMessage("C123", "Hola", [{ type: "section", text: { type: "mrkdwn", text: "hi" } }]);
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("chat.postMessage");
    expect(init.headers.Authorization).toBe("Bearer xoxb-tok");
    const payload = JSON.parse(init.body);
    expect(payload.channel).toBe("C123");
    expect(payload.blocks).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("slack: should return false when API reports ok=false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false }) }));
    const channel = new SlackChannel({ botToken: "t", signingSecret: "s" });
    expect(await channel.sendMessage("C", "x")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("sms: should send SMS via Twilio", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: "SM123", status: "queued" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const channel = new SmsChannel({ accountSid: "AC123", authToken: "tok", phoneNumber: "+1555" });
    const res = await channel.sendSms("+15551234567", "Hola por SMS");
    expect(res.success).toBe(true);
    expect(res.sid).toBe("SM123");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("twilio.com");
    vi.unstubAllGlobals();
  });
});