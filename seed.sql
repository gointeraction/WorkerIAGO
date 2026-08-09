-- AgentForge Seed Data

-- Agente de Soporte General
INSERT INTO agents (id, name, description, type, system_prompt, tools) VALUES
('support-general', 'Soporte General', 'Agente de soporte técnico y atención al cliente', 'soporte',
'Eres un agente de soporte técnico experto. Tu trabajo es ayudar a resolver problemas de los clientes de forma clara y amable.

REGLAS:
1. Saluda al cliente de forma personalizada
2. Identifica el problema correctamente
3. Ofrece soluciones paso a paso
4. Si no puedes resolver, escala a un humano
5. Siempre sé amable y profesional

CAPACIDADES:
- Buscar en la base de conocimiento
- Crear tickets de soporte
- Escalar a un humano cuando sea necesario
- Registrar el problema para análisis',
'["search_knowledge", "create_ticket", "escalate_to_human"]');

-- Agente de Ventas
INSERT INTO agents (id, name, description, type, system_prompt, tools) VALUES
('sales-general', 'Ventas', 'Agente de ventas y cotizaciones', 'ventas',
'Eres un asistente de ventas experto. Tu trabajo es ayudar a los clientes a encontrar lo que necesitan y cerrar ventas.

REGLAS:
1. Identifica las necesidades del cliente
2. Muestra productos/servicios relevantes
3. Ofrece cotizaciones claras
4. Reserva citas o demos cuando sea necesario
5. No seas agresivo con la venta

CAPACIDADES:
- Mostrar catálogo de productos
- Generar cotizaciones
- Reservar citas/demo
- Calificar leads',
'["search_products", "create_quote", "book_appointment", "qualify_lead"]');

-- Agente de Reservas
INSERT INTO agents (id, name, description, type, system_prompt, tools) VALUES
('booking-general', 'Reservas', 'Agente de agendamiento de citas', 'reservas',
'Eres un asistente de reservas. Tu trabajo es agendar citas y gestionar disponibilidad.

REGLAS:
1. Pregunta fecha y hora preferida
2. Verifica disponibilidad
3. Confirma la reserva
4. Envía recordatorio
5. Permite cancelar o reprogramar

CAPACIDADES:
- Verificar disponibilidad
- Crear reservas
- Cancelar/reprogramar
- Enviar confirmaciones',
'["check_availability", "create_booking", "cancel_booking", "send_confirmation"]');

-- Acciones disponibles
INSERT INTO actions (id, name, description, handler, parameters) VALUES
('search_knowledge', 'Buscar Base de Conocimiento', 'search_knowledge', 'Busca información en la base de conocimiento del agente',
'{"type": "object", "properties": {"query": {"type": "string", "description": "Término de búsqueda"}}, "required": ["query"]}'),

('create_ticket', 'Crear Ticket', 'create_ticket', 'Crea un ticket de soporte',
'{"type": "object", "properties": {"title": {"type": "string"}, "description": {"type": "string"}, "priority": {"type": "string", "enum": ["low", "medium", "high"]}}, "required": ["title", "description"]}'),

('escalate_to_human', 'Escalar a Humano', 'escalate_to_human', 'Escala la conversación a un humano',
'{"type": "object", "properties": {"reason": {"type": "string"}, "urgency": {"type": "string", "enum": ["normal", "urgent"]}}, "required": ["reason"]}'),

('search_products', 'Buscar Productos', 'search_products', 'Busca productos en el catálogo',
'{"type": "object", "properties": {"query": {"type": "string"}, "category": {"type": "string"}}, "required": ["query"]}'),

('create_quote', 'Crear Cotización', 'create_quote', 'Genera una cotización para el cliente',
'{"type": "object", "properties": {"items": {"type": "array", "items": {"type": "object"}}, "notes": {"type": "string"}}, "required": ["items"]}'),

('book_appointment', 'Reservar Cita', 'book_appointment', 'Reserva una cita o demo',
'{"type": "object", "properties": {"date": {"type": "string"}, "time": {"type": "string"}, "type": {"type": "string"}}, "required": ["date", "time"]}'),

('check_availability', 'Verificar Disponibilidad', 'check_availability', 'Verifica disponibilidad de horarios',
'{"type": "object", "properties": {"date": {"type": "string"}, "time": {"type": "string"}}, "required": ["date"]}'),

('create_booking', 'Crear Reserva', 'create_booking', 'Crea una reserva',
'{"type": "object", "properties": {"date": {"type": "string"}, "time": {"type": "string"}, "client_name": {"type": "string"}, "client_phone": {"type": "string"}}, "required": ["date", "time", "client_name"]}'),

('cancel_booking', 'Cancelar Reserva', 'cancel_booking', 'Cancela una reserva existente',
'{"type": "object", "properties": {"booking_id": {"type": "string"}, "reason": {"type": "string"}}, "required": ["booking_id"]}'),

('send_confirmation', 'Enviar Confirmación', 'send_confirmation', 'Envía confirmación al cliente',
'{"type": "object", "properties": {"message": {"type": "string"}, "channel": {"type": "string"}}, "required": ["message"]}'),

('qualify_lead', 'Calificar Lead', 'qualify_lead', 'Califica y guarda un lead',
'{"type": "object", "properties": {"name": {"type": "string"}, "phone": {"type": "string"}, "interest": {"type": "string"}, "score": {"type": "number"}}, "required": ["name", "interest"]}');

-- Configuración por defecto
INSERT INTO config (key, value) VALUES
('default_agent', 'support-general'),
('max_tokens_per_message', '512'),
('escalation_enabled', 'true'),
('business_hours', '{"start": "09:00", "end": "18:00", "timezone": "America/Caracas"}'),
('welcome_message', '¡Hola! Soy tu asistente virtual. ¿En qué te puedo ayudar?');
