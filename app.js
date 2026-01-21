const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
// Configuração de porta para Nuvem (Render) ou Local
const port = process.env.PORT || 3000;

let adminLogado = false; 
const SENHA_MESTRA = 'admin123';

const COLORS = {
    PRIMARY: '#8CBF26', SECONDARY: '#003366', DARK_TEXT: '#333333',
    LIGHT_TEXT: '#555555', TABLE_HEADER: '#E0E0E0', BORDER: '#CCCCCC'
};

// Conexão Híbrida (SSL para produção)
const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/sondasaas';

const pool = new Pool({
    connectionString: connectionString,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static('public')); 

// --- ROTAS BÁSICAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => adminLogado ? res.sendFile(path.join(__dirname, 'public', 'admin.html')) : res.redirect('/login'));
app.get('/logout', (req, res) => { adminLogado = false; res.redirect('/login'); });

app.post('/api/login', (req, res) => {
    if (req.body.senha === SENHA_MESTRA) { adminLogado = true; res.sendStatus(200); } else { res.sendStatus(401); }
});

// --- API: CRUD PROPOSTAS ---
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

    try {
        // SQL Corrigido para garantir tipos numéricos
        const sql = `INSERT INTO propostas (cliente, endereco, furos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, data_criacao`;
        const values = [d.cliente, d.endereco, v_furos, v_metragem, v_art, v_mobi, v_desc, valor_total];
        const dbRes = await pool.query(sql, values);
        
        const dadosPDF = {
            id: dbRes.rows[0].id, data: new Date().toLocaleDateString('pt-BR'),
            cliente: d.cliente, endereco: d.endereco, furos: v_furos, metragem: v_metragem,
            valor_metro: v_metro, subtotal_sondagem: subtotal_sondagem,
            art: v_art, mobilizacao: v_mobi, desconto: v_desc, total: valor_total
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
            cliente: row.cliente, endereco: row.endereco, furos: row.furos,
            metragem: metragem, valor_metro: v_metro, subtotal_sondagem: subtotal,
            art: art, mobilizacao: mobi, desconto: desc, total: total
        };
        gerarPDFDinamico(res, dadosPDF);
    } catch (err) { res.status(500).send('Erro'); }
});

// --- GERADOR PDF DINÂMICO ---
function gerarPDFDinamico(res, d) {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${d.id}.pdf"`);
    doc.pipe(res);

    const logoPath = path.join(__dirname, 'public', 'logo.png');
    // Tenta carregar logo (ignora erro se não existir para não travar)
    if (fs.existsSync(logoPath)) { 
        try { doc.image(logoPath, 40, 30, { width: 100 }); } catch(e) {} 
    }

    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.SECONDARY)
       .text('SONDAMAIS ENGENHARIA', 200, 35, { align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.LIGHT_TEXT)
       .text('R. Luís Spiandorelli Neto, 60 - Valinhos/SP', 200, 55, { align: 'right' })
       .text('CEP: 13271-570 | Tel: (19) 99800-2260', 200, 68, { align: 'right' });

    doc.y = 100; 
    const startY = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.SECONDARY).text('ORÇAMENTO TÉCNICO', 50, startY + 10);
    doc.font('Helvetica').fontSize(9).fillColor('black').text(`Nº: ${d.id}/2026`, 50, startY + 25).text(`Data: ${d.data}`, 50, startY + 38);

    const colClienteX = 200;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.SECONDARY).text('DADOS DO CLIENTE', colClienteX, startY + 10);
    doc.font('Helvetica').fontSize(9).fillColor('black');
    doc.text(`Solicitante: ${d.cliente}`, colClienteX, startY + 25);
    doc.text(`Local: ${d.endereco}`, colClienteX, startY + 38, { width: 340, align: 'left' });
    
    const endY = doc.y + 10;
    doc.rect(40, startY, 515, endY - startY).strokeColor(COLORS.BORDER).stroke();
    doc.y = endY + 20;

    const tableHeaderY = doc.y;
    doc.rect(40, tableHeaderY, 515, 20).fill(COLORS.TABLE_HEADER);
    doc.fillColor('black').font('Helvetica-Bold').fontSize(9);
    doc.text('DESCRIÇÃO', 45, tableHeaderY + 6); doc.text('QTD.', 340, tableHeaderY + 6);
    doc.text('UNIT.', 390, tableHeaderY + 6); doc.text('TOTAL', 460, tableHeaderY + 6);
    doc.y += 25; 

    function drawRow(desc, subtext, qtd, unit, total, isRed = false) {
        const rowY = doc.y;
        if (rowY > 700) { doc.addPage(); doc.y = 50; }
        doc.font('Helvetica').fontSize(9).fillColor(isRed ? '#cc0000' : COLORS.DARK_TEXT);
        doc.text(desc, 45, doc.y, { width: 280 });
        if (subtext) { doc.fontSize(8).fillColor(COLORS.LIGHT_TEXT).text(subtext, 45, doc.y + 2, { width: 280 }); }
        const textHeight = doc.y - rowY;
        const rowHeight = textHeight < 20 ? 20 : textHeight + 5;
        doc.font('Helvetica').fontSize(9).fillColor(isRed ? '#cc0000' : COLORS.DARK_TEXT);
        doc.text(qtd, 340, rowY); doc.text(unit, 390, rowY); doc.text(total, 460, rowY);
        doc.y = rowY + rowHeight;
    }

    drawRow('Sondagem SPT (conf. NBR 6484:2020)', `Estimativa: ${d.furos} furos. Metragem mínima contratada.`, `${d.metragem} m`, `R$ ${d.valor_metro.toFixed(2)}`, `R$ ${d.subtotal_sondagem.toFixed(2)}`);
    if (d.mobilizacao > 0) drawRow('Mobilização e Desmobilização', '', '1 vb', `R$ ${d.mobilizacao.toFixed(2)}`, `R$ ${d.mobilizacao.toFixed(2)}`);
    if (d.art > 0) drawRow('Emissão de ART (Taxa CREA)', '', '1 un', `R$ ${d.art.toFixed(2)}`, `R$ ${d.art.toFixed(2)}`);
    if (d.desconto > 0) drawRow('Desconto Comercial', '', '-', '-', `- R$ ${d.desconto.toFixed(2)}`, true);

    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(COLORS.PRIMARY).lineWidth(2).stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.SECONDARY)
       .text(`TOTAL: R$ ${d.total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 40, doc.y, { align: 'right', width: 515 });

    doc.moveDown(2);
    if (doc.y > 600) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.SECONDARY).text('NOTAS TÉCNICAS E CRITÉRIOS DE PARALISAÇÃO');
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.DARK_TEXT);
    const notas = [
        "1. Na ausência do fornecimento do critério de paralisação por parte da contratante, o CRITÉRIO DE PARALIZAÇÃO SEGUE AS RECOMENDAÇÕES DA NBR 6484:2020.",
        `2. Conforme NBR 6484:2020, a profundidade pode variar. Caso ultrapasse a metragem mínima (${d.metragem}m), será cobrado R$ ${d.valor_metro.toFixed(2)} por metro excedente.`,
        "3. A locação dos furos (topografia) e o fornecimento de água são de responsabilidade do contratante, salvo negociação contrária.",
        "4. Ocorrendo necessidade de avançar o pacote mínimo para seguir norma, o excedente será faturado automaticamente."
    ];
    for (let nota of notas) { doc.text(nota, 40, doc.y, { width: 515, align: 'justify' }); doc.moveDown(0.5); }

    doc.moveDown(1);
    if (doc.y > 650) doc.addPage();
    const footerY = doc.y;
    doc.rect(40, footerY, 250, 70).strokeColor('#dddddd').lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.SECONDARY).text('CRONOGRAMA', 50, footerY + 5);
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.DARK_TEXT);
    doc.text('• Início: A combinar.', 50, footerY + 20);
    doc.text('• Execução: Estimado 1 a 2 dias.', 50, footerY + 32);
    doc.text('• Relatório: Até 3 dias úteis.', 50, footerY + 44);
    doc.text('• Validade: 10 dias.', 50, footerY + 56);

    doc.rect(305, footerY, 250, 70).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.SECONDARY).text('CONDIÇÕES DE PAGAMENTO', 315, footerY + 5);
    doc.fillColor('#cc0000').text('50% SINAL (PIX/Transferência)', 315, footerY + 20);
    doc.fillColor(COLORS.DARK_TEXT).text('50% NA ENTREGA DO LAUDO', 315, footerY + 32);
    doc.font('Helvetica-Oblique').fontSize(7).text('Dados bancários no corpo do e-mail/NF.', 315, footerY + 50);

    doc.end();
}

// --- INICIALIZAÇÃO E AUTO-REPARO DO BANCO ---
// Esta função cria a tabela automaticamente se ela não existir
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
`;

pool.query(initSQL)
  .then(() => {
    console.log('>>> BANCO DE DADOS VERIFICADO/CRIADO COM SUCESSO <<<');
    // Só inicia o servidor depois de garantir que a tabela existe
    app.listen(port, () => { console.log(`Rodando na porta ${port}`); });
  })
  .catch(err => {
      console.error('ERRO CRÍTICO AO CONECTAR NO BANCO:', err);
  });