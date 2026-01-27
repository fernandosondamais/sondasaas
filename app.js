require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;

// --- 1. CONFIGURAÇÃO DE CONEXÃO (ROBUSTA) ---

// Aqui está o segredo: Se ele não achar a variável de ambiente (seu erro local), 
// ele usa essa string gigante que copiei do seu print.
const connectionString = process.env.DATABASE_URL || "postgres://sondasaas_db_user:QhOwhbqwMaso6EpV49iC29JIHRbNaabb@dpg-d5ocbter433s7381d8rg-a.virginia-postgres.render.com/sondasaas_db";

// Detecta se é produção para ajustar o SSL
const isProduction = connectionString.includes('render.com');

console.log('--------------------------------------------------');
console.log('>>> 🔌 TENTANDO CONEXÃO COM O BANCO...');
console.log('>>> URL em uso:', isProduction ? 'Link do Render (Nuvem)' : 'Link Local/Outro');
console.log('--------------------------------------------------');

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false 
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_sonda_saas',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Mantém false para funcionar local e na nuvem sem https forçado
}));

// --- 2. AUTO-REPARO DO BANCO (CRIA TABELAS E CORRIGE ERROS) ---
async function iniciarBanco() {
    try {
        console.log('>>> 🛠️  VERIFICANDO TABELAS...');
        
        // Tabelas Essenciais
        await pool.query(`CREATE TABLE IF NOT EXISTS empresas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_fantasia VARCHAR(255), email_dono VARCHAR(255), cnpj VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID REFERENCES empresas(id), nome VARCHAR(255), email VARCHAR(255) UNIQUE, senha_hash VARCHAR(255), nivel_acesso VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        
        // Cria tabela Propostas
        await pool.query(`CREATE TABLE IF NOT EXISTS propostas (id SERIAL PRIMARY KEY, empresa_id UUID REFERENCES empresas(id), cliente VARCHAR(255), email VARCHAR(255), telefone VARCHAR(50), endereco TEXT, furos_previstos INTEGER, metragem_total DECIMAL(10,2), valor_total DECIMAL(10,2), status VARCHAR(50) DEFAULT 'Pendente', tecnico_responsavel VARCHAR(255), data_criacao TIMESTAMP DEFAULT NOW());`);

        // --- MIGRAÇÃO DE EMERGÊNCIA (CORRIGE O ERRO DE COLUNA FALTANDO) ---
        try {
            // Tenta adicionar colunas que faltavam na versão antiga
            await pool.query(`ALTER TABLE propostas ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)`);
            await pool.query(`ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_total DECIMAL(10,2)`);
            await pool.query(`ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Pendente'`);
        } catch (e) { 
            // Se der erro aqui é porque já existe, então segue o baile
        }

        // --- GARANTE O ADMIN ---
        const checkAdmin = await pool.query("SELECT * FROM usuarios WHERE email = 'admin@sondasaas.com'");
        if (checkAdmin.rows.length === 0) {
            console.log('>>> 👤 RECRIANDO ADMIN...');
            // Cria empresa matriz
            const empRes = await pool.query(`INSERT INTO empresas (nome_fantasia, email_dono, cnpj) VALUES ('SondaSaaS Matriz', 'admin@sondasaas.com', '0001') RETURNING id`);
            // Cria usuário
            await pool.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso) VALUES ($1, 'Admin Supremo', 'admin@sondasaas.com', '123456', 'admin')`, [empRes.rows[0].id]);
        }
        
        // Se houver propostas sem dono (do banco antigo), vincula ao admin
        const adminUser = await pool.query("SELECT empresa_id FROM usuarios WHERE email = 'admin@sondasaas.com'");
        if (adminUser.rows.length > 0) {
            await pool.query(`UPDATE propostas SET empresa_id = $1 WHERE empresa_id IS NULL`, [adminUser.rows[0].empresa_id]);
        }
        
        console.log('>>> ✅ BANCO PRONTO E TABELAS VERIFICADAS!');

    } catch (err) {
        console.error('!!! ERRO FATAL NA CONEXÃO !!!', err.message);
    }
}

// --- 3. ROTAS E MIDDLEWARES ---
const checkAuth = (req, res, next) => { 
    if (req.session.user) next(); 
    else res.redirect('/login'); 
};

// Páginas HTML
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/orcamento', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// API Login
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        // Busca usuário ignorando espaços em branco
        const result = await pool.query("SELECT * FROM usuarios WHERE TRIM(email) = TRIM($1)", [email]);
        
        if (result.rows.length > 0) {
            const user = result.rows[0];
            // Compara senha (simples texto por enquanto)
            if (String(senha).trim() === String(user.senha_hash).trim()) {
                req.session.user = { id: user.id, empresa_id: user.empresa_id, nome: user.nome };
                return res.sendStatus(200);
            }
        }
        res.status(401).send('Credenciais inválidas');
    } catch (err) { 
        console.error(err);
        res.status(500).send(err.message); 
    }
});

// Controllers de Proposta
const propostasController = require('./controllers/propostasController');
app.get('/api/propostas', checkAuth, propostasController.listarPropostas);
app.post('/gerar-proposta', checkAuth, propostasController.criarProposta);
app.get('/gerar-pdf/:id', checkAuth, propostasController.gerarPDFComercial);
app.post('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus);
app.delete('/api/propostas/:id', checkAuth, propostasController.deletarProposta);

// --- 4. INICIALIZAÇÃO ---
iniciarBanco().then(() => {
    app.listen(port, () => { console.log(`>>> 🚀 SondaSaaS RODANDO na porta ${port}`); });
});