/**
 * Payments — Stripe/MercadoPago integration for chat payments
 * 
 * Create payment links, check status, send invoices.
 */

export interface PaymentConfig {
  provider: 'stripe' | 'mercadopago';
  apiKey: string;
  secretKey: string;
  webhookSecret?: string;
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paymentUrl?: string;
  clientSecret?: string;
}

export class PaymentProcessor {
  private config: PaymentConfig;

  constructor(config: PaymentConfig) {
    this.config = config;
  }

  /**
   * Create payment intent / preference
   */
  async createPayment(params: {
    amount: number;
    currency: string;
    description: string;
    customerEmail?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent> {
    if (this.config.provider === 'stripe') {
      return this.createStripePayment(params);
    }
    return this.createMercadoPagoPayment(params);
  }

  private async createStripePayment(params: {
    amount: number;
    currency: string;
    description: string;
    customerEmail?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent> {
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        amount: String(Math.round(params.amount * 100)),
        currency: params.currency,
        description: params.description,
        'metadata[description]': params.description,
        ...Object.fromEntries(Object.entries(params.metadata || {}).map(([k, v]) => [`metadata[${k}]`, v])),
      }),
    });
    const data = await res.json() as any;

    return {
      id: data.id,
      amount: params.amount,
      currency: params.currency,
      status: data.status,
      clientSecret: data.client_secret,
      paymentUrl: `https://checkout.stripe.com/pay/${data.client_secret?.split('_')[0]}`,
    };
  }

  private async createMercadoPagoPayment(params: {
    amount: number;
    currency: string;
    description: string;
    customerEmail?: string;
  }): Promise<PaymentIntent> {
    const res = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transaction_amount: params.amount,
        description: params.description,
        payment_method_id: 'visa', // placeholder
        installments: 1,
        notification_url: 'https://workeriago.ibohorrez.workers.dev/api/webhooks/mercadopago',
      }),
    });
    const data: any = await res.json();

    return {
      id: data.id?.toString() as string,
      amount: params.amount,
      currency: params.currency,
      status: data.status,
      paymentUrl: data.point_of_interaction?.transaction_data?.ticket_url,
    };
  }

  /**
   * Check payment status
   */
  async getPaymentStatus(paymentId: string): Promise<{ status: string; paid: boolean }> {
    if (this.config.provider === 'stripe') {
      const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${this.config.secretKey}` },
      });
      const data: any = await res.json();
      return { status: data.status, paid: data.status === 'succeeded' };
    }

    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${this.config.secretKey}` },
    });
    const data: any = await res.json();
    return { status: data.status, paid: data.status === 'approved' };
  }

  /**
   * Send payment link via chat
   */
  formatPaymentMessage(intent: PaymentIntent): string {
    let msg = `💰 *Pago pendiente*\n`;
    msg += `Monto: ${intent.currency.toUpperCase()} ${intent.amount}\n`;
    msg += `Estado: ${intent.status}\n`;
    if (intent.paymentUrl) {
      msg += `\n🔗 Pagar: ${intent.paymentUrl}`;
    }
    return msg;
  }
}

/**
 * Generate invoice PDF (simplified)
 */
export function generateInvoice(invoice: {
  id: string;
  customer: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  date: string;
}): string {
  const subtotal = invoice.items.reduce((sum, i) => sum + i.quantity * i.price, 0);
  const tax = subtotal * 0.16; // 16% IVA
  const total = subtotal + tax;

  let html = `
    <h1>Factura ${invoice.id}</h1>
    <p>Fecha: ${invoice.date}</p>
    <p>Cliente: ${invoice.customer}</p>
    <table>
      <tr><th>Artículo</th><th>Cant.</th><th>Precio</th><th>Total</th></tr>
      ${invoice.items.map(i => `
        <tr>
          <td>${i.name}</td>
          <td>${i.quantity}</td>
          <td>$${i.price.toFixed(2)}</td>
          <td>$${(i.quantity * i.price).toFixed(2)}</td>
        </tr>
      `).join('')}
    </table>
    <p>Subtotal: $${subtotal.toFixed(2)}</p>
    <p>IVA (16%): $${tax.toFixed(2)}</p>
    <p><strong>Total: $${total.toFixed(2)}</strong></p>
  `;

  return html;
}
