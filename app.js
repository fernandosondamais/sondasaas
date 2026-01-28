require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;

// --- 1. CONFIGURAÇÃO DE CONEXÃO (HÍBRIDA) ---
const connectionString = process.env.DATABASE_URL || "postgres://sondasaas_db_user:QhOwhbqwMaso6EpV49iC29JIHRbNaabb@dpg-d5ocbter433s7381d8rg-a.virginia-postgres.render.com/sondasaas_db";
const isProduction = connectionString.includes('render.com');

console.log('>>> 🔌 TENTANDO CONEXÃO COM O BANCO...');
console.log('>>> URL em uso:', isProduction ? 'Link do Render (Nuvem)' : 'Link Local/Fallback');

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false 
});

// Exporta o pool para ser usado nos controllers
module.exports = { pool };

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_sonda_saas',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } 
}));

// --- 2. AUTO-REPARO DO BANCO ---
async function iniciarBanco() {
    try {
        console.log('>>> 🛠️  VERIFICANDO TABELAS...');
        await pool.query(`CREATE TABLE IF NOT EXISTS empresas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_fantasia VARCHAR(255), email_dono VARCHAR(255), cnpj VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID REFERENCES empresas(id), nome VARCHAR(255), email VARCHAR(255) UNIQUE, senha_hash VARCHAR(255), nivel_acesso VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS propostas (id SERIAL PRIMARY KEY, empresa_id UUID REFERENCES empresas(id), cliente VARCHAR(255), email VARCHAR(255), telefone VARCHAR(50), endereco TEXT, furos_previstos INTEGER, metragem_total DECIMAL(10,2), valor_total DECIMAL(10,2), status VARCHAR(50) DEFAULT 'Pendente', tecnico_responsavel VARCHAR(255), data_criacao TIMESTAMP DEFAULT NOW(), valor_art DECIMAL(10,2), valor_mobilizacao DECIMAL(10,2), valor_desconto DECIMAL(10,2));`);
        
        await pool.query(`CREATE TABLE IF NOT EXISTS furos (id SERIAL PRIMARY KEY, proposta_id INTEGER REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(50), data_inicio TIMESTAMP, data_termino TIMESTAMP, nivel_agua_inicial DECIMAL(5,2), nivel_agua_final DECIMAL(5,2), coordenadas VARCHAR(100));`);
        await pool.query(`CREATE TABLE IF NOT EXISTS amostras (id SERIAL PRIMARY KEY, furo_id INTEGER REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini DECIMAL(5,2), profundidade_fim DECIMAL(5,2), golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS fotos (id SERIAL PRIMARY KEY, furo_id INTEGER REFERENCES furos(id) ON DELETE CASCADE, imagem_base64 TEXT, legenda VARCHAR(255));`);

        const checkAdmin = await pool.query("SELECT * FROM usuarios WHERE email = 'admin@sondasaas.com'");
        if (checkAdmin.rows.length === 0) {
            console.log('>>> 👤 RECRIANDO ADMIN...');
            const empRes = await pool.query(`INSERT INTO empresas (nome_fantasia, email_dono, cnpj) VALUES ('SondaSaaS Matriz', 'admin@sondasaas.com', '0001') RETURNING id`);
            await pool.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso) VALUES ($1, 'Admin Supremo', 'admin@sondasaas.com', '123456', 'admin')`, [empRes.rows[0].id]);
        }
        console.log('>>> ✅ BANCO PRONTO!');
    } catch (err) {
        console.error('!!! ERRO FATAL NA CONEXÃO !!!', err.message);
    }
}

// --- 3. ROTAS ---
const checkAuth = (req, res, next) => { 
    if (req.session.user) next(); 
    else res.redirect('/login'); 
};

// Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/orcamento', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 
app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/boletim', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// Auth API
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

// Controllers
const propostasController = require('./controllers/propostasController');
const engenhariaController = require('./controllers/engenhariaController');

// Propostas & CRM
app.get('/api/propostas', checkAuth, propostasController.listarPropostas);
app.post('/gerar-proposta', checkAuth, propostasController.criarProposta);
app.get('/api/propostas/:id/pdf', checkAuth, propostasController.gerarPDFComercial);
app.patch('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus);
app.delete('/api/propostas/:id', checkAuth, propostasController.deletarProposta);

// Engenharia & Boletim
app.get('/api/obras/ativas', checkAuth, engenhariaController.listarObrasAtivas);
app.get('/api/furos/:propostaId', checkAuth, engenhariaController.listarFuros);
app.post('/api/furos', checkAuth, engenhariaController.salvarFuro);
app.post('/api/amostras', checkAuth, engenhariaController.salvarAmostra);

iniciarBanco().then(() => {
    app.listen(port, () => { console.log(`>>> 🚀 SondaSaaS RODANDO na porta ${port}`); });
});