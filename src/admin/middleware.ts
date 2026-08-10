import { getCookie } from 'hono/cookie';
import { getSessionSecret, verifySession, issueCsrfToken } from './utils';

// Auth middleware - cookie-based session (HMAC-signed) + Bearer fallback
export const auth = async (c: any, next: any) => {
  const path = new URL(c.req.url).pathname;

  // Skip auth for login page and login API
  if (path === '/admin/login' || path === '/admin/api/login') {
    return next();
  }

  const password = c.env.ADMIN_PASSWORD;
  if (!password) {
    // No password set = demo mode. Still issue CSRF token for forms.
    issueCsrfToken(c);
    return next();
  }

  const session = getCookie(c, 'admin_session');
  const secret = getSessionSecret(c.env);
  if (verifySession(session, secret)) {
    // Refresh CSRF token if missing
    issueCsrfToken(c);
    return next();
  }

  // Also check Bearer token for API clients
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader === 'Bearer ' + password) {
    issueCsrfToken(c);
    return next();
  }

  return c.redirect('/admin/login');
};

// CSRF middleware ÔÇö verify on POSTs
export const csrfCheck = async (c: any, next: any) => {
  if (c.req.method !== 'POST') return next();
  // No CSRF requirement in demo mode (ADMIN_PASSWORD not set) ÔÇö skip entirely to avoid consuming formData
  if (!c.env.ADMIN_PASSWORD) return next();
  const cookieToken = getCookie(c, 'admin_csrf');
  // JSON APIs check header; form check formData field
  const headerToken = c.req.header('X-CSRF-Token');
  let formToken: string | null = null;
  const ct = c.req.header('content-type') || '';
  if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
    try {
      const form = await c.req.formData();
      formToken = String(form.get('_csrf') || '');
      c.var._parsedForm = form;
    } catch (e) {}
  }
  const token = headerToken || formToken;
  if (cookieToken && token && cookieToken === token) {
    return next();
  }
  return c.json({ error: 'CSRF token inv├ílido o faltante' }, 403);
};