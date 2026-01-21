const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

let adminLogado = false; 
const SENHA_MESTRA = 'admin123';

// --- CORES OFICIAIS SONDAMAIS ---
const COLORS = {
    PRIMARY: '#8CBF26',    // Verde SondaMais
    SECONDARY: '#003366',  // Azul Escuro Institucional
    DARK_TEXT: '#333333',
    LIGHT_TEXT: '#555555',
    TABLE_HEADER: '#F0F0F0',
    BORDER: '#DDDDDD'
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

// --- GERADOR PDF (LAYOUT CORRIGIDO E FIXADO) ---
function gerarPDFDinamico(res, d) {
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${d.id}.pdf"`);
    doc.pipe(res);

    // --- 1. CABEÇALHO ---
    const logoPath = path.join(__dirname, 'public', 'logo.png');
    if (fs.existsSync(logoPath)) {
        try { doc.image(logoPath, 40, 30, { width: 110 }); } catch (e) {}
    }

    doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.SECONDARY)
       .text('SONDAMAIS ENGENHARIA', 200, 35, { align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.LIGHT_TEXT)
       .text('R. Luís Spiandorelli Neto, 60 - Valinhos/SP', 200, 53, { align: 'right' })
       .text('CEP: 13271-570 | Tel: (19) 99800-2260', 200, 65, { align: 'right' })
       .text('contato@sondamais.com.br', 200, 77, { align: 'right' });

    doc.moveTo(40, 95).lineTo(555, 95).strokeColor(COLORS.PRIMARY).lineWidth(2).stroke();

    // --- 2. DADOS (LAYOUT DE CAIXAS) ---
    const startY = 110;
    const boxHeight = 75; // Aumentei um pouco para caber 3 linhas de texto confortavelmente
    
    // Caixa Esquerda (Info Orçamento)
    doc.rect(40, startY, 150, boxHeight).fillAndStroke('#f9f9f9', COLORS.BORDER);
    doc.fillColor(COLORS.SECONDARY).fontSize(9).font('Helvetica-Bold')
       .text('ORÇAMENTO TÉCNICO', 50, startY + 10);
    doc.fillColor('black').font('Helvetica').fontSize(9)
       .text(`Nº Proposta: ${d.id}/2026`, 50, startY + 30)
       .text(`Data: ${d.data}`, 50, startY + 45);

    // Caixa Direita (Info Cliente)
    doc.rect(200, startY, 355, boxHeight).strokeColor(COLORS.BORDER).stroke();
    doc.fillColor(COLORS.SECONDARY).fontSize(9).font('Helvetica-Bold')
       .text('DADOS DO CLIENTE', 210, startY + 10);
    
    doc.fillColor('black').font('Helvetica').fontSize(9);
    
    // Linha 1: Nome
    doc.text(`Cliente: ${d.cliente}`, 210, startY + 28, { width: 330, ellipsis: true });

    // Linha 2: Contato (Se houver)
    let nextY = startY + 42;
    let contactInfo = [];
    if(d.telefone) contactInfo.push(`Tel: ${d.telefone}`);
    if(d.email) contactInfo.push(`Email: ${d.email}`);
    
    if(contactInfo.length > 0) {
        doc.text(contactInfo.join('  |  '), 210, nextY, { width: 330, ellipsis: true });
        nextY += 14; // Pula linha se escreveu contato
    }

    // Linha 3: Endereço
    doc.text(`Local: ${d.endereco}`, 210, nextY, { width: 330, ellipsis: true });

    // --- 3. TABELA DE ITENS ---
    doc.y = startY + boxHeight + 20; // Espaço fixo após as caixas
    const tableTop = doc.y;
    
    doc.rect(40, tableTop, 515, 20).fill(COLORS.TABLE_HEADER);
    doc.fillColor('black').font('Helvetica-Bold').fontSize(8);
    
    const colDesc = 50;
    const colQtd = 330;
    const colUnit = 390;
    const colTotal = 470;

    doc.text('DESCRIÇÃO DOS SERVIÇOS', colDesc, tableTop + 6);
    doc.text('QTD.', colQtd, tableTop + 6);
    doc.text('UNIT. (R$)', colUnit, tableTop + 6, { width: 60, align: 'right' });
    doc.text('TOTAL (R$)', colTotal, tableTop + 6, { width: 80, align: 'right' });

    doc.y += 25;

    function drawRow(desc, subtext, qtd, unit, total, isDiscount = false) {
        const rowY = doc.y;
        if (rowY > 700) { doc.addPage(); doc.y = 50; }

        doc.font('Helvetica').fontSize(9).fillColor(isDiscount ? '#cc0000' : COLORS.DARK_TEXT);
        doc.text(desc, colDesc, rowY, { width: 270 });
        
        if (subtext) {
            doc.fontSize(7).fillColor(COLORS.LIGHT_TEXT)
               .text(subtext, colDesc, rowY + 12, { width: 270 });
            doc.fontSize(9);
        }

        doc.fillColor(isDiscount ? '#cc0000' : COLORS.DARK_TEXT);
        doc.text(qtd, colQtd, rowY);
        doc.text(unit, colUnit, rowY, { width: 60, align: 'right' });
        doc.text(total, colTotal, rowY, { width: 80, align: 'right' });

        doc.moveTo(40, rowY + 25).lineTo(555, rowY + 25)
           .strokeColor('#EEEEEE').lineWidth(0.5).stroke();
        
        doc.y = rowY + 30;
    }

    drawRow('Sondagem SPT (conf. NBR 6484:2020)', 
            `Estimativa: ${d.furos} furos. Metragem mínima contratada.`, 
            `${d.metragem} m`, 
            d.valor_metro.toLocaleString('pt-BR', {minimumFractionDigits: 2}), 
            d.subtotal_sondagem.toLocaleString('pt-BR', {minimumFractionDigits: 2}));

    if (d.mobilizacao > 0) 
        drawRow('Mobilização e Desmobilização', null, '1 vb', 
            d.mobilizacao.toLocaleString('pt-BR', {minimumFractionDigits: 2}), 
            d.mobilizacao.toLocaleString('pt-BR', {minimumFractionDigits: 2}));

    if (d.art > 0) 
        drawRow('Emissão de ART (Taxa CREA)', null, '1 un', 
            d.art.toLocaleString('pt-BR', {minimumFractionDigits: 2}), 
            d.art.toLocaleString('pt-BR', {minimumFractionDigits: 2}));

    if (d.desconto > 0) 
        drawRow('Desconto Comercial', null, '-', 
            '-', 
            `- ${d.desconto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, true);

    // Total Geral
    doc.moveDown(0.5);
    doc.rect(380, doc.y, 175, 25).fill('#f0f0f0');
    doc.fillColor(COLORS.SECONDARY).font('Helvetica-Bold').fontSize(11)
       .text(`TOTAL: R$ ${d.total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 390, doc.y - 18, { width: 160, align: 'right' });

    // --- 4. RODAPÉ TÉCNICO E NOTAS ---
    doc.y += 40;
    if (doc.y > 580) doc.addPage(); // Garante espaço para o rodapé inteiro

    // Título das Notas
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.SECONDARY).text('NOTAS TÉCNICAS E CRITÉRIOS DE PARALISAÇÃO', 40, doc.y);
    doc.moveDown(0.5);
    
    // CORREÇÃO DO ERRO DE CORTE: Definimos explicitamente o X para 40
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.DARK_TEXT);
    const notas = [
        "1. CRITÉRIO DE PARALISAÇÃO: Segue estritamente as recomendações da NBR 6484:2020.",
        `2. METRAGEM EXCEDENTE: Caso a profundidade ultrapasse ${d.metragem}m, será cobrado R$ ${d.valor_metro.toLocaleString('pt-BR', {minimumFractionDigits: 2})} por metro adicional.`,
        "3. RESPONSABILIDADES DO CLIENTE: Locação dos furos (topografia) e fornecimento de água na obra.",
        "4. FATURAMENTO: Ocorrendo necessidade de avançar a metragem para atender norma técnica, o excedente é faturado automaticamente."
    ];
    
    for (let nota of notas) { 
        // AQUI ESTÁ A CORREÇÃO: Forçamos o texto a começar no X=40 e ter largura máxima de 515
        doc.text(nota, 40, doc.y, { width: 515, align: 'justify' }); 
        doc.moveDown(0.3); 
    }

    // --- 5. CRONOGRAMA E PAGAMENTO ---
    doc.moveDown(1);
    const footerY = doc.y;
    
    // Coluna Cronograma
    doc.rect(40, footerY, 250, 75).strokeColor(COLORS.BORDER).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.SECONDARY)
       .text('CRONOGRAMA PREVISTO', 50, footerY + 10);
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.DARK_TEXT)
       .text('• Início: A combinar (mediante agenda).', 50, footerY + 25)
       .text('• Execução: Estimado 1 a 2 dias.', 50, footerY + 37)
       .text('• Relatório: Até 3 dias úteis após campo.', 50, footerY + 49)
       .text('• Validade da Proposta: 10 dias.', 50, footerY + 61);

    // Coluna Pagamento
    doc.rect(305, footerY, 250, 75).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.SECONDARY)
       .text('CONDIÇÕES DE PAGAMENTO', 315, footerY + 10);
    
    doc.fillColor('#cc0000').text('50% NO ACEITE (Sinal)', 315, footerY + 25);
    doc.fillColor(COLORS.DARK_TEXT).text('50% NA ENTREGA DO LAUDO', 315, footerY + 37);
    
    doc.font('Helvetica-Oblique').fontSize(7).fillColor(COLORS.LIGHT_TEXT)
       .text('Chave PIX e Dados Bancários serão enviados', 315, footerY + 55)
       .text('no corpo do e-mail de faturamento.', 315, footerY + 65);

    doc.end();
}

// --- MIGRATION (Continua aqui para segurança) ---
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
    console.log('>>> SISTEMA ONLINE: PDF VISUALMENTE CORRIGIDO <<<');
    app.listen(port, () => { console.log(`Rodando na porta ${port}`); });
  })
  .catch(err => { console.error('ERRO NO BANCO:', err); });