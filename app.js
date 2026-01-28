require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// --- 1. CONEXÃO ROBUSTA ---
const connectionString = process.env.DATABASE_URL || "postgres://sondasaas_db_user:QhOwhbqwMaso6EpV49iC29JIHRbNaabb@dpg-d5ocbter433s7381d8rg-a.virginia-postgres.render.com/sondasaas_db";
const isProduction = connectionString.includes('render.com');

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

module.exports = { pool };

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_sonda_saas_v2',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// --- 2. ROTA DE EMERGÊNCIA (REPARO MANUAL) ---
// ACESSE ISSO NO NAVEGADOR DEPOIS DO DEPLOY: /api/sistema/reparar
app.get('/api/sistema/reparar', async (req, res) => {
    try {
        const logs = [];
        logs.push('>>> INICIANDO REPARO DO BANCO DE DADOS...');

        // 1. UUID
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        logs.push('✅ Extensão UUID verificada.');

        // 2. Colunas Proposta (Erro técnico_responsavel)
        const updates = [
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tecnico_responsavel VARCHAR(255)`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ORCAMENTO'`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_art DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_mobilizacao DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_desconto DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS nome_arquivo_pdf VARCHAR(255)`,
            // Garante tabelas de engenharia
            `CREATE TABLE IF NOT EXISTS furos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), proposta_id UUID REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(50), data_inicio TIMESTAMP, data_termino TIMESTAMP, nivel_agua_inicial DECIMAL(5,2), nivel_agua_final DECIMAL(5,2), coordenadas VARCHAR(100))`,
            `CREATE TABLE IF NOT EXISTS amostras (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini DECIMAL(5,2), profundidade_fim DECIMAL(5,2), golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT)`,
            `CREATE TABLE IF NOT EXISTS fotos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, url_imagem TEXT, legenda VARCHAR(255))`
        ];

        for (const sql of updates) {
            try {
                await pool.query(sql);
                logs.push(`✅ Executado: ${sql.substring(0, 50)}...`);
            } catch (e) {
                logs.push(`⚠️ Ignorado (já existe?): ${sql.substring(0, 30)}...`);
            }
        }

        // 3. Garante Admin
        await pool.query(`INSERT INTO empresas (nome_fantasia, email_dono, cnpj) VALUES ('SondaSaaS Matriz', 'admin@sondasaas.com', '0001') ON CONFLICT DO NOTHING`);
        const userCheck = await pool.query("SELECT * FROM usuarios WHERE email = 'admin@sondasaas.com'");
        if(userCheck.rows.length === 0) {
             const emp = await pool.query("SELECT id FROM empresas WHERE email_dono = 'admin@sondasaas.com'");
             await pool.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso) VALUES ($1, 'Admin', 'admin@sondasaas.com', '123456', 'admin')`, [emp.rows[0].id]);
             logs.push('✅ Usuário Admin recriado.');
        }

        res.send(`<h1>REPARO CONCLUÍDO</h1><pre>${logs.join('\n')}</pre><br><a href="/login">IR PARA LOGIN</a>`);

    } catch (err) {
        res.status(500).send(`<h1>ERRO FATAL</h1><pre>${err.message}</pre>`);
    }
});

// --- 3. MIDDLEWARES E ROTAS ---
const checkAuth = (req, res, next) => { 
    if (req.session.user) next(); 
    else res.redirect('/login'); 
};

// Páginas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/orcamento', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 
app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/boletim', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// API Login
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email.trim()]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (String(senha).trim() === String(user.senha_hash).trim()) {
                req.session.user = { id: user.id, empresa_id: user.empresa_id, nome: user.nome };
                return res.sendStatus(200);
            }
        }
        res.status(401).send('Credenciais inválidas');
    } catch (err) { res.status(500).send(err.message); }
});

// --- CONTROLLERS (NOMES EXATOS DO SEU EXPLORER) ---
const propostasController = require('./controllers/propostasController'); // CamelCase
const boletimController = require('./controllers/boletimcontroller');     // minúsculo

// Rotas API
app.get('/api/propostas', checkAuth, propostasController.listarPropostas);
app.post('/gerar-proposta', checkAuth, propostasController.criarProposta);
app.get('/api/propostas/:id/pdf', checkAuth, propostasController.gerarPDFComercial);
app.get('/gerar-pdf/:id', checkAuth, propostasController.gerarPDFComercial);
app.post('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus);
app.patch('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus);
app.delete('/api/propostas/:id', checkAuth, propostasController.deletarProposta);

// Rotas Engenharia
app.get('/api/boletim/furos/:obraId', checkAuth, boletimController.listarFuros);
app.post('/api/boletim/furos', checkAuth, boletimController.criarFuro);
app.get('/api/boletim/amostras/:furoId', checkAuth, boletimController.listarAmostras);
app.post('/api/boletim/amostras', checkAuth, boletimController.salvarAmostra);
app.post('/api/boletim/fotos', checkAuth, boletimController.salvarFoto);
app.put('/api/boletim/furos/:id', checkAuth, boletimController.atualizarFuro);
app.get('/api/engenharia/:id', checkAuth, boletimController.dadosCompletosObra);

// --- START ---
// Roda o auto-reparo no start também, mas temos a rota manual por segurança
app.listen(port, () => { console.log(`>>> 🚀 SONDASAAS NO AR (${port})`); });