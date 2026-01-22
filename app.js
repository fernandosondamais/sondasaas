const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURAÇÕES GERAIS ---
let adminLogado = false; 
const SENHA_MESTRA = 'admin123';

const COLORS = {
    PRIMARY: '#444444', 
    ACCENT: '#6a9615', // Verde da Identidade Visual
    BORDER: '#000000', 
    BG_HEADER: '#ffffff'
};

const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/sondasaas';

const pool = new Pool({
    connectionString: connectionString,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(express.static('public')); 

// --- ROTAS DE PÁGINAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => adminLogado ? res.sendFile(path.join(__dirname, 'public', 'admin.html')) : res.redirect('/login'));
app.get('/logout', (req, res) => { adminLogado = false; res.redirect('/login'); });

// NOVA ROTA: Acesso ao Boletim de Campo (Vamos criar o HTML dela no próximo passo)
app.get('/boletim', (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));

// --- ROTAS DA API (COMERCIAL) ---
app.post('/api/login', (req, res) => {
    if (req.body.senha === SENHA_MESTRA) { adminLogado = true; res.sendStatus(200); } else { res.sendStatus(401); }
});

app.get('/api/propostas', async (req, res) => {
    // Nota: Em produção real, protegeríamos isso, mas para o MVP o sondador precisa listar as obras
    try {
        const result = await pool.query('SELECT * FROM propostas ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar propostas' }); }
});

app.delete('/api/propostas/:id', async (req, res) => {
    if (!adminLogado) return res.status(403).send('Acesso Negado');
    try {
        await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]);
        res.status(200).send('Excluído');
    } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/gerar-proposta', async (req, res) => {
    const d = req.body;
    const v_furos = parseInt(d.furos) || 0;
    const v_metragem = parseFloat(d.metragem) || 0;
    const v_metro = parseFloat(d.valor_metro) || 0;
    const v_art = parseFloat(d.art) || 0;
    const v_mobi = parseFloat(d.mobilizacao) || 0;
    const v_desc = parseFloat(d.desconto) || 0;
    
    const subtotal_sondagem = v_metragem * v_metro;
    const valor_total = subtotal_sondagem + v_art + v_mobi - v_desc;
    
    // Campos Técnicos
    const criterio = d.criterio_tecnico || 'norma'; 
    const detalhe = d.detalhe_criterio || '';

    try {
        const sql = `INSERT INTO propostas 
        (cliente, telefone, email, endereco, furos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, criterio, detalhe_criterio) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, data_criacao`;
        
        const values = [d.cliente, d.telefone, d.email, d.endereco, v_furos, v_metragem, v_art, v_mobi, v_desc, valor_total, criterio, detalhe];
        
        const dbRes = await pool.query(sql, values);
        
        const dadosPDF = {
            id: dbRes.rows[0].id, 
            data: new Date().toLocaleDateString('pt-BR'),
            ...d, 
            furos: v_furos, metragem: v_metragem, valor_metro: v_metro,
            subtotal_sondagem: subtotal_sondagem, art: v_art, mobilizacao: v_mobi, 
            desconto: v_desc, total: valor_total,
            criterio: criterio, detalhe_criterio: detalhe
        };
        gerarPDFDinamico(res, dadosPDF);
    } catch (err) { console.error('Erro ao salvar:', err); res.status(500).json({ error: 'Erro interno' }); }
});

app.get('/reemitir-pdf/:id', async (req, res) => {
    if (!adminLogado) return res.redirect('/login');
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('Não encontrado');
        
        const row = result.rows[0];
        const total = parseFloat(row.valor_total); 
        const art = parseFloat(row.valor_art);
        const mobi = parseFloat(row.valor_mobilizacao); 
        const desc = parseFloat(row.valor_desconto);
        const metragem = parseFloat(row.metragem_total);
        const subtotal = total - art - mobi + desc;
        const v_metro = metragem > 0 ? subtotal / metragem : 0;
        
        const dadosPDF = {
            id: row.id, 
            data: new Date(row.data_criacao).toLocaleDateString('pt-BR'),
            cliente: row.cliente, telefone: row.telefone, email: row.email, endereco: row.endereco, 
            furos: row.furos, metragem: metragem, valor_metro: v_metro, 
            subtotal_sondagem: subtotal, art: art, mobilizacao: mobi, desconto: desc, total: total,
            criterio: row.criterio || 'norma',
            detalhe_criterio: row.detalhe_criterio || ''
        };
        gerarPDFDinamico(res, dadosPDF);
    } catch (err) { res.status(500).send('Erro'); }
});

// --- ROTAS DA API (TÉCNICO / BOLETIM DE CAMPO) ---
// Estas rotas permitem que o celular do sondador salve e leia dados

// 1. Listar Furos de uma Obra (Para o sondador ver o que já fez)
app.get('/api/boletim/furos/:obraId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [req.params.obraId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({error: err.message}); }
});

// 2. Criar Novo Furo (Header do Caderno)
app.post('/api/boletim/furos', async (req, res) => {
    const d = req.body;
    try {
        const sql = `INSERT INTO furos (proposta_id, nome_furo, sondador, data_inicio, cota, nivel_agua_inicial) 
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;
        const values = [d.proposta_id, d.nome_furo, d.sondador, d.data_inicio, d.cota, d.nivel_agua_inicial];
        const r = await pool.query(sql, values);
        res.json({id: r.rows[0].id});
    } catch (err) { res.status(500).json({error: err.message}); }
});

// 3. Listar Amostras (As linhas do caderno)
app.get('/api/boletim/amostras/:furoId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [req.params.furoId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({error: err.message}); }
});

// 4. Salvar Amostra (Linha a linha)
app.post('/api/boletim/amostras', async (req, res) => {
    const d = req.body;
    try {
        const sql = `INSERT INTO amostras (furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo, cor_solo) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`;
        const values = [d.furo_id, d.profundidade_ini, d.profundidade_fim, d.golpe_1, d.golpe_2, d.golpe_3, d.tipo_solo, d.cor_solo];
        await pool.query(sql, values);
        res.sendStatus(200);
    } catch (err) { res.status(500).json({error: err.message}); }
});

// --- GERADOR DE PDF ---
function gerarPDFDinamico(res, d) {
    const doc = new PDFDocument({ margin: 30, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Proposta_${d.id}.pdf"`);
    doc.pipe(res);

    const fmtMoney = (v) => `R$ ${parseFloat(v).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    function checkPageBreak(neededHeight) {
        if (doc.y + neededHeight > doc.page.height - doc.page.margins.bottom) { doc.addPage(); return true; }
        return false;
    }

    // HEADER
    const logoPath = path.join(__dirname, 'public', 'logo.png');
    if (fs.existsSync(logoPath)) { try { doc.image(logoPath, 30, 15, { width: 70 }); } catch (e) {} }
    
    let headerTextY = 110; 
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ACCENT).text('Sondamais Engenharia', 30, headerTextY);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.PRIMARY)
        .text('R. Luís Spiandorelli Neto, 60', 30, headerTextY + 15)
        .text('Valinhos, São Paulo, 13271-570', 30, headerTextY + 27)
        .text('(19) 99800-2260 | contato@sondamais.com.br', 30, headerTextY + 39);

    const boxX = 300; const boxY = 40;
    doc.font('Helvetica-Bold').fontSize(14).text('Orçamento', boxX, boxY);
    doc.font('Helvetica-Bold').fontSize(9).text('Data', boxX, boxY + 25); doc.font('Helvetica').text(d.data, boxX, boxY + 37);
    doc.font('Helvetica-Bold').text('Número da Proposta', boxX + 150, boxY + 25); doc.font('Helvetica').text(`${d.id}/2026`, boxX + 150, boxY + 37);
    doc.font('Helvetica-Bold').text('Pagamento', boxX, boxY + 55); doc.font('Helvetica').text('50% SINAL + 50% ENTREGA DO LAUDO', boxX, boxY + 67);
    doc.font('Helvetica-Bold').text('Elaborado por:', boxX, boxY + 95); doc.font('Helvetica').text('Eng. Fabiano Rielli', boxX, boxY + 107);
    
    const clienteY = boxY + 125;
    doc.font('Helvetica-Bold').text('Solicitante:', boxX, clienteY); doc.font('Helvetica').text(d.cliente, boxX + 55, clienteY);
    doc.text(`Tel: ${d.telefone || '-'} | Email: ${d.email || '-'}`, boxX, clienteY + 14, {width: 260});
    doc.text(`Local: ${d.endereco}`, boxX, clienteY + 28, {width: 260});

    // TABELA
    let y = 230; const colDesc = 30, colQtd = 330, colUnit = 380, colTotal = 460;
    function drawTableHeader(posY) {
        doc.rect(30, posY, 535, 20).fill('#f0f0f0');
        doc.fillColor('black').font('Helvetica-Bold').fontSize(9);
        doc.text('Descrição', colDesc + 5, posY + 6); doc.text('Qtd', colQtd, posY + 6); doc.text('Unitário', colUnit, posY + 6); doc.text('Total', colTotal, posY + 6);
        return posY + 25; 
    }
    y = drawTableHeader(y); 

    function drawRow(desc, subtext, qtd, unit, total) {
        const rowHeight = subtext ? 45 : 20;
        if (y + rowHeight > 750) { doc.addPage(); y = 50; y = drawTableHeader(y); }
        doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.PRIMARY).text(desc, colDesc, y);
        if(subtext) { doc.font('Helvetica').fontSize(8).text(subtext, colDesc, y + 12, {width: 290, align: 'justify'}); }
        doc.font('Helvetica').fontSize(9);
        doc.text(qtd, colQtd, y); doc.text(unit, colUnit, y); doc.text(total, colTotal, y);
        y += rowHeight; doc.moveTo(30, y).lineTo(565, y).strokeColor('#eeeeee').lineWidth(1).stroke(); y += 10; 
    }

    // LÓGICA DE TEXTO DA TABELA
    let textoSondagem = '(furos de até 20m ou NBR 6484:2020). Cobrado o metro excedente.';
    if (d.criterio === 'cota') {
        textoSondagem = `(Execução conforme solicitação: ${d.detalhe_criterio}). Cobrança por metro perfurado.`;
    }

    drawRow('Sondagem SPT', textoSondagem, d.furos, '', '');
    drawRow('*Metragem total (metros lineares)', null, d.metragem, fmtMoney(d.valor_metro), fmtMoney(d.subtotal_sondagem));
    drawRow('ART', null, '1', fmtMoney(d.art), fmtMoney(d.art));
    if(d.mobilizacao > 0) drawRow('Mobilização (Logística)', null, '1', fmtMoney(d.mobilizacao), fmtMoney(d.mobilizacao));
    if(d.desconto > 0) drawRow('Desconto Comercial', null, '-', '-', `- ${fmtMoney(d.desconto)}`);

    // TOTAL
    checkPageBreak(60); doc.y = y + 10;
    doc.font('Helvetica-Bold').fontSize(10).text('SONDAMAIS', 30, doc.y);
    doc.fontSize(8).text('REV00', 30, doc.y + 12); 
    doc.font('Helvetica-Bold').fontSize(16).text(fmtMoney(d.total), 30, doc.y + 15);

    // TEXTOS JURÍDICOS (DINÂMICOS)
    doc.moveDown(2); checkPageBreak(100); 

    if (d.criterio === 'cota') {
        doc.font('Helvetica-Bold').fontSize(9).text("CRITÉRIO DE PARALISAÇÃO: FURO POR COTA", {underline: true});
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(8).text(
            "Conforme solicitação do contratante, os furos serão executados até a profundidade pré-estabelecida (Cota Fixa), independentemente do critério de norma NBR 6484. A interrupção ocorrerá antes da cota apenas em caso de impenetrável à percussão.", 
            {width: 535, align: 'justify'}
        );
    } else {
        doc.font('Helvetica').fontSize(8);
        doc.text("Na ausência do fornecimento do critério de paralisação por parte da contratante ou seu preposto, o CRITÉRIO DE PARALIZAÇÃO DOS ENSAIOS SEGUE AS RECOMENDAÇÕES DA NBR 6484:2020, ITEM 5.2.4 OU 6.2.4.", {width: 535, align: 'justify'});
        doc.moveDown(0.8);
        doc.font('Helvetica-Bold');
        doc.text("Conforme critério de paralisação de sondagem-SPT (Norma NBR 6484:2020), a profundidade atingida pode sofrer variação. Portanto, caso ultrapasse a metragem mínima será cobrado " + fmtMoney(d.valor_metro) + " por metro excedente.", {width: 535, align: 'justify'});
        doc.moveDown(0.8);
        doc.font('Helvetica').text("5.2.4.2 Na ausência do fornecimento do critério de paralisação, as sondagens devem avançar até:", {width: 535});
        doc.moveDown(0.5);
        const listOpts = {indent: 10, width: 525};
        doc.text("a) avanço até a profundidade com 10 m de resultados consecutivos N >= 25 golpes;", listOpts);
        doc.moveDown(0.2);
        doc.text("b) avanço até a profundidade com 8 m de resultados consecutivos N >= 30 golpes;", listOpts);
        doc.moveDown(0.2);
        doc.text("c) avanço até a profundidade com 6 m de resultados consecutivos N >= 35 golpes;", listOpts);
    }

    // CRONOGRAMA
    doc.moveDown(2); if (checkPageBreak(120)) { doc.y = 50; }
    doc.font('Helvetica-Bold').fontSize(10).text('CRONOGRAMA', 30, doc.y);
    doc.moveDown(0.5);
    const cronoData = [['Previsão de execução', '1 a 2 dias'], ['Início', 'A combinar'], ['Entrega do Relatório', '3 dias úteis'], ['Validade', '10 dias']];
    doc.font('Helvetica').fontSize(9); let cronoY = doc.y;
    cronoData.forEach(row => {
        doc.rect(30, cronoY, 535, 20).stroke();
        doc.text(row[0], 35, cronoY + 6); doc.text(row[1], 300, cronoY + 6); cronoY += 20;
    });
    doc.end();
}

// --- INICIALIZAÇÃO DO SERVIDOR E BANCO DE DADOS ---

// 1. Tabela PROPOSTAS (Módulo Comercial)
const sqlPropostas = `
    CREATE TABLE IF NOT EXISTS propostas (
        id SERIAL PRIMARY KEY, 
        cliente VARCHAR(255), 
        endereco TEXT, 
        furos INTEGER, 
        metragem_total NUMERIC, 
        valor_art NUMERIC, 
        valor_mobilizacao NUMERIC, 
        valor_desconto NUMERIC, 
        valor_total NUMERIC, 
        data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        telefone VARCHAR(50),
        email VARCHAR(255),
        criterio VARCHAR(50),
        detalhe_criterio VARCHAR(255)
    );
`;

// 2. Tabela FUROS (Módulo Técnico - Boletim de Campo)
// Baseado no caderno de campo: Sondador, Data, Cota, Coord, Nivel Agua, Revestimento
const sqlFuros = `
    CREATE TABLE IF NOT EXISTS furos (
        id SERIAL PRIMARY KEY,
        proposta_id INTEGER REFERENCES propostas(id) ON DELETE CASCADE,
        nome_furo VARCHAR(20),  
        sondador VARCHAR(100),
        data_inicio DATE,
        data_termino DATE,
        cota NUMERIC,
        nivel_agua_inicial NUMERIC, 
        nivel_agua_final NUMERIC,
        revestimento NUMERIC,
        coordenadas TEXT
    );
`;

// 3. Tabela AMOSTRAS (Módulo Técnico - Detalhes do Furo)
// Baseado no caderno de campo: Profundidade, Golpes (1, 2, 3), Classificação do Solo
const sqlAmostras = `
    CREATE TABLE IF NOT EXISTS amostras (
        id SERIAL PRIMARY KEY,
        furo_id INTEGER REFERENCES furos(id) ON DELETE CASCADE,
        profundidade_ini NUMERIC, 
        profundidade_fim NUMERIC, 
        golpe_1 INTEGER,          
        golpe_2 INTEGER,          
        golpe_3 INTEGER,          
        tipo_solo TEXT,           
        cor_solo TEXT,            
        obs_solo TEXT             
    );
`;

// Executa todas as criações em ordem e inicia o servidor
const initSQL = sqlPropostas + sqlFuros + sqlAmostras;

pool.query(initSQL)
    .then(() => { 
        console.log('>>> DB OK: Módulos Comercial e Técnico Carregados <<<'); 
        app.listen(port, () => { 
            console.log(`Rodando na porta ${port}`); 
        }); 
    })
    .catch(err => { 
        console.error('ERRO DB:', err); 
    });