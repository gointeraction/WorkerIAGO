import { Hono } from 'hono';
import { Bindings } from './utils';
import { auth, csrfCheck } from './middleware';

import { registerAuthRoutes } from './routes/auth';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerConversationsRoutes } from './routes/conversations';
import { registerAgentsRoutes } from './routes/agents';
import { registerKnowledgeRoutes } from './routes/knowledge';
import { registerMcpRoutes } from './routes/mcp';
import { registerCampaignsRoutes } from './routes/campaigns';
import { registerWorkflowsRoutes } from './routes/workflows';
import { registerIntegrationsRoutes } from './routes/integrations';
import { registerSystemRoutes } from './routes/system';

const admin = new Hono<{ Bindings: Bindings }>();

// Apply middlewares
admin.use('*', auth);
admin.use('*', csrfCheck);

// Register modular routes
registerAuthRoutes(admin);
registerDashboardRoutes(admin);
registerConversationsRoutes(admin);
registerAgentsRoutes(admin);
registerKnowledgeRoutes(admin);
registerMcpRoutes(admin);
registerCampaignsRoutes(admin);
registerWorkflowsRoutes(admin);
registerIntegrationsRoutes(admin);
registerSystemRoutes(admin);

export default admin;
export { admin as AdminPanel };
