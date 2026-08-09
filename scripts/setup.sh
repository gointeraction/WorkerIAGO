#!/bin/bash
# Script para configuración rápida

set -e

echo "🔨 AgentForge - Configuración Rápida"
echo "====================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js no está instalado. Instálalo desde https://nodejs.org"
    exit 1
fi

echo "✅ Node.js $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm no está instalado"
    exit 1
fi

echo "✅ npm $(npm -v)"

# Install dependencies
echo ""
echo "📦 Instalando dependencias..."
pnpm install

echo ""
echo "✅ Dependencias instaladas"
echo ""
echo "Próximos pasos:"
echo "  1. Ejecuta: bash deploy.sh"
echo "  2. Sigue las instrucciones en pantalla"
