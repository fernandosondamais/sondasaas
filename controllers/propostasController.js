const pool = require('../config/db');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const COLORS = { 
    SONDA_GREEN: '#8CBF26', 
    DARK_TEXT: '#333333',
    LIGHT_BG: '#f5f5f5'
};

exports.listarPropostas = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM propostas ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.criarProposta = async (req, res) => {
    const d = req.body;
    try {
        const metragem = parseFloat(d.metragem) || 0;
        const valorMetro = parseFloat(d.valor_metro) || 0;
        const art = parseFloat(d.art) || 0;
        const mob = parseFloat(d.mobilizacao) || 0;
        const desc = parseFloat(d.desconto) || 0;
        const valorTotal = (metragem * valorMetro) + art + mob - desc;

        const sql = `INSERT INTO propostas (cliente, telefone, email, endereco, furos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`;
        const values = [d.cliente, d.telefone, d.email, d.endereco, d.furos, d.metragem, d.art, d.mobilizacao, d.desconto, valorTotal];

        await pool.query(sql, values);
        res.redirect('/admin'); 
    } catch (e) {
        console.error(e);
        res.status(500).send('Erro ao salvar proposta.');
    }
};

exports.atualizarStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await pool.query('UPDATE propostas SET status = $1 WHERE id = $2', [status, id]);
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json(err);
    }
};

exports.deletarProposta = async (req, res) => {
    try {
        await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]);
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json(err);
    }
};

// --- GERAÇÃO DO PDF COMERCIAL (Layout Padrão Sondamais) ---
exports.gerarPDFComercial = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).send('Proposta não encontrada');

        const p = result.rows[0];
        const doc = new PDFDocument({ margin: 30, size: 'A4' });

        // Configurar cabeçalhos de download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${id}_${p.cliente.replace(/ /g, '_')}.pdf"`);
        doc.pipe(res);

        // --- 1. CABEÇALHO ---
        const logoPath = path.join(__dirname, '../public', 'logo.png');
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 30, 30, { width: 100 });
        } else {
            // Fallback se não tiver logo
            doc.fillColor(COLORS.SONDA_GREEN).fontSize(20).font('Helvetica-Bold').text('SONDAMAIS', 30, 40);
        }

        // Dados da Empresa (Lado Direito)
        doc.fillColor('#555').fontSize(9).font('Helvetica')
           .text('Sondamais Engenharia', 350, 30, { align: 'right' })
           .text('R. Luis Spiandorelli Neto, 60', 350, 45, { align: 'right' })
           .text('Valinhos, São Paulo, 13271-570', 350, 60, { align: 'right' })
           .text('(19) 99800-2260', 350, 75, { align: 'right' });

        // Título
        doc.moveDown(4);
        doc.fillColor(COLORS.SONDA_GREEN).fontSize(16).font('Helvetica-Bold').text('ORÇAMENTO DE SONDAGEM', 30, 110);
        doc.rect(30, 130, 535, 2).fill(COLORS.SONDA_GREEN); // Linha verde

        // --- 2. DADOS DA PROPOSTA (Grid) ---
        let y = 145;
        const boxHeight = 60;
        
        // Coluna 1
        doc.fillColor('black').fontSize(10).font('Helvetica-Bold').text('Data:', 30, y);
        doc.font('Helvetica').text(new Date(p.data_criacao).toLocaleDateString('pt-BR'), 30, y + 15);
        
        doc.font('Helvetica-Bold').text('Proposta Nº:', 150, y);
        doc.font('Helvetica').text(`${p.id}/2026`, 150, y + 15);

        doc.font('Helvetica-Bold').text('Elaborado por:', 300, y);
        doc.font('Helvetica').text('Eng. Fabiano Rielli', 300, y + 15);

        y += 40;
        // Cliente
        doc.font('Helvetica-Bold').text('Cliente:', 30, y);
        doc.font('Helvetica').text(p.cliente, 80, y);
        
        y += 15;
        doc.font('Helvetica-Bold').text('Local:', 30, y);
        doc.font('Helvetica').text(p.endereco, 80, y);

        y += 15;
        doc.font('Helvetica-Bold').text('Contato:', 30, y);
        let contato = p.telefone || '';
        if(p.email) contato += ` | ${p.email}`;
        doc.font('Helvetica').text(contato, 80, y);

        // --- 3. TABELA DE ITENS ---
        y += 40;
        const col = { DESC: 30, QTD: 300, UNIT: 380, TOTAL: 480 };
        
        // Header Tabela
        doc.rect(30, y, 535, 20).fill('#eeeeee');
        doc.fillColor('black').font('Helvetica-Bold').fontSize(9);
        doc.text('DESCRIÇÃO', col.DESC + 5, y + 6);
        doc.text('QTD', col.QTD, y + 6);
        doc.text('UNITÁRIO', col.UNIT, y + 6);
        doc.text('TOTAL', col.TOTAL, y + 6);

        y += 25;
        doc.font('Helvetica').fontSize(9);

        // Item 1: Sondagem
        const valSondagem = parseFloat(p.metragem_total) * (parseFloat(p.valor_total) + parseFloat(p.valor_desconto) - parseFloat(p.valor_art) - parseFloat(p.valor_mobilizacao)) / parseFloat(p.metragem_total);
        // Recalculando unitário da sondagem reverso para garantir precisão ou usar valor fixo se preferir
        // Melhor usar a lógica: Sondagem = (Total + Desc - Art - Mob)
        const totalSondagem = parseFloat(p.valor_total) + parseFloat(p.valor_desconto) - parseFloat(p.valor_art) - parseFloat(p.valor_mobilizacao);
        const unitSondagem = totalSondagem / p.metragem_total;

        doc.text('Sondagem SPT (NBR 6484:2020)', col.DESC, y);
        doc.fontSize(8).fillColor('#666')
           .text('Furos de até critério técnico ou norma. Será cobrado o metro excedente.', col.DESC, y + 12, { width: 250 });
        
        doc.fontSize(9).fillColor('black');
        doc.text(`${p.metragem_total}m`, col.QTD, y);
        doc.text(`R$ ${unitSondagem.toFixed(2)}`, col.UNIT, y);
        doc.text(`R$ ${totalSondagem.toFixed(2)}`, col.TOTAL, y);

        // Item 2: Mobilização
        y += 35;
        doc.text('Mobilização (Logística/Equipe)', col.DESC, y);
        doc.text('1', col.QTD, y);
        doc.text(`R$ ${parseFloat(p.valor_mobilizacao).toFixed(2)}`, col.UNIT, y);
        doc.text(`R$ ${parseFloat(p.valor_mobilizacao).toFixed(2)}`, col.TOTAL, y);

        // Item 3: ART
        y += 20;
        doc.text('Emissão de ART', col.DESC, y);
        doc.text('1', col.QTD, y);
        doc.text(`R$ ${parseFloat(p.valor_art).toFixed(2)}`, col.UNIT, y);
        doc.text(`R$ ${parseFloat(p.valor_art).toFixed(2)}`, col.TOTAL, y);

        // Item 4: Desconto (se houver)
        if (parseFloat(p.valor_desconto) > 0) {
            y += 20;
            doc.fillColor('red');
            doc.text('Desconto Comercial', col.DESC, y);
            doc.text('-', col.QTD, y);
            doc.text(`- R$ ${parseFloat(p.valor_desconto).toFixed(2)}`, col.UNIT, y);
            doc.text(`- R$ ${parseFloat(p.valor_desconto).toFixed(2)}`, col.TOTAL, y);
        }

        // Linha Total
        y += 30;
        doc.moveTo(30, y).lineTo(565, y).stroke();
        y += 10;
        doc.fillColor('black').font('Helvetica-Bold').fontSize(12);
        doc.text('TOTAL GERAL', 300, y);
        doc.fillColor(COLORS.SONDA_GREEN).fontSize(14);
        doc.text(`R$ ${parseFloat(p.valor_total).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y - 2);

        // Pagamento
        y += 30;
        doc.fillColor('black').fontSize(10).font('Helvetica-Bold').text('CONDIÇÕES DE PAGAMENTO:', 30, y);
        doc.fontSize(10).font('Helvetica').text('50% Sinal (Início) + 50% na Entrega do Laudo (PIX/Transferência).', 30, y + 15);

        // --- 4. TEXTOS LEGAIS (NBR) ---
        y += 45;
        doc.rect(30, y, 535, 130).fill('#f9f9f9'); // Fundo cinza claro
        doc.fillColor('#333').fontSize(8).font('Helvetica-Bold');
        
        const paddingText = y + 10;
        doc.text('CRITÉRIOS DE PARALISAÇÃO (CONFORME NBR 6484:2020):', 40, paddingText);
        doc.font('Helvetica').fontSize(8).text(
            'Na ausência de critério específico do cliente, seguimos a norma técnica. As sondagens avançarão até atingir um dos seguintes critérios (Item 5.2.4):',
            40, paddingText + 15, { width: 510 }
        );
        doc.text('a) 10m consecutivos com N >= 25 golpes;', 40, paddingText + 35);
        doc.text('b) 8m consecutivos com N >= 30 golpes;', 40, paddingText + 48);
        doc.text('c) 6m consecutivos com N >= 35 golpes.', 40, paddingText + 61);
        
        doc.font('Helvetica-Bold').fillColor('red').text(
            'OBS: Caso a profundidade ultrapasse a metragem contratada para atender à norma, será cobrado o valor do metro excedente.',
            40, paddingText + 80, { width: 510 }
        );

        // --- 5. CRONOGRAMA ---
        y += 140;
        doc.font('Helvetica-Bold').fillColor('black').fontSize(10).text('CRONOGRAMA ESTIMADO', 30, y);
        
        y += 15;
        // Tabela Cronograma Simples
        const cronoY = y;
        doc.fontSize(9).font('Helvetica');
        doc.text('• Previsão de Execução:', 30, cronoY); doc.text('1 a 2 dias úteis', 150, cronoY);
        doc.text('• Início dos Serviços:', 30, cronoY + 15); doc.text('A combinar (após aceite)', 150, cronoY + 15);
        doc.text('• Entrega do Relatório:', 30, cronoY + 30); doc.text('Até 3 dias úteis após campo', 150, cronoY + 30);
        doc.text('• Validade da Proposta:', 30, cronoY + 45); doc.text('10 dias', 150, cronoY + 45);

        // Rodapé
        doc.fontSize(8).fillColor('#aaa').text('SondaSaaS - Gerado automaticamente', 30, 750, { align: 'center', width: 535 });

        doc.end();
    } catch (e) {
        console.error(e);
        res.status(500).send('Erro ao gerar PDF');
    }
};