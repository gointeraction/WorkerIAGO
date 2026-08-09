#!/bin/bash
# Script para crear todos los recursos de Cloudflare
# Ejecuta: bash scripts/setup-resources.sh

set -e

echo "🔨 WorkerIAGO - Creando recursos en Cloudflare"
echo "================================================"
echo ""

# Login
echo "🔐 Verificando sesión en Cloudflare..."
wrangler whoami

# 1. Crear D1 Database
echo ""
echo "🗄️  Creando base de datos D1..."
D1_OUTPUT=$(wrangler d1 create workeriago-db 2>&1)
echo "$D1_OUTPUT"
D1_ID=$(echo "$D1_OUTPUT" | grep -o '"database_id": "[^"]*"' | head -1 | cut -d'"' -f4)
echo "D1 Database ID: $D1_ID"

# 2. Crear KV Namespace
echo ""
echo "⚡ Creando KV namespace..."
KV_OUTPUT=$(wrangler kv namespace create CACHE 2>&1)
echo "$KV_OUTPUT"
KV_ID=$(echo "$KV_OUTPUT" | grep -o '"id": "[^"]*"' | head -1 | cut -d'"' -f4)
echo "KV Namespace ID: $KV_ID"

# 3. Crear Vectorize Index
echo ""
echo "🔍 Creando índice Vectorize..."
wrangler vectorize create workeriago-vectors --dimensions=768 --metric=cosine 2>&1 || echo "(puede que ya exista)"

# 4. Crear R2 Bucket
echo ""
echo "📦 Creando bucket R2..."
wrangler r2 bucket create workeriago-storage 2>&1 || echo "(puede que ya exista)"

# 5. Actualizar wrangler.toml con IDs reales
echo ""
echo "📝 Actualizando wrangler.toml..."
sed -i "s/database_id = \"placeholder-Replace-with-real-id\"/database_id = \"$D1_ID\"/" wrangler.toml
sed -i "s/id = \"placeholder-Replace-with-real-id\"/id = \"$KV_ID\"/" wrangler.toml

echo ""
echo "✅ Recursos creados:"
echo "   - D1 Database: $D1_ID"
echo "   - KV Namespace: $KV_ID"
echo "   - Vectorize: workeriago-vectors"
echo "   - R2 Bucket: workeriago-storage"
echo ""
echo "📋 IDs para Cloudflare Pages (Bindings):"
echo "   D1 Database: workeriago-db ($D1_ID)"
echo "   KV Namespace: CACHE ($KV_ID)"
echo "   Vectorize: workeriago-vectors"
echo "   R2 Bucket: workeriago-storage"
echo ""
echo "⚠️  Ahora configura los Bindings en Cloudflare Pages:"
echo "   1. Ve a tu proyecto Pages → Settings → Functions"
echo "   2. D1 database bindings: add D1 → variable: DB, d1 database: workeriago-db"
echo "   3. KV namespace bindings: add KV → variable: CACHE, namespace: CACHE"
echo "   4. Vectorize bindings: add Vectorize → variable: VECTORIZE, index: workeriago-vectors"
echo "   5. R2 bucket bindings: add R2 → variable: STORAGE, bucket: workeriago-storage"
echo "   6. Environment variables: add AI_API_KEY, TELEGRAM_BOT_TOKEN, etc."
