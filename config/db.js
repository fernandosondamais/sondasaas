require('dotenv').config();
const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';
// Se não houver variavel definida, usa a string local padrão
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/sondasaas';

const pool = new Pool({
    connectionString: connectionString,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
    // Log apenas em dev para não poluir produção
    if (!isProduction) console.log('>>> PostgreSQL Conectado com Sucesso <<<');
});

module.exports = pool;