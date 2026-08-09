/**
 * Workflows — Multi-agent flow engine
 * 
 * Define multi-step workflows where agents collaborate.
 * Each step can call an agent, a tool, or a connector.
 * Workflows are persisted in D1 and executed via Cloudflare Workflows API.
 */

export interface WorkflowStep {
  id: string;
  type: 'agent' | 'tool' | 'condition' | 'parallel' | 'transform';
  name: string;
  config: Record<string, any>;
  next?: string; // step ID to go to next
  next_on_true?: string; // for condition type
  next_on_false?: string;
  timeout_ms?: number;
  retry_count?: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: 'manual' | 'webhook' | 'schedule' | 'event';
  trigger_config?: Record<string, any>;
  steps: WorkflowStep[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  status: 'running' | 'completed' | 'failed' | 'paused';
  current_step?: string;
  context: Record<string, any>;
  started_at: string;
  completed_at?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workflow Engine
// ═══════════════════════════════════════════════════════════════════════════════
export class WorkflowEngine {
  private db: D1Database;
  private ai: any;

  constructor(db: D1Database, ai: any) {
    this.db = db;
    this.ai = ai;
  }

  /**
   * Execute a workflow
   */
  async run(
    workflowId: string,
    initialContext: Record<string, any> = {}
  ): Promise<WorkflowRun> {
    // Get workflow
    const wf = await this.db.prepare(
      'SELECT * FROM workflows WHERE id = ?'
    ).bind(workflowId).first() as any;

    if (!wf) throw new Error('Workflow not found');

    const steps: WorkflowStep[] = JSON.parse(wf.steps || '[]');

    // Create run record
    const runId = crypto.randomUUID();
    const run: WorkflowRun = {
      id: runId,
      workflow_id: workflowId,
      status: 'running',
      context: initialContext,
      started_at: new Date().toISOString(),
    };

    await this.db.prepare(
      `INSERT INTO workflow_runs (id, workflow_id, status, context, started_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(runId, workflowId, 'running', JSON.stringify(initialContext), run.started_at).run();

    // Execute steps
    try {
      const result = await this.executeSteps(steps, run);
      run.status = 'completed';
      run.completed_at = new Date().toISOString();
      run.context = result;

      await this.db.prepare(
        `UPDATE workflow_runs SET status='completed', context=?, completed_at=? WHERE id=?`
      ).bind(JSON.stringify(result), run.completed_at, runId).run();
    } catch (e: any) {
      run.status = 'failed';
      run.error = e.message;
      run.completed_at = new Date().toISOString();

      await this.db.prepare(
        `UPDATE workflow_runs SET status='failed', error=?, completed_at=? WHERE id=?`
      ).bind(e.message, run.completed_at, runId).run();
    }

    return run;
  }

  private async executeSteps(
    steps: WorkflowStep[],
    run: WorkflowRun
  ): Promise<Record<string, any>> {
    const stepMap = new Map(steps.map(s => [s.id, s]));
    let currentStepId = steps[0]?.id;
    const context = { ...run.context };

    while (currentStepId) {
      const step = stepMap.get(currentStepId);
      if (!step) break;

      run.current_step = step.id;

      const result = await this.executeStep(step, context);
      context[`step_${step.id}`] = result;
      context.last_result = result;

      // Determine next step
      if (step.type === 'condition') {
        currentStepId = result ? step.next_on_true : step.next_on_false;
      } else {
        currentStepId = step.next;
      }
    }

    return context;
  }

  private async executeStep(
    step: WorkflowStep,
    context: Record<string, any>
  ): Promise<any> {
    const timeout = step.timeout_ms || 30000;
    const retries = step.retry_count || 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await Promise.race([
          this.executeStepInternal(step, context),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout)),
        ]);
      } catch (e: any) {
        if (attempt === retries) throw e;
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  private async executeStepInternal(
    step: WorkflowStep,
    context: Record<string, any>
  ): Promise<any> {
    switch (step.type) {
      case 'agent': {
        // Call an agent
        const model = step.config.model || '@cf/meta/llama-3.1-8b-instruct-fp8';
        const systemPrompt = step.config.system_prompt || 'You are a helpful assistant.';
        
        // Build message from template
        let message = step.config.message || '';
        message = this.interpolate(message, context);

        const result = await this.ai.run(model, {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          temperature: step.config.temperature || 0.7,
          max_tokens: step.config.max_tokens || 512,
        });

        return result.response;
      }

      case 'tool': {
        // Execute an MCP tool
        const toolName = step.config.tool_name;
        const params = this.interpolateObj(step.config.params || {}, context);

        const { executeMcpTool } = await import('../mcp/server');
        return await executeMcpTool(
          { DB: this.db, AI: this.ai },
          toolName,
          params
        );
      }

      case 'condition': {
        // Evaluate a condition using AI
        const condition = step.config.condition;
        let message = `Evaluate this condition: "${condition}"\n\nContext: ${JSON.stringify(context)}\n\nRespond with ONLY "true" or "false".`;

        const result = await this.ai.run('@cf/meta/llama-3.2-3b-instruct', {
          messages: [{ role: 'user', content: message }],
          max_tokens: 10,
        });

        return result.response?.toLowerCase().includes('true');
      }

      case 'transform': {
        // Transform data using a template
        const template = step.config.template;
        return this.interpolate(template, context);
      }

      case 'parallel': {
        // Execute multiple steps in parallel
        const subSteps = step.config.steps || [];
        const promises = subSteps.map((subStep: WorkflowStep) =>
          this.executeStep(subStep, context)
        );
        return await Promise.all(promises);
      }

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  private interpolate(template: string, context: Record<string, any>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
      const parts = path.split('.');
      let value: any = context;
      for (const part of parts) {
        value = value?.[part];
      }
      return value !== undefined ? String(value) : `{{${path}}}`;
    });
  }

  private interpolateObj(obj: Record<string, any>, context: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.interpolate(value, context);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pre-built Workflow Templates
// ═══════════════════════════════════════════════════════════════════════════════
export const WORKFLOW_TEMPLATES = [
  {
    name: 'Atención al Cliente',
    description: 'Clasificar → Buscar KB → Responder → Escalar si necesario',
    steps: [
      {
        id: 'classify',
        type: 'agent',
        name: 'Clasificar intención',
        config: {
          model: '@cf/meta/llama-3.2-3b-instruct',
          system_prompt: 'Clasifica este mensaje como: soporte, ventas, queja, consulta. Responde SOLO con la categoría.',
          message: '{{user_message}}',
        },
        next: 'check_intent',
      },
      {
        id: 'check_intent',
        type: 'condition',
        name: '¿Es queja o urgente?',
        config: { condition: 'La categoría es "queja" o "urgente"' },
        next_on_true: 'escalate',
        next_on_false: 'respond',
      },
      {
        id: 'respond',
        type: 'agent',
        name: 'Generar respuesta',
        config: {
          model: '@cf/meta/llama-3.1-8b-instruct-fp8',
          system_prompt: 'Responde al cliente de forma profesional y amable.',
          message: 'Mensaje del usuario: {{user_message}}\nCategoría: {{step_classify}}',
        },
      },
      {
        id: 'escalate',
        type: 'agent',
        name: 'Notificar escalamiento',
        config: {
          message: 'Genera un resumen breve de esta queja para escalar a un humano.',
        },
      },
    ],
  },
  {
    name: 'Generador de Contenido',
    description: 'Investigar → Escribir → Revisar → Publicar',
    steps: [
      {
        id: 'research',
        type: 'tool',
        name: 'Buscar información',
        config: {
          tool_name: 'search_knowledge',
          params: { query: '{{topic}}' },
        },
        next: 'write',
      },
      {
        id: 'write',
        type: 'agent',
        name: 'Escribir contenido',
        config: {
          system_prompt: 'Escribe un artículo profesional sobre el tema.',
          message: 'Tema: {{topic}}\nInformación: {{step_research}}',
        },
        next: 'review',
      },
      {
        id: 'review',
        type: 'agent',
        name: 'Revisar contenido',
        config: {
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          system_prompt: 'Revisa este contenido para errores, mejora la redacción. Responde con el texto mejorado.',
          message: '{{step_write}}',
        },
      },
    ],
  },
];
