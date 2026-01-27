const { Pool } = require('pg');
require('dotenv').config();

// Verifica se estamos rodando na nuvem (Produção) ou no PC (Desenvolvimento)
const isProduction = process.env.NODE_ENV === 'production';

// A string de conexão vem do arquivo .env ou do painel do Render
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false // O Pulo do Gato para o Render
});

module.exports = pool;