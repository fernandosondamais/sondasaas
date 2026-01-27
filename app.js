require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const session = require('express-session');

// --- 1. CONFIGURAÇÃO DO BANCO ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } 
});

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_sonda_saas',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } 
}));

// --- 2. FUNÇÃO DE AUTO-REPARO E MIGRAÇÃO ---
async function iniciarBanco() {
    try {
        console.log('>>> 🛠️ INICIANDO VERIFICAÇÃO E MIGRAÇÃO DO BANCO...');
        
        // 1. Cria tabelas básicas se não existirem
        await pool.query(`
            CREATE TABLE IF NOT EXISTS empresas (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                nome_fantasia VARCHAR(255),
                email_dono VARCHAR(255),
                cnpj VARCHAR(50),
                data_criacao TIMESTAMP DEFAULT NOW()
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                empresa_id UUID REFERENCES empresas(id),
                nome VARCHAR(255),
                email VARCHAR(255) UNIQUE,
                senha_hash VARCHAR(255),
                nivel_acesso VARCHAR(50),
                data_criacao TIMESTAMP DEFAULT NOW()
            );
        `);

        // Cria a tabela propostas se ela NÃO existir
        await pool.query(`
            CREATE TABLE IF NOT EXISTS propostas (
                id SERIAL PRIMARY KEY,
                empresa_id UUID REFERENCES empresas(id),
                cliente VARCHAR(255),
                email VARCHAR(255),
                telefone VARCHAR(50),
                endereco TEXT,
                furos_previstos INTEGER,
                metragem_total DECIMAL(10,2),
                valor_total DECIMAL(10,2),
                status VARCHAR(50) DEFAULT 'Pendente',
                tecnico_responsavel VARCHAR(255),
                data_criacao TIMESTAMP DEFAULT NOW()
            );
        `);

        // --- A CORREÇÃO DO ERRO (MIGRAÇÃO) ---
        // Tenta adicionar a coluna empresa_id na tabela antiga, se ela não existir
        try {
            console.log('>>> 💉 APLICANDO VACINA NA TABELA PROPOSTAS...');
            await pool.query(`ALTER TABLE propostas ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)`);
            await pool.query(`ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_total DECIMAL(10,2)`);
            await pool.query(`ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Pendente'`);
        } catch (e) {
            console.log('>>> Tabela propostas já está atualizada.');
        }

        // 2. Garante o ADMIN e a EMPRESA MATRIZ
        const checkAdmin = await pool.query("SELECT * FROM usuarios WHERE email = 'admin@sondasaas.com'");
        let adminEmpresaId = null;

        if (checkAdmin.rows.length === 0) {
            console.log('>>> 👤 RECRIANDO ADMIN...');
            // Cria empresa
            const empRes = await pool.query(`
                INSERT INTO empresas (nome_fantasia, email_dono, cnpj) 
                VALUES ('SondaSaaS Matriz', 'admin@sondasaas.com', '0001') 
                RETURNING id
            `);
            adminEmpresaId = empRes.rows[0].id;

            // Cria usuário
            await pool.query(`
                INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso)
                VALUES ($1, 'Admin Supremo', 'admin@sondasaas.com', '123456', 'admin')
            `, [adminEmpresaId]);
        } else {
            adminEmpresaId = checkAdmin.rows[0].empresa_id;
        }

        // 3. SALVA AS PROPOSTAS ÓRFÃS (Se existiam propostas antigas, joga elas pro Admin)
        if (adminEmpresaId) {
            await pool.query(`UPDATE propostas SET empresa_id = $1 WHERE empresa_id IS NULL`, [adminEmpresaId]);
            console.log('>>> 🏚️ Propostas antigas recuperadas e vinculadas ao Admin.');
        }

        console.log('>>> ✅ SISTEMA 100% OPERACIONAL!');

    } catch (err) {
        console.error('!!! ERRO AO INICIAR BANCO !!!', err);
    }
}

// --- 3. MIDDLEWARES E ROTAS ---
const checkAuth = (req, res, next) => { 
    if (req.session.user) next(); 
    else res.redirect('/login'); 
};

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
        const result = await pool.query("SELECT * FROM usuarios WHERE TRIM(email) = TRIM($1)", [email]);
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

// Importar Controllers
const propostasController = require('./controllers/propostasController');
app.get('/api/propostas', checkAuth, propostasController.listarPropostas);
app.post('/gerar-proposta', checkAuth, propostasController.criarProposta);
app.get('/gerar-pdf/:id', checkAuth, propostasController.gerarPDFComercial);

// INICIALIZAÇÃO
iniciarBanco().then(() => {
    app.listen(port, () => { console.log(`>>> SondaSaaS ON na porta ${port} <<<`); });
});