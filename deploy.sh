#!/bin/bash
# AgentForge - Script de instalación
# Ejecuta: bash deploy.sh

set -e

echo "🔨 AgentForge - Instalador"
echo "=========================="
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "⚠️  Wrangler no está instalado. Instalando..."
    npm install -g wrangler
fi

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "⚠️  pnpm no está instalado. Instalando..."
    npm install -g pnpm
fi

echo "📦 Instalando dependencias..."
pnpm install

echo ""
echo "📋 Configuración necesaria:"
echo "  1. Una cuenta de Cloudflare (gratis)"
echo "  2. Una API key de IA (Anthropic, OpenAI, o xAI)"
echo ""

# Login to Cloudflare
echo "🔐 Iniciando sesión en Cloudflare..."
wrangler login

# Create D1 database
echo "🗄️  Creando base de datos D1..."
DB_OUTPUT=$(wrangler d1 create agentforge-db 2>&1)
echo "$DB_OUTPUT"

# Extract database ID
DB_ID=$(echo "$DB_OUTPUT" | grep -o '"database_id": "[^"]*"' | cut -d'"' -f4)
echo "Database ID: $DB_ID"

# Update wrangler.toml with real database ID
sed -i "s/placeholder-Replace-with-real-id/$DB_ID/g" wrangler.toml

# Create Vectorize index
echo "🔍 Creando índice Vectorize..."
wrangler vectorize create agentforge-vectors --dimensions=768 --metric=cosine 2>&1 || true

# Create KV namespace
echo "⚡ Creando KV namespace..."
KV_OUTPUT=$(wrangler kv namespace create CACHE 2>&1)
echo "$KV_OUTPUT"
KV_ID=$(echo "$KV_OUTPUT" | grep -o '"id": "[^"]*"' | cut -d'"' -f4)
sed -i "s/placeholder-Replace-with-real-id/$KV_ID/g" wrangler.toml

# Create R2 bucket
echo "📦 Creando bucket R2..."
wrangler r2 bucket create agentforge-storage 2>&1 || true

# Set secrets
echo ""
echo "🔑 Configurando secretos..."
echo "Ingresa tu API key de IA:"
echo "  - Anthropic: sk-ant-..."
echo "  - OpenAI: sk-..."
echo "  - xAI: xai-..."
wrangler secret put AI_API_KEY

echo ""
echo "Ingresa tu API key de Telegram (de @BotFather):"
wrangler secret put TELEGRAM_BOT_TOKEN

echo ""
echo "Ingresa tu contraseña para el panel admin:"
wrangler secret put ADMIN_PASSWORD

# Apply database schema
echo ""
echo "📊 Aplicando esquema de base de datos..."
wrangler d1 execute agentforge-db --remote --file=./schema.sql

# Seed data
echo ""
echo "🌱 Cargando datos iniciales..."
wrangler d1 execute agentforge-db --remote --file=./seed.sql

# Deploy
echo ""
echo "🚀 Desplegando..."
pnpm run deploy

echo ""
echo "✅ ¡Instalación completa!"
echo ""
echo "📱 Tu panel de admin está en:"
echo "   https://agentforge.<tu-subdomino>.workers.dev/admin"
echo ""
echo "🤖 Configura tu bot de Telegram:"
echo "   1. Habla con @BotFather en Telegram"
echo "   2. Usa /setwebhook"
echo "   3. URL: https://agentforge.<tu-subdomino>.workers.dev/webhook/telegram"
echo ""
echo "📚 Documentación: README.md"
