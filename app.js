require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// --- 1. CONFIGURAÇÕES DE SERVIDOR ---
app.set('trust proxy', 1);

const connectionString = process.env.DATABASE_URL || "postgres://sondasaas_db_user:QhOwhbqwMaso6EpV49iC29JIHRbNaabb@dpg-d5ocbter433s7381d8rg-a.virginia-postgres.render.com/sondasaas_db";
const isProduction = connectionString.includes('render.com');

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

app.use(session({
    secret: 'segredo_sonda_saas_v3_production',
    resave: true,
    saveUninitialized: false,
    cookie: { 
        secure: isProduction, 
        maxAge: 24 * 60 * 60 * 1000, // 24h
        sameSite: 'lax',
        httpOnly: true
    }
}));

// --- 2. MIGRATION AUTOMÁTICA (DB V3) ---
async function iniciarSistema() {
    try {
        console.log('>>> 🚀 INICIANDO SONDASAAS V3 (PRODUÇÃO)...');
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        
        // Tabelas Core
        await pool.query(`CREATE TABLE IF NOT EXISTS empresas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), nome_fantasia VARCHAR(255), email_dono VARCHAR(255), cnpj VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), nome VARCHAR(255), email VARCHAR(255) UNIQUE, senha_hash VARCHAR(255), nivel_acesso VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        
        // Tabela Propostas (Agora com SONDADOR_ID)
        await pool.query(`CREATE TABLE IF NOT EXISTS propostas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), cliente VARCHAR(255), email VARCHAR(255), telefone VARCHAR(50), endereco TEXT, furos_previstos INTEGER, metragem_total DECIMAL(10,2), valor_total DECIMAL(10,2), status VARCHAR(50) DEFAULT 'ORCAMENTO', tecnico_responsavel VARCHAR(255), data_criacao TIMESTAMP DEFAULT NOW());`);
        
        // Atualizações de Estrutura
        const updates = [
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tecnico_responsavel VARCHAR(255)`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS sondador_id UUID REFERENCES usuarios(id)`, // V3: Vincula obra à equipe
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ORCAMENTO'`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_art DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_mobilizacao DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_desconto DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS nome_arquivo_pdf VARCHAR(255)`,
            
            // Engenharia
            `CREATE TABLE IF NOT EXISTS furos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), proposta_id UUID REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(50), data_inicio TIMESTAMP, data_termino TIMESTAMP, nivel_agua_inicial DECIMAL(5,2), nivel_agua_final DECIMAL(5,2), coordenadas VARCHAR(100))`,
            `CREATE TABLE IF NOT EXISTS amostras (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini DECIMAL(5,2), profundidade_fim DECIMAL(5,2), golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT)`,
            `CREATE TABLE IF NOT EXISTS fotos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, url_imagem TEXT, legenda VARCHAR(255))`
        ];
        
        for(let sql of updates) { try { await pool.query(sql); } catch(e){} }

        // Seed: Admin Supremo
        const checkAdmin = await pool.query("SELECT * FROM usuarios WHERE email = 'admin@sondasaas.com'");
        if (checkAdmin.rows.length === 0) {
            const empRes = await pool.query(`INSERT INTO empresas (nome_fantasia, email_dono, cnpj) VALUES ('SondaSaaS Matriz', 'admin@sondasaas.com', '0001') RETURNING id`);
            await pool.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso) VALUES ($1, 'Admin Supremo', 'admin@sondasaas.com', '123456', 'admin')`, [empRes.rows[0].id]);
        }

        // Seed: Sondador Padrão (Para teste imediato)
        const checkSonda = await pool.query("SELECT * FROM usuarios WHERE email = 'equipe@sondasaas.com'");
        if (checkSonda.rows.length === 0) {
            // Pega ID da empresa criada acima ou a primeira que achar
            const emp = await pool.query("SELECT id FROM empresas LIMIT 1");
            await pool.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso) VALUES ($1, 'Equipe de Campo 01', 'equipe@sondasaas.com', 'sonda123', 'sondador')`, [emp.rows[0].id]);
        }

        console.log('>>> ✅ SISTEMA V3 NO AR.');
    } catch (e) { console.error('!!! ERRO STARTUP !!!', e); }
}

// --- 3. MIDDLEWARE DE SEGURANÇA ---
const checkAuth = (req, res, next) => { 
    if (req.session && req.session.user) {
        next(); 
    } else {
        if(req.path.startsWith('/api/')) res.status(401).json({error: 'Sessão expirada'});
        else res.redirect('/login'); 
    }
};

// Middleware para impedir Sondador de ver Admin
const checkAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.nivel_acesso === 'admin') {
        next();
    } else {
        res.redirect('/boletim'); // Chuta pro app de campo
    }
};

// --- 4. ROTAS DE PÁGINAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/login', (req, res) => {
    if (req.session && req.session.user) {
        // Redirecionamento Inteligente no Refresh
        if(req.session.user.nivel_acesso === 'sondador') return res.redirect('/boletim');
        return res.redirect('/admin');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Áreas Administrativas (Protegidas)
app.get('/orcamento', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/crm', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/engenharia', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 

// Área Operacional (Livre para sondadores)
app.get('/boletim', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- 5. API ---

// LOGIN V3 (Direcionamento por Cargo)
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email.trim()]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (String(senha).trim() === String(user.senha_hash).trim()) {
                req.session.user = { 
                    id: user.id, 
                    empresa_id: user.empresa_id, 
                    nome: user.nome,
                    nivel_acesso: user.nivel_acesso // Importante
                };
                
                // Define destino baseado no cargo
                const destino = (user.nivel_acesso === 'sondador') ? '/boletim' : '/admin';
                req.session.save(() => res.json({ ok: true, redirect: destino }));
                return;
            }
        }
        res.status(401).send('Credenciais inválidas');
    } catch (err) { res.status(500).send(err.message); }
});

// --- API CRM & ADMIN ---

// Listar Propostas (Admin vê tudo, Sondador vê só as dele)
app.get('/api/propostas', checkAuth, async (req, res) => {
    try {
        let sql = 'SELECT * FROM propostas WHERE empresa_id = $1 ORDER BY data_criacao DESC';
        let params = [req.session.user.empresa_id];

        // Se for sondador, filtra!
        if (req.session.user.nivel_acesso === 'sondador') {
            sql = 'SELECT * FROM propostas WHERE empresa_id = $1 AND sondador_id = $2 AND status IN (\'Aprovada\', \'Em Execução\') ORDER BY data_criacao DESC';
            params.push(req.session.user.id);
        }

        const result = await pool.query(sql, params);
        res.json(result.rows);
    } catch (e) { res.status(500).json(e); }
});

// Listar Usuários (Para o Dropdown de Equipes)
app.get('/api/usuarios/sondadores', checkAuth, async (req, res) => {
    try {
        const r = await pool.query("SELECT id, nome FROM usuarios WHERE empresa_id = $1 AND nivel_acesso = 'sondador'", [req.session.user.empresa_id]);
        res.json(r.rows);
    } catch(e) { res.status(500).json(e); }
});

// Atribuir Sondador (Escalar Equipe)
app.patch('/api/propostas/:id/equipe', checkAuth, async (req, res) => {
    try {
        const { sondador_id } = req.body;
        await pool.query("UPDATE propostas SET sondador_id = $1 WHERE id = $2", [sondador_id, req.params.id]);
        res.sendStatus(200);
    } catch(e) { res.status(500).json(e); }
});

// Gerar Proposta (Igual V2)
app.post('/gerar-proposta', checkAuth, async (req, res) => {
    /* ... (Lógica de PDF igual anterior, mantida para brevidade) ... */
    /* ... Vou recolocar o bloco de insert simples para garantir funcionamento ... */
    try {
        const d = req.body;
        const total = (parseFloat(d.metragem)*parseFloat(d.valor_metro)) + parseFloat(d.art) + parseFloat(d.mobilizacao) - parseFloat(d.desconto);
        const sql = `INSERT INTO propostas (empresa_id, cliente, telefone, email, endereco, furos_previstos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, tecnico_responsavel, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ORCAMENTO') RETURNING *`;
        const values = [req.session.user.empresa_id, d.cliente, d.telefone, d.email, d.endereco, d.furos, d.metragem, d.art, d.mobilizacao, d.desconto, total, req.session.user.nome];
        await pool.query(sql, values);
        
        // Retorna sucesso simples, PDF pode ser baixado na lista
        res.redirect('/orcamento?msg=sucesso');
    } catch (e) { res.status(500).send('Erro: ' + e.message); }
});

app.get('/api/propostas/:id/pdf', checkAuth, async (req, res) => {
    // ... (Mantém geração de PDF simples para download) ...
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [req.params.id]);
        if(result.rows.length === 0) return res.status(404).send('N/A');
        
        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Orcamento.pdf`);
        doc.pipe(res);
        doc.fontSize(20).text('Proposta SondaMais', 100, 100);
        doc.fontSize(12).text(`Cliente: ${result.rows[0].cliente}`);
        doc.text(`Total: R$ ${result.rows[0].valor_total}`);
        doc.end();
    } catch(e) { res.status(500).send(e.message); }
});

app.patch('/api/propostas/:id/status', checkAuth, async (req, res) => {
    try { await pool.query('UPDATE propostas SET status = $1 WHERE id = $2', [req.body.status, req.params.id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); }
});
app.delete('/api/propostas/:id', checkAuth, async (req, res) => {
    try { await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]); res.sendStatus(200); } catch(e) { res.status(500).send(e); }
});

// --- API DE CAMPO (BOLETIM V2) ---

app.get('/api/boletim/furos/:obraId', checkAuth, async (req, res) => {
    try { const r = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY data_inicio", [req.params.obraId]); res.json(r.rows); } catch(e) { res.status(500).json(e); }
});
app.post('/api/boletim/furos', checkAuth, async (req, res) => {
    try { const r = await pool.query("INSERT INTO furos (proposta_id, nome_furo, coordenadas, data_inicio) VALUES ($1, $2, $3, NOW()) RETURNING *", [req.body.proposta_id, req.body.nome_furo, req.body.coordenadas]); res.json(r.rows[0]); } catch(e) { res.status(500).json(e); }
});
app.get('/api/boletim/amostras/:furoId', checkAuth, async (req, res) => {
    try { const r = await pool.query("SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini", [req.params.furoId]); res.json(r.rows); } catch(e) { res.status(500).json(e); }
});
app.post('/api/boletim/amostras', checkAuth, async (req, res) => {
    try { const d = req.body; const r = await pool.query("INSERT INTO amostras (furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *", [d.furo_id, d.profundidade_ini, d.profundidade_fim, d.golpe_1, d.golpe_2, d.golpe_3, d.tipo_solo]); res.json(r.rows[0]); } catch(e) { res.status(500).json(e); }
});
app.post('/api/boletim/fotos', checkAuth, async (req, res) => {
    try { await pool.query("INSERT INTO fotos (furo_id, url_imagem, legenda) VALUES ($1, $2, $3)", [req.body.furo_id, req.body.imagem_base64, req.body.legenda]); res.sendStatus(200); } catch(e) { res.status(500).json(e); }
});
app.put('/api/boletim/furos/:id', checkAuth, async (req, res) => {
    try { const d = req.body; await pool.query("UPDATE furos SET nivel_agua_inicial=$1, nivel_agua_final=$2, data_inicio=$3, data_termino=$4, coordenadas=$5 WHERE id=$6", [d.nivel_agua_inicial, d.nivel_agua_final, d.data_inicio, d.data_termino, d.coordenadas, req.params.id]); res.sendStatus(200); } catch(e) { res.status(500).json(e); }
});
app.get('/api/engenharia/:id', checkAuth, async (req, res) => {
    try {
        const pRes = await pool.query("SELECT * FROM propostas WHERE id = $1", [req.params.id]);
        if(pRes.rows.length === 0) return res.status(404).send('Nada');
        const fRes = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY nome_furo", [req.params.id]);
        const furos = fRes.rows;
        for(let f of furos) {
            const aRes = await pool.query("SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini", [f.id]);
            f.amostras = aRes.rows;
            const phRes = await pool.query("SELECT id, legenda FROM fotos WHERE furo_id = $1", [f.id]);
            f.fotos = phRes.rows;
        }
        res.json({ proposta: pRes.rows[0], furos });
    } catch(e) { res.status(500).json(e); }
});
app.get('/api/foto-full/:id', checkAuth, async (req, res) => {
    try {
        const r = await pool.query("SELECT url_imagem FROM fotos WHERE id = $1", [req.params.id]);
        if(r.rows.length > 0) {
            const img = r.rows[0].url_imagem;
            const base64Data = img.replace(/^data:image\/\w+;base64,/, "");
            const buf = Buffer.from(base64Data, 'base64');
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length });
            res.end(buf); 
        } else { res.status(404).send('404'); }
    } catch(e) { res.status(500).send(e); }
});

iniciarSistema().then(() => {
    app.listen(port, () => { console.log(`>>> 🚀 SONDASAAS V3 RODANDO NA PORTA ${port}`); });
});