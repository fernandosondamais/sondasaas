const { Pool } = require('pg');
require('dotenv').config();

// --- CONFIGURAÇÃO DE CONEXÃO PADRONIZADA (CORREÇÃO CRÍTICA) ---
// Usa a variável de ambiente OU a string direta (Fallback) para garantir acesso local e nuvem
const connectionString = process.env.DATABASE_URL || "postgres://sondasaas_db_user:QhOwhbqwMaso6EpV49iC29JIHRbNaabb@dpg-d5ocbter433s7381d8rg-a.virginia-postgres.render.com/sondasaas_db";

// Detecta se é produção (Render) para exigir SSL, ou local para permitir sem SSL
const isProduction = connectionString.includes('render.com');

console.log('--------------------------------------------------');
console.log('>>> 🔌 DB CONFIG (CONTROLLERS): INICIANDO CONEXÃO...');
console.log('>>> URL em uso:', isProduction ? 'Nuvem (Render)' : 'Local/Hardcoded');
console.log('--------------------------------------------------');

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Tratamento de erro básico no pool para não derrubar a aplicação
pool.on('error', (err, client) => {
  console.error('!!! ERRO INESPERADO NO POOL DE CONEXÃO (DB.JS) !!!', err);
  process.exit(-1);
});

module.exports = pool;