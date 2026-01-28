require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const PDFDocument = require('pdfkit');
// Importa o pool do db.js que está correto
const pool = require('./config/db');

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURAÇÕES ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

app.use(session({
    secret: 'sonda_saas_chave_mestra_v2',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// --- FUNÇÃO AUXILIAR: REPARO DO BANCO (RODA NO START) ---
async function iniciarSistema() {
    try {
        console.log('>>> 🚀 INICIANDO SONDASAAS (MODO MONOLITO)...');
        console.log('>>> 🛠️  VERIFICANDO TABELAS E COLUNAS...');

        // 1. Garante UUID
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

        // 2. Garante Tabelas Principais
        await pool.query(`CREATE TABLE IF NOT EXISTS empresas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), nome_fantasia VARCHAR(255), email_dono VARCHAR(255), cnpj VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), nome VARCHAR(255), email VARCHAR(255) UNIQUE, senha_hash VARCHAR(255), nivel_acesso VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        
        // 3. Garante Tabela Propostas e Colunas Novas (V2)
        await pool.query(`CREATE TABLE IF NOT EXISTS propostas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), cliente VARCHAR(255), email VARCHAR(255), telefone VARCHAR(50), endereco TEXT, furos_previstos INTEGER, metragem_total DECIMAL(10,2), valor_total DECIMAL(10,2), status VARCHAR(50) DEFAULT 'ORCAMENTO', tecnico_responsavel VARCHAR(255), data_criacao TIMESTAMP DEFAULT NOW());`);
        
        const updatesProposta = [
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tecnico_responsavel VARCHAR(255)`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ORCAMENTO'`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_art DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_mobilizacao DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_desconto DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS nome_arquivo_pdf VARCHAR(255)`
        ];
        for(let sql of updatesProposta) { try { await pool.query(sql); } catch(e){} }

        // 4. Garante Tabelas de Engenharia
        await pool.query(`CREATE TABLE IF NOT EXISTS furos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), proposta_id UUID REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(50), data_inicio TIMESTAMP, data_termino TIMESTAMP, nivel_agua_inicial DECIMAL(5,2), nivel_agua_final DECIMAL(5,2), coordenadas VARCHAR(100));`);
        await pool.query(`CREATE TABLE IF NOT EXISTS amostras (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini DECIMAL(5,2), profundidade_fim DECIMAL(5,2), golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS fotos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, url_imagem TEXT, legenda VARCHAR(255));`);

        // 5. Garante Admin
        const checkAdmin = await pool.query("SELECT * FROM usuarios WHERE email = 'admin@sondasaas.com'");
        if (checkAdmin.rows.length === 0) {
            const empRes = await pool.query(`INSERT INTO empresas (nome_fantasia, email_dono, cnpj) VALUES ('SondaSaaS Matriz', 'admin@sondasaas.com', '0001') RETURNING id`);
            await pool.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso) VALUES ($1, 'Admin Supremo', 'admin@sondasaas.com', '123456', 'admin')`, [empRes.rows[0].id]);
        }

        console.log('>>> ✅ SISTEMA PRONTO E BANCO CORRIGIDO.');
    } catch (e) {
        console.error('!!! ERRO CRÍTICO NO STARTUP !!!', e);
    }
}

// --- FUNÇÃO AUXILIAR: GERADOR DE PDF (EMBUTIDO) ---
const montarLayoutPDF = (doc, p, empresa) => {
    const COLORS = { SONDA_GREEN: '#2c3e50', DARK_TEXT: '#333333', LIGHT_BG: '#f5f5f5', BORDER: '#dddddd' };
    
    doc.rect(0, 0, 600, 80).fill(COLORS.SONDA_GREEN);
    doc.fillColor('#ffffff').fontSize(22).text(empresa.nome_fantasia ? empresa.nome_fantasia.toUpperCase() : 'SONDA SAAS', 30, 30);
    doc.fontSize(10).text('RELATÓRIO DE ORÇAMENTO TÉCNICO', 30, 55);

    doc.fillColor(COLORS.DARK_TEXT).fontSize(12).text('DADOS DO CLIENTE', 30, 110, { underline: true });
    doc.fontSize(10).text(`Cliente: ${p.cliente}`, 30, 130);
    doc.text(`Endereço: ${p.endereco || '-'}`, 30, 145);
    doc.text(`Contato: ${p.telefone || '-'} | ${p.email || '-'}`, 30, 160);

    let y = 200;
    doc.rect(30, y, 535, 20).fill(COLORS.LIGHT_BG);
    doc.fillColor(COLORS.DARK_TEXT).text('Descrição', 35, y + 5);
    doc.text('Qtd', 300, y + 5);
    doc.text('Total', 480, y + 5);

    y += 30;
    const total = parseFloat(p.valor_total || 0);
    const art = parseFloat(p.valor_art || 0);
    const mob = parseFloat(p.valor_mobilizacao || 0);
    const desc = parseFloat(p.valor_desconto || 0);
    const sondagem = total - art - mob + desc;

    doc.text('Sondagem SPT', 35, y);
    doc.text(`${p.metragem_total}m`, 300, y);
    doc.text(`R$ ${sondagem.toFixed(2)}`, 480, y);

    y += 20; doc.text('Mobilização', 35, y); doc.text('1', 300, y); doc.text(`R$ ${mob.toFixed(2)}`, 480, y);
    y += 20; doc.text('ART', 35, y); doc.text('1', 300, y); doc.text(`R$ ${art.toFixed(2)}`, 480, y);
    
    if(desc > 0) {
        y += 20; doc.fillColor('red').text('Desconto', 35, y); doc.text('-', 300, y); doc.text(`- R$ ${desc.toFixed(2)}`, 480, y);
    }

    y += 40;
    doc.fillColor(COLORS.DARK_TEXT).fontSize(14).text(`TOTAL GERAL: R$ ${total.toFixed(2)}`, 300, y, { bold: true });
};

// --- MIDDLEWARES ---
const checkAuth = (req, res, next) => {
    if (req.session && req.session.user) next();
    else if(req.path.includes('/api/')) res.status(401).json({error: 'Não autorizado'});
    else res.redirect('/login');
};

// --- ROTAS (PÁGINAS) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/orcamento', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html')));
app.get('/boletim', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- ROTAS (API - LÓGICA DO SISTEMA) ---

// 1. LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        const result = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email.trim()]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (String(senha).trim() === String(user.senha_hash).trim()) {
                req.session.user = { id: user.id, empresa_id: user.empresa_id, nome: user.nome };
                return res.json({ ok: true });
            }
        }
        res.status(401).send('Erro no login');
    } catch (e) { res.status(500).send(e.message); }
});

// 2. PROPOSTAS (Listar e Criar)
app.get('/api/propostas', checkAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE empresa_id = $1 ORDER BY data_criacao DESC', [req.session.user.empresa_id]);
        res.json(result.rows);
    } catch (e) { res.status(500).json(e); }
});

app.post('/gerar-proposta', checkAuth, async (req, res) => {
    try {
        const d = req.body;
        const total = (parseFloat(d.metragem)*parseFloat(d.valor_metro)) + parseFloat(d.art) + parseFloat(d.mobilizacao) - parseFloat(d.desconto);
        
        // INSERT V2
        const sql = `INSERT INTO propostas (empresa_id, cliente, telefone, email, endereco, furos_previstos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, tecnico_responsavel, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ORCAMENTO') RETURNING *`;
        const values = [req.session.user.empresa_id, d.cliente, d.telefone, d.email, d.endereco, d.furos, d.metragem, d.art, d.mobilizacao, d.desconto, total, req.session.user.nome];
        
        const result = await pool.query(sql, values);
        
        // Gera PDF na hora
        const empRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [req.session.user.empresa_id]);
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        doc.pipe(res);
        montarLayoutPDF(doc, result.rows[0], empRes.rows[0]);
        doc.end();
    } catch (e) { console.error(e); res.status(500).send('Erro: ' + e.message); }
});

// 3. GERAR PDF (Via Botão)
app.get('/api/propostas/:id/pdf', checkAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [req.params.id]);
        if(result.rows.length === 0) return res.status(404).send('Não achou');
        const empRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [req.session.user.empresa_id]);
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        doc.pipe(res);
        montarLayoutPDF(doc, result.rows[0], empRes.rows[0]);
        doc.end();
    } catch (e) { res.status(500).send(e.message); }
});

// 4. ATUALIZAR STATUS (CRM)
app.patch('/api/propostas/:id/status', checkAuth, async (req, res) => {
    try {
        await pool.query('UPDATE propostas SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
        res.sendStatus(200);
    } catch (e) { res.status(500).json(e); }
});
// Rota de fallback para POST
app.post('/api/propostas/:id/status', checkAuth, async (req, res) => {
    try {
        await pool.query('UPDATE propostas SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
        res.sendStatus(200);
    } catch (e) { res.status(500).json(e); }
});

// 5. DELETAR
app.delete('/api/propostas/:id', checkAuth, async (req, res) => {
    try { await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]); res.sendStatus(200); } catch(e) { res.status(500).send(e); }
});

// --- API ENGENHARIA (BOLETIM) ---
app.get('/api/boletim/furos/:obraId', checkAuth, async (req, res) => {
    try {
        const r = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY data_inicio", [req.params.obraId]);
        res.json(r.rows);
    } catch(e) { res.status(500).json(e); }
});

app.post('/api/boletim/furos', checkAuth, async (req, res) => {
    try {
        const { proposta_id, nome_furo, coordenadas } = req.body;
        const r = await pool.query("INSERT INTO furos (proposta_id, nome_furo, coordenadas, data_inicio) VALUES ($1, $2, $3, NOW()) RETURNING *", [proposta_id, nome_furo, coordenadas]);
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json(e); }
});

app.get('/api/boletim/amostras/:furoId', checkAuth, async (req, res) => {
    try {
        const r = await pool.query("SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini", [req.params.furoId]);
        res.json(r.rows);
    } catch(e) { res.status(500).json(e); }
});

app.post('/api/boletim/amostras', checkAuth, async (req, res) => {
    try {
        const d = req.body;
        const r = await pool.query("INSERT INTO amostras (furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *", [d.furo_id, d.profundidade_ini, d.profundidade_fim, d.golpe_1, d.golpe_2, d.golpe_3, d.tipo_solo]);
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json(e); }
});

app.post('/api/boletim/fotos', checkAuth, async (req, res) => {
    try {
        await pool.query("INSERT INTO fotos (furo_id, url_imagem, legenda) VALUES ($1, $2, $3)", [req.body.furo_id, req.body.imagem_base64, req.body.legenda]);
        res.sendStatus(200);
    } catch(e) { res.status(500).json(e); }
});

app.put('/api/boletim/furos/:id', checkAuth, async (req, res) => {
    try {
        const d = req.body;
        await pool.query("UPDATE furos SET nivel_agua_inicial=$1, nivel_agua_final=$2, data_inicio=$3, data_termino=$4, coordenadas=$5 WHERE id=$6", [d.nivel_agua_inicial, d.nivel_agua_final, d.data_inicio, d.data_termino, d.coordenadas, req.params.id]);
        res.sendStatus(200);
    } catch(e) { res.status(500).json(e); }
});

// Dados Completos para Tela de Engenharia
app.get('/api/engenharia/:id', checkAuth, async (req, res) => {
    try {
        const pRes = await pool.query("SELECT * FROM propostas WHERE id = $1", [req.params.id]);
        if(pRes.rows.length === 0) return res.status(404).send('Nada');
        
        const fRes = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY nome_furo", [req.params.id]);
        const furos = fRes.rows;
        
        for(let f of furos) {
            const a = await pool.query("SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini", [f.id]);
            f.amostras = a.rows;
            const ft = await pool.query("SELECT * FROM fotos WHERE furo_id = $1", [f.id]);
            f.fotos = ft.rows;
        }
        res.json({ proposta: pRes.rows[0], furos });
    } catch(e) { res.status(500).json(e); }
});

// --- INICIALIZAÇÃO ---
iniciarSistema().then(() => {
    app.listen(port, () => { console.log(`>>> SISTEMA RESTAURADO E ONLINE NA PORTA ${port}`); });
});