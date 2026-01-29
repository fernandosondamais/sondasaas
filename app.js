require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// --- 1. CONFIGURAÇÕES DE SERVIDOR E BANCO ---
app.set('trust proxy', 1); // Corrige o loop de sessão no Render

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
    secret: 'segredo_sonda_saas_v2_blindado',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: isProduction, 
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

// --- 2. AUTO-REPARO DO BANCO (RODA NO START) ---
async function iniciarSistema() {
    try {
        console.log('>>> 🚀 INICIANDO SONDASAAS (LAYOUT SONDAMAIS)...');
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        
        // Garante tabelas
        await pool.query(`CREATE TABLE IF NOT EXISTS empresas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), nome_fantasia VARCHAR(255), email_dono VARCHAR(255), cnpj VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), nome VARCHAR(255), email VARCHAR(255) UNIQUE, senha_hash VARCHAR(255), nivel_acesso VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS propostas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), cliente VARCHAR(255), email VARCHAR(255), telefone VARCHAR(50), endereco TEXT, furos_previstos INTEGER, metragem_total DECIMAL(10,2), valor_total DECIMAL(10,2), status VARCHAR(50) DEFAULT 'ORCAMENTO', tecnico_responsavel VARCHAR(255), data_criacao TIMESTAMP DEFAULT NOW());`);
        
        // Garante colunas
        const updates = [
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tecnico_responsavel VARCHAR(255)`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ORCAMENTO'`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_art DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_mobilizacao DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_desconto DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS nome_arquivo_pdf VARCHAR(255)`,
            // Tabelas Engenharia
            `CREATE TABLE IF NOT EXISTS furos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), proposta_id UUID REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(50), data_inicio TIMESTAMP, data_termino TIMESTAMP, nivel_agua_inicial DECIMAL(5,2), nivel_agua_final DECIMAL(5,2), coordenadas VARCHAR(100))`,
            `CREATE TABLE IF NOT EXISTS amostras (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini DECIMAL(5,2), profundidade_fim DECIMAL(5,2), golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT)`,
            `CREATE TABLE IF NOT EXISTS fotos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, url_imagem TEXT, legenda VARCHAR(255))`
        ];
        for(let sql of updates) { try { await pool.query(sql); } catch(e){} }

        // Garante Admin
        const checkAdmin = await pool.query("SELECT * FROM usuarios WHERE email = 'admin@sondasaas.com'");
        if (checkAdmin.rows.length === 0) {
            const empRes = await pool.query(`INSERT INTO empresas (nome_fantasia, email_dono, cnpj) VALUES ('SondaSaaS Matriz', 'admin@sondasaas.com', '0001') RETURNING id`);
            await pool.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso) VALUES ($1, 'Admin Supremo', 'admin@sondasaas.com', '123456', 'admin')`, [empRes.rows[0].id]);
        }
        console.log('>>> ✅ SISTEMA PRONTO.');
    } catch (e) { console.error('!!! ERRO STARTUP !!!', e); }
}

// --- 3. NOVO LAYOUT PDF (PADRÃO SONDAMAIS) ---
const montarLayoutPDF = (doc, p, empresa) => {
    // Cores da Identidade Visual (Verde SondaMais)
    const C_VERDE = '#8CBF26'; 
    const C_TEXTO = '#333333';
    
    // -- CABEÇALHO --
    const logoPath = path.join(__dirname, 'public', 'logo.png');
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, 30, { width: 100 }); // Logo à esquerda
    } else {
        doc.fillColor(C_VERDE).fontSize(20).font('Helvetica-Bold').text('SONDAMAIS', 40, 40);
    }

    // Endereço à Direita
    doc.fillColor(C_TEXTO).fontSize(9).font('Helvetica')
       .text('R. Luís Spiandorelli Neto, 60', 300, 30, { align: 'right' })
       .text('Valinhos, São Paulo, 13271-570', 300, 42, { align: 'right' })
       .text('(19) 99800-2260', 300, 54, { align: 'right' });

    doc.moveDown(4);

    // -- BLOCO DE METADADOS (Igual ao seu PDF) --
    let y = 100;
    doc.fillColor(C_VERDE).fontSize(14).font('Helvetica-Bold').text('Orçamento', 40, y);
    
    y += 25;
    // Linha 1
    doc.fillColor('#666').fontSize(8).font('Helvetica-Bold').text('Data', 40, y);
    doc.fillColor('#666').text('Pagamento', 200, y);
    doc.fillColor('#666').text('Número da Proposta', 400, y);
    
    y += 12;
    doc.fillColor(C_TEXTO).fontSize(9).font('Helvetica')
       .text(new Date().toLocaleDateString('pt-BR'), 40, y)
       .text('50% SINAL + 50% ENTREGA', 200, y, { width: 180 })
       .text(p.id.split('-')[0].toUpperCase(), 400, y); // ID curto como número

    y += 25;
    // Linha 2
    doc.fillColor('#666').fontSize(8).font('Helvetica-Bold').text('Solicitante', 40, y);
    doc.fillColor('#666').text('Elaborado por:', 400, y);

    y += 12;
    doc.fillColor(C_TEXTO).fontSize(9).font('Helvetica').text(p.cliente, 40, y);
    doc.fillColor(C_TEXTO).font('Helvetica-Bold').text('Eng. Fabiano Rielli', 400, y);

    y += 20;
    doc.fillColor('#666').fontSize(8).font('Helvetica-Bold').text('Endereço da Obra:', 40, y);
    y += 12;
    doc.fillColor(C_TEXTO).fontSize(9).font('Helvetica').text(p.endereco || 'Não informado', 40, y);

    // -- TABELA DE PREÇOS (Estilo SondaMais) --
    y += 40;
    const col = { DESC: 40, QTD: 280, UNIT: 350, TOTAL: 450 };
    
    // Header
    doc.rect(40, y, 515, 20).fill('#f0f0f0');
    doc.fillColor(C_TEXTO).font('Helvetica-Bold').fontSize(9);
    doc.text('Descrição', col.DESC + 5, y + 6);
    doc.text('Qtd', col.QTD, y + 6);
    doc.text('Preço Unitário', col.UNIT, y + 6);
    doc.text('Preço Total', col.TOTAL, y + 6);

    y += 25;
    doc.font('Helvetica').fontSize(9);

    // Cálculos
    const total = parseFloat(p.valor_total);
    const art = parseFloat(p.valor_art);
    const mob = parseFloat(p.valor_mobilizacao);
    const desc = parseFloat(p.valor_desconto);
    const sondagemTotal = total - art - mob + desc;
    const valorMetro = (p.metragem_total > 0) ? (sondagemTotal / p.metragem_total) : 0;

    // Item 1: Sondagem (Texto Descritivo + Qtd Furos)
    doc.text('Sondagem SPT', col.DESC, y);
    doc.text(p.furos_previstos.toString(), col.QTD, y);
    doc.fontSize(8).fillColor('#666')
       .text('(furos conforme norma NBR 6484:2020). Será cobrado o metro excedente.', col.DESC, y + 12, { width: 230 });
    
    // Item 2: Metragem Mínima (Aqui vai o valor)
    y += 35;
    doc.fontSize(9).fillColor(C_TEXTO).font('Helvetica-Bold');
    doc.text('*Metragem mínima (metros lineares)', col.DESC, y);
    doc.font('Helvetica');
    doc.text(p.metragem_total.toString(), col.QTD, y);
    doc.text(`R$ ${valorMetro.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.UNIT, y);
    doc.text(`R$ ${sondagemTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);

    // Item 3: ART
    y += 20;
    doc.text('ART', col.DESC, y);
    doc.text('1', col.QTD, y);
    doc.text(`R$ ${art.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.UNIT, y);
    doc.text(`R$ ${art.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);

    // Item 4: Mobilização
    y += 20;
    doc.text('Mobilização (combustível, equipe)', col.DESC, y);
    doc.text('1', col.QTD, y);
    doc.text(`R$ ${mob.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.UNIT, y);
    doc.text(`R$ ${mob.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);

    // Desconto
    if (desc > 0) {
        y += 20;
        doc.fillColor('red');
        doc.text('Desconto Comercial', col.DESC, y);
        doc.text('-', col.QTD, y);
        doc.text(`- R$ ${desc.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);
    }

    // Linha de Total
    y += 30;
    doc.rect(col.TOTAL - 10, y - 5, 100, 25).fill(C_VERDE);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(11);
    doc.text(`R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y + 2);
    
    doc.fillColor(C_TEXTO).fontSize(10).text('Total base à vista:', 300, y + 2);

    // -- TEXTO LEGAL (CRUCIAL) --
    y += 50;
    doc.font('Helvetica').fontSize(8).fillColor('#444');
    
    // Verifica espaço
    if (y > 650) { doc.addPage(); y = 50; }

    doc.text('Na ausência do fornecimento do critério de paralisação por parte da contratante, o CRITÉRIO DE PARALIZAÇÃO SEGUE AS RECOMENDAÇÕES DA NBR 6484:2020:', 40, y, { width: 515 });
    y += 15;
    doc.text('5.2.4.2 Na ausência de critério fornecido, as sondagens avançam até atingir:', 40, y);
    y += 12;
    doc.text('a) 10m consecutivos indicando N iguais ou superiores a 25 golpes;', 50, y);
    y += 10;
    doc.text('b) 8m consecutivos indicando N iguais ou superiores a 30 golpes;', 50, y);
    y += 10;
    doc.text('c) 6m consecutivos indicando N iguais ou superiores a 35 golpes.', 50, y);

    y += 20;
    doc.font('Helvetica-Bold').text('** Caso ultrapasse a metragem mínima, será cobrado o valor unitário por metro excedente.', 40, y);

    // -- CRONOGRAMA --
    y += 30;
    if (y > 680) { doc.addPage(); y = 50; }
    
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C_VERDE).text('CRONOGRAMA ESTIMADO', 40, y);
    y += 15;
    
    const cronoData = [
        ['Previsão de execução', '1 a 3 dias (dependendo do solo)'],
        ['Início dos serviços', 'A combinar'],
        ['Entrega do Relatório', 'Até 3 dias úteis após execução'],
        ['Validade da Proposta', '10 dias']
    ];

    doc.font('Helvetica').fontSize(9).fillColor(C_TEXTO);
    cronoData.forEach(row => {
        doc.text(row[0], 40, y);
        doc.text(row[1], 200, y);
        y += 14;
    });
};

// --- 4. MIDDLEWARES E ROTAS ---
const checkAuth = (req, res, next) => { 
    if (req.session && req.session.user) next(); 
    else if(req.path.startsWith('/api/')) res.status(401).json({error: 'Sessão expirada'});
    else res.redirect('/login'); 
};

// Páginas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/orcamento', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 
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
                req.session.save(() => res.json({ ok: true, redirect: '/orcamento' }));
                return;
            }
        }
        res.status(401).send('Credenciais inválidas');
    } catch (err) { res.status(500).send(err.message); }
});

// API Propostas
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
        
        const sql = `INSERT INTO propostas (empresa_id, cliente, telefone, email, endereco, furos_previstos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, tecnico_responsavel, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ORCAMENTO') RETURNING *`;
        const values = [req.session.user.empresa_id, d.cliente, d.telefone, d.email, d.endereco, d.furos, d.metragem, d.art, d.mobilizacao, d.desconto, total, req.session.user.nome];
        
        const result = await pool.query(sql, values);
        
        const empRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [req.session.user.empresa_id]);
        
        const doc = new PDFDocument({ margin: 0, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Orcamento_${result.rows[0].cliente.split(' ')[0]}.pdf`);
        
        doc.pipe(res);
        montarLayoutPDF(doc, result.rows[0], empRes.rows[0]);
        doc.end();
    } catch (e) { console.error(e); res.status(500).send('Erro: ' + e.message); }
});

// Rota para Baixar PDF depois
app.get('/api/propostas/:id/pdf', checkAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [req.params.id]);
        if(result.rows.length === 0) return res.status(404).send('Não encontrado');
        const empRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [req.session.user.empresa_id]);
        
        const doc = new PDFDocument({ margin: 0, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Orcamento_${result.rows[0].cliente.split(' ')[0]}.pdf`);
        
        doc.pipe(res);
        montarLayoutPDF(doc, result.rows[0], empRes.rows[0]);
        doc.end();
    } catch (e) { res.status(500).send(e.message); }
});

// Rotas Extras (Status, Delete, Boletim)
app.patch('/api/propostas/:id/status', checkAuth, async (req, res) => {
    try { await pool.query('UPDATE propostas SET status = $1 WHERE id = $2', [req.body.status, req.params.id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); }
});
app.delete('/api/propostas/:id', checkAuth, async (req, res) => {
    try { await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]); res.sendStatus(200); } catch(e) { res.status(500).send(e); }
});
app.get('/api/boletim/furos/:obraId', checkAuth, async (req, res) => {
    try { const r = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY data_inicio", [req.params.obraId]); res.json(r.rows); } catch(e) { res.status(500).json(e); }
});
app.post('/api/boletim/furos', checkAuth, async (req, res) => {
    try { const r = await pool.query("INSERT INTO furos (proposta_id, nome_furo, coordenadas, data_inicio) VALUES ($1, $2, $3, NOW()) RETURNING *", [req.body.proposta_id, req.body.nome_furo, req.body.coordenadas]); res.json(r.rows[0]); } catch(e) { res.status(500).json(e); }
});
app.get('/api/engenharia/:id', checkAuth, async (req, res) => {
    try {
        const pRes = await pool.query("SELECT * FROM propostas WHERE id = $1", [req.params.id]);
        if(pRes.rows.length === 0) return res.status(404).send('Nada');
        const fRes = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY nome_furo", [req.params.id]);
        res.json({ proposta: pRes.rows[0], furos: fRes.rows });
    } catch(e) { res.status(500).json(e); }
});

// --- START ---
iniciarSistema().then(() => {
    app.listen(port, () => { console.log(`>>> 🚀 SONDASAAS LAYOUT FINAL RODANDO NA PORTA ${port}`); });
});