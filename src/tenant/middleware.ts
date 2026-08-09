import { TenantManager } from './index';
import { getCookie } from 'hono/cookie';

/**
 * Hono middleware — resolves tenant from request and sets context
 * 
 * Resolution order:
 * 1. X-Tenant-ID header (API clients, admin panel fetch interceptor)
 * 2. X-Tenant-Slug header (alternative)
 * 3. tenant_id cookie (admin panel tenant switcher)
 * 4. Custom domain / subdomain (production)
 * 5. Default tenant (fallback)
 * 
 * Sets: c.set('tenantId', id)
 */
export function tenantMiddleware() {
  return async (c: any, next: any) => {
    let tenantId = 'default';

    // 1. X-Tenant-ID header (highest priority — set by JS interceptor)
    const headerTenantId = c.req.header('X-Tenant-ID');
    if (headerTenantId) {
      tenantId = headerTenantId;
    } else {
      // 2. X-Tenant-Slug header
      const headerSlug = c.req.header('X-Tenant-Slug');
      if (headerSlug) {
        try {
          const mgr = new TenantManager(c.env.DB);
          const tenant = await mgr.getTenantBySlug(headerSlug);
          if (tenant) tenantId = tenant.id;
        } catch (e) {}
      } else {
        // 3. tenant_id cookie (set by the admin tenant switcher dropdown)
        const cookieTenantId = getCookie(c, 'tenant_id');
        if (cookieTenantId) {
          tenantId = cookieTenantId;
        } else {
          // 4. Subdomain-based resolution (skip for localhost/IP)
          const host = new URL(c.req.url).hostname;
          if (host && !host.match(/^(\d+\.|localhost)/)) {
            const parts = host.split('.');
            if (parts.length >= 3) {
              const slug = parts[0];
              try {
                const mgr = new TenantManager(c.env.DB);
                const tenant = await mgr.getTenantBySlug(slug);
                if (tenant) tenantId = tenant.id;
              } catch (e) {}
            }
          }
        }
      }
    }

    c.set('tenantId', tenantId);
    await next();
  };
}
