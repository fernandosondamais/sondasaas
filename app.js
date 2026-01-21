const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

let adminLogado = false; 
const SENHA_MESTRA = 'admin123';

// CORES DO PADRÃO VISUAL DOS PDFs ENVIADOS
const COLORS = {
    PRIMARY: '#444444',    // Cinza Escuro (Texto)
    ACCENT: '#6a9615',     // Verde SondaMais (Logos/Detalhes)
    BORDER: '#000000',     // Preto (Bordas finas)
    BG_HEADER: '#ffffff'
};

const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/sondasaas';

const pool = new Pool({
    connectionString: connectionString,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static('public')); 

// --- ROTAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => adminLogado ? res.sendFile(path.join(__dirname, 'public', 'admin.html')) : res.redirect('/login'));
app.get('/logout', (req, res) => { adminLogado = false; res.redirect('/login'); });

app.post('/api/login', (req, res) => {
    if (req.body.senha === SENHA_MESTRA) { adminLogado = true; res.sendStatus(200); } else { res.sendStatus(401); }
});

app.get('/api/propostas', async (req, res) => {
    if (!adminLogado) return res.status(403).json({ error: 'Acesso negado' });
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

    const cliente_tel = d.telefone || '';
    const cliente_email = d.email || '';

    try {
        const sql = `
            INSERT INTO propostas 
            (cliente, telefone, email, endereco, furos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
            RETURNING id, data_criacao
        `;
        const values = [d.cliente, cliente_tel, cliente_email, d.endereco, v_furos, v_metragem, v_art, v_mobi, v_desc, valor_total];
        const dbRes = await pool.query(sql, values);
        
        const dadosPDF = {
            id: dbRes.rows[0].id, data: new Date().toLocaleDateString('pt-BR'),
            cliente: d.cliente, telefone: cliente_tel, email: cliente_email, endereco: d.endereco, 
            furos: v_furos, metragem: v_metragem, valor_metro: v_metro, 
            subtotal_sondagem: subtotal_sondagem, art: v_art, mobilizacao: v_mobi, 
            desconto: v_desc, total: valor_total
        };
        gerarPDFDinamico(res, dadosPDF);
    } catch (err) { console.error('Erro ao salvar proposta:', err); res.status(500).json({ error: 'Erro interno ao salvar' }); }
});

app.get('/reemitir-pdf/:id', async (req, res) => {
    if (!adminLogado) return res.redirect('/login');
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('Não encontrado');
        const row = result.rows[0];
        
        const total = parseFloat(row.valor_total); const art = parseFloat(row.valor_art);
        const mobi = parseFloat(row.valor_mobilizacao); const desc = parseFloat(row.valor_desconto);
        const metragem = parseFloat(row.metragem_total);
        const subtotal = total - art - mobi + desc;
        const v_metro = metragem > 0 ? subtotal / metragem : 0;

        const dadosPDF = {
            id: row.id, data: new Date(row.data_criacao).toLocaleDateString('pt-BR'),
            cliente: row.cliente, 
            telefone: row.telefone || '', 
            email: row.email || '',
            endereco: row.endereco, 
            furos: row.furos, metragem: metragem, valor_metro: v_metro, subtotal_sondagem: subtotal,
            art: art, mobilizacao: mobi, desconto: desc, total: total
        };
        gerarPDFDinamico(res, dadosPDF);
    } catch (err) { res.status(500).send('Erro'); }
});

// --- GERADOR PDF IDÊNTICO AO MODELO FÍSICO ---
function gerarPDFDinamico(res, d) {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Proposta_${d.id}.pdf"`);
    doc.pipe(res);

    // 1. HEADER (Lado Esquerdo: Logo e Endereço)
    const logoPath = path.join(__dirname, 'public', 'logo.png');
    if (fs.existsSync(logoPath)) {
        try { doc.image(logoPath, 30, 30, { width: 80 }); } catch (e) {}
    }

    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.PRIMARY).text('Sondamais', 30, 85);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.PRIMARY)
       .text('R. Luís Spiandorelli Neto, 60', 30, 100)
       .text('Valinhos, São Paulo, 13271-570', 30, 112)
       .text('(19) 99800-2260', 30, 124)
       .text('contato@sondamais.com.br', 30, 136);

    // 2. HEADER (Lado Direito: Dados da Proposta - Box Cinza/Branco)
    const boxX = 300;
    const boxY = 40;
    
    // Título "Orçamento"
    doc.font('Helvetica-Bold').fontSize(14).text('Orçamento', boxX, boxY);
    
    // Grid de Informações
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Data', boxX, boxY + 25);
    doc.font('Helvetica').text(d.data, boxX, boxY + 37);

    doc.font('Helvetica-Bold').text('Número da Proposta', boxX + 150, boxY + 25); // Lado a lado
    doc.font('Helvetica').text(`${d.id}/2026`, boxX + 150, boxY + 37);

    doc.font('Helvetica-Bold').text('Pagamento', boxX, boxY + 55);
    doc.font('Helvetica').text('50% SINAL ENTRADA E RESTANTE NA ENTREGA', boxX, boxY + 67, {width: 250});
    doc.text('DO LAUDO - TRANSFERÊNCIA BANCÁRIA OU PIX', boxX, boxY + 79);

    doc.font('Helvetica-Bold').text('Elaborado por:', boxX, boxY + 95);
    doc.font('Helvetica').text('Eng. Fabiano Rielli', boxX, boxY + 107);

    // Dados do Cliente (Abaixo do elaborado)
    const clienteY = boxY + 130;
    doc.font('Helvetica-Bold').text('Solicitante:', boxX, clienteY);
    doc.font('Helvetica').text(d.cliente, boxX + 55, clienteY);
    if(d.telefone) doc.text(`Tel: ${d.telefone}`, boxX, clienteY + 12);
    
    doc.font('Helvetica-Bold').text('Endereço:', boxX, clienteY + 24);
    doc.font('Helvetica').text(d.endereco, boxX + 50, clienteY + 24, {width: 200});

    // 3. TABELA DE ITENS (Igual ao modelo PDF)
    const tableTop = 200;
    const colDesc = 30;
    const colQtd = 330;
    const colUnit = 380;
    const colTotal = 460;

    // Cabeçalho da Tabela
    doc.rect(30, tableTop, 535, 20).fill('#f0f0f0');
    doc.fillColor('black').font('Helvetica-Bold').fontSize(9);
    doc.text('Descrição', colDesc + 5, tableTop + 6);
    doc.text('Qtd', colQtd, tableTop + 6);
    doc.text('Preço unitário', colUnit, tableTop + 6);
    doc.text('Preço total', colTotal, tableTop + 6);

    let y = tableTop + 25;

    // Função de Linha
    function drawRow(desc, subtext, qtd, unit, total) {
        doc.font('Helvetica-Bold').fontSize(9).text(desc, colDesc, y);
        
        let height = 15;
        if(subtext) {
            doc.font('Helvetica').fontSize(8).text(subtext, colDesc, y + 12, {width: 290});
            height = 35; // Altura maior para texto de descrição
        }
        
        doc.font('Helvetica').fontSize(9);
        doc.text(qtd, colQtd, y);
        doc.text(unit, colUnit, y);
        doc.text(total, colTotal, y);
        
        y += height;
        doc.moveTo(30, y).lineTo(565, y).strokeColor('#eeeeee').lineWidth(1).stroke();
        y += 5;
    }

    // Itens
    drawRow('Sondagem SPT', 
            '(furos de até 20 metros profundidade ou norma 6484:2020). Será cobrado o metro excedente, caso ultrapassado metragem mínima.', 
            d.furos, '', '');

    drawRow('*Metragem mínima (metros lineares)', 
            null, 
            d.metragem, 
            `R$ ${d.valor_metro.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 
            `R$ ${d.subtotal_sondagem.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);

    drawRow('ART', null, '1', 
            `R$ ${d.art.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 
            `R$ ${d.art.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);

    if(d.mobilizacao > 0) {
        drawRow('Mobilização (combustível, alimentação, pedágio)', null, 'L', 
                `R$ ${d.mobilizacao.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 
                `R$ ${d.mobilizacao.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
    }

    if(d.desconto > 0) {
        drawRow('Desconto Comercial', null, '-', 
                '-', 
                `- R$ ${d.desconto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
    }

    // 4. TOTAL (Box destacado na esquerda igual ao modelo)
    y += 10;
    doc.font('Helvetica-Bold').fontSize(10).text('SONDAMAIS', 30, y);
    doc.fontSize(8).text(`REV0${d.id % 5}`, 30, y + 12); // Simula revisão
    
    doc.font('Helvetica-Bold').fontSize(14).text(`R$ ${d.total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 30, y + 25);
    doc.font('Helvetica').fontSize(8).text('Total base à vista, no boleto ou pix', 30, y + 40);

    // 5. TEXTO JURÍDICO DA NORMA (O mais importante)
    y += 60;
    doc.font('Helvetica').fontSize(8).text(
        "Na ausência do fornecimento do critério de paralisação por parte da contratante ou seu preposto, o CRITÉRIO DE PARALIZAÇÃO DOS ENSAIOS SEGUE AS RECOMENDAÇÕES DA NBR 6484:2020, ITEM 5.2.4 OU 6.2.4.",
        30, y, {width: 535, align: 'justify'}
    );
    
    y += 25;
    doc.font('Helvetica-Bold').text(
        "** Conforme critério de paralisação de sondagem-SPT (Norma NBR 6484:2020 - vide abaixo), a profundidade atingida pode sofrer variação. Portanto, caso ultrapasse a *metragem mínima será cobrado R$ " + d.valor_metro.toLocaleString('pt-BR', {minimumFractionDigits: 2}) + " por metro excedente da sondagem.",
        30, y, {width: 535, align: 'justify'}
    );

    // Texto da Norma (Itens a, b, c)
    y += 35;
    doc.font('Helvetica').text(
        "5.2.4.2 Na ausência do fornecimento do critério de paralisação por parte da contratante ou de seu preposto, as sondagens devem avançar até que seja atingido um dos seguintes critérios:",
        30, y, {width: 535}
    );
    y += 12;
    doc.text("a) avanço da sondagem até a profundidade na qual tenham sido obtidos 10 m de resultados consecutivos indicando N iguais ou superiores a 25 golpes;", 40, y, {width: 525});
    y += 12;
    doc.text("b) avanço da sondagem até a profundidade na qual tenham sido obtidos 8 m de resultados consecutivos indicando N iguais ou superiores a 30 golpes;", 40, y + 10, {width: 525});
    y += 12;
    doc.text("c) avanço da sondagem até a profundidade na qual tenham sido obtidos 6 m de resultados consecutivos indicando N iguais ou superiores a 35 golpes;", 40, y + 20, {width: 525});

    // 6. CRONOGRAMA (Tabela Final)
    y += 45;
    if(y > 700) { doc.addPage(); y = 50; }
    
    doc.font('Helvetica-Bold').fontSize(10).text('CRONOGRAMA', 30, y);
    y += 15;

    // Linhas do Cronograma
    const cronoData = [
        ['Previsão de execução da sondagem', '1 a 2 dias'],
        ['Previsão de início sujeito à alteração', 'A combinar'],
        ['Entrega do relatório de Sondagem', 'Em até 3 dias, após a execução do serviço'],
        ['Validade da proposta', '10 dias']
    ];

    cronoData.forEach(row => {
        doc.rect(30, y, 535, 20).stroke();
        doc.font('Helvetica').fontSize(9).text(row[0], 35, y + 6);
        doc.text(row[1], 300, y + 6);
        y += 20;
    });

    doc.end();
}

// --- MIGRATION (Mantida para segurança) ---
const initSQL = `
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
    data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE propostas ADD COLUMN IF NOT EXISTS telefone VARCHAR(50);
  ALTER TABLE propostas ADD COLUMN IF NOT EXISTS email VARCHAR(255);
`;

pool.query(initSQL)
  .then(() => {
    console.log('>>> SISTEMA ONLINE: PDF PADRÃO ENGENHARIA ATIVADO <<<');
    app.listen(port, () => { console.log(`Rodando na porta ${port}`); });
  })
  .catch(err => { console.error('ERRO NO BANCO:', err); });