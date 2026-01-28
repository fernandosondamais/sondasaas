const { Pool } = require('pg');
require('dotenv').config();

// Configuração de conexão que aceita Local e Render
const connectionString = process.env.DATABASE_URL || "postgres://sondasaas_db_user:QhOwhbqwMaso6EpV49iC29JIHRbNaabb@dpg-d5ocbter433s7381d8rg-a.virginia-postgres.render.com/sondasaas_db";

const isProduction = connectionString.includes('render.com');

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

module.exports = pool;