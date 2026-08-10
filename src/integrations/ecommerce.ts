/**
 * E-commerce — Shopify/WooCommerce integration
 * 
 * Browse products, check stock, create orders from chat.
 */

export interface EcommerceConfig {
  provider: 'shopify' | 'woocommerce';
  storeUrl: string;
  apiKey: string;
  apiSecret: string;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  price: string;
  compareAtPrice?: string;
  images: string[];
  variants: Array<{
    id: string;
    title: string;
    price: string;
    available: boolean;
    inventory: number;
  }>;
  tags: string[];
  category: string;
}

export class EcommerceStore {
  private config: EcommerceConfig;

  constructor(config: EcommerceConfig) {
    this.config = config;
  }

  /**
   * Search products
   */
  async searchProducts(query: string, limit = 10): Promise<Product[]> {
    if (this.config.provider === 'shopify') {
      return this.searchShopify(query, limit);
    }
    return this.searchWooCommerce(query, limit);
  }

  private async searchShopify(query: string, limit: number): Promise<Product[]> {
    try {
      const res = await fetch(
        `${this.config.storeUrl}/admin/api/2024-01/products.json?title=${encodeURIComponent(query)}&limit=${limit}`,
        {
          headers: {
            'X-Shopify-Access-Token': this.config.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = await res.json() as any;
      return (data.products || []).map(this.mapShopifyProduct);
    } catch (e) {
      return [];
    }
  }

  private async searchWooCommerce(query: string, limit: number): Promise<Product[]> {
    try {
      const auth = btoa(`${this.config.apiKey}:${this.config.apiSecret}`);
      const res = await fetch(
        `${this.config.storeUrl}/wp-json/wc/v3/products?search=${encodeURIComponent(query)}&per_page=${limit}`,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = await res.json();
      return (Array.isArray(data) ? data : []).map(this.mapWooProduct);
    } catch (e) {
      return [];
    }
  }

  /**
   * Get product by ID
   */
  async getProduct(productId: string): Promise<Product | null> {
    if (this.config.provider === 'shopify') {
      const res = await fetch(
        `${this.config.storeUrl}/admin/api/2024-01/products/${productId}.json`,
        { headers: { 'X-Shopify-Access-Token': this.config.apiKey } }
      );
      const data: any = await res.json();
      return data.product ? this.mapShopifyProduct(data.product) : null;
    }
    return null;
  }

  /**
   * Create draft order
   */
  async createOrder(items: Array<{ productId: string; variantId: string; quantity: number }>): Promise<any> {
    if (this.config.provider === 'shopify') {
      const res = await fetch(
        `${this.config.storeUrl}/admin/api/2024-01/orders.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': this.config.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            order: {
              line_items: items.map(i => ({
                variant_id: parseInt(i.variantId),
                quantity: i.quantity,
              })),
              financial_status: 'pending',
            },
          }),
        }
      );
      return await res.json();
    }
    return null;
  }

  private mapShopifyProduct(p: any): Product {
    return {
      id: p.id?.toString(),
      title: p.title,
      description: p.body_html?.replace(/<[^>]+>/g, '').slice(0, 500) || '',
      price: p.variants?.[0]?.price || '0',
      compareAtPrice: p.variants?.[0]?.compare_at_price,
      images: (p.images || []).map((i: any) => i.src),
      variants: (p.variants || []).map((v: any) => ({
        id: v.id?.toString(),
        title: v.title,
        price: v.price,
        available: v.available,
        inventory: v.inventory_quantity || 0,
      })),
      tags: p.tags || [],
      category: p.product_type || '',
    };
  }

  private mapWooProduct(p: any): Product {
    return {
      id: p.id?.toString(),
      title: p.name,
      description: p.short_description?.replace(/<[^>]+>/g, '').slice(0, 500) || '',
      price: p.price || '0',
      compareAtPrice: p.regular_price,
      images: (p.images || []).map((i: any) => i.src),
      variants: (p.variations || []).map((v: any) => ({
        id: v.id?.toString(),
        title: v.attributes?.map((a: any) => a.option).join(' / ') || '',
        price: v.price,
        available: v.stock_status === 'instock',
        inventory: v.stock_quantity || 0,
      })),
      tags: p.tags || [],
      category: p.categories?.[0]?.name || '',
    };
  }
}

/**
 * Format product for chat display
 */
export function formatProductForChat(product: Product): string {
  let msg = `*${product.title}*\n`;
  msg += `${product.description.slice(0, 200)}\n\n`;
  msg += `💰 Precio: $${product.price}`;
  if (product.compareAtPrice) msg += ` (antes $${product.compareAtPrice})`;
  msg += '\n';
  
  if (product.variants.length > 1) {
    msg += `\n📦 Variantes:\n`;
    product.variants.forEach(v => {
      msg += `  - ${v.title}: $${v.price} ${v.available ? '✅' : '❌'}\n`;
    });
  } else if (product.variants[0]) {
    msg += `📦 Stock: ${product.variants[0].available ? 'Disponible' : 'Agotado'}\n`;
  }

  if (product.images[0]) {
    msg += `\n🖼️ ${product.images[0]}`;
  }

  return msg;
}
