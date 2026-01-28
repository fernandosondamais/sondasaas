const { pool } = require('../app');
const PDFDocument = require('pdfkit');

const COLORS = { SONDA_GREEN: '#2c3e50', DARK_TEXT: '#333333', LIGHT_BG: '#f5f5f5', BORDER: '#dddddd' };

const montarLayoutPDF = (doc, p, empresa) => {
    // Cabeçalho
    doc.rect(0, 0, 600, 80).fill(COLORS.SONDA_GREEN);
    doc.fillColor('#ffffff').fontSize(22).text(empresa.nome_fantasia.toUpperCase(), 30, 30);
    doc.fontSize(10).text('RELATÓRIO DE ORÇAMENTO TÉCNICO', 30, 55);

    // Dados do Cliente
    doc.fillColor(COLORS.DARK_TEXT).fontSize(12).text('DADOS DO CLIENTE', 30, 110, { underline: true });
    doc.fontSize(10).text(`Cliente: ${p.cliente}`, 30, 130);
    doc.text(`Endereço: ${p.endereco}`, 30, 145);
    doc.text(`Contato: ${p.telefone} | ${p.email}`, 30, 160);

    // Tabela de Serviços
    let y = 200;
    doc.rect(30, y, 535, 20).fill(COLORS.LIGHT_BG);
    doc.fillColor(COLORS.DARK_TEXT).text('Descrição', 35, y + 5);
    doc.text('Qtd/Metragem', 300, y + 5);
    doc.text('Total Item', 480, y + 5);

    y += 30;
    doc.text('Sondagem à Percussão (SPT)', 35, y);
    doc.text(`${p.metragem_total} m`, 300, y);
    doc.text(`R$ ${(p.valor_total - p.valor_art - p.valor_mobilizacao + p.valor_desconto).toFixed(2)}`, 480, y);

    y += 20;
    doc.text('Mobilização/Desmobilização', 35, y);
    doc.text('1 un', 300, y);
    doc.text(`R$ ${parseFloat(p.valor_mobilizacao).toFixed(2)}`, 480, y);

    y += 20;
    doc.text('Taxa de ART', 35, y);
    doc.text('1 un', 300, y);
    doc.text(`R$ ${parseFloat(p.valor_art).toFixed(2)}`, 480, y);

    // Resumo Final
    y += 50;
    doc.rect(350, y, 215, 60).stroke(COLORS.BORDER);
    doc.fontSize(12).text(`VALOR TOTAL: R$ ${parseFloat(p.valor_total).toFixed(2)}`, 360, y + 20, { bold: true });
    
    // Assinatura
    doc.fontSize(8).text('________________________________________________', 30, 700);
    doc.text(`Responsável Técnico: ${p.tecnico_responsavel}`, 30, 715);
};

exports.listarPropostas = async (req, res) => {
    try {
        const empresaId = req.session.user.empresa_id;
        const result = await pool.query('SELECT * FROM propostas WHERE empresa_id = $1 ORDER BY data_criacao DESC', [empresaId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.criarProposta = async (req, res) => {
    const d = req.body;
    const empresaId = req.session.user.empresa_id;
    const userNome = req.session.user.nome;
    try {
        const valorTotal = (parseFloat(d.metragem)*parseFloat(d.valor_metro)) + parseFloat(d.art) + parseFloat(d.mobilizacao) - parseFloat(d.desconto);
        const sql = `INSERT INTO propostas (empresa_id, cliente, telefone, email, endereco, furos_previstos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, tecnico_responsavel) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`;
        const values = [empresaId, d.cliente, d.telefone, d.email, d.endereco, d.furos, d.metragem, d.art, d.mobilizacao, d.desconto, valorTotal, userNome];
        const result = await pool.query(sql, values);
        
        const empRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [empresaId]);
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        doc.pipe(res);
        montarLayoutPDF(doc, result.rows[0], empRes.rows[0]);
        doc.end();
    } catch (e) { res.status(500).send('Erro: ' + e.message); }
};

exports.gerarPDFComercial = async (req, res) => {
    try {
        const { id } = req.params;
        const empresaId = req.session.user.empresa_id;
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
        if (result.rows.length === 0) return res.status(404).send('Não encontrado');
        
        const empRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [empresaId]);
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        doc.pipe(res);
        montarLayoutPDF(doc, result.rows[0], empRes.rows[0]);
        doc.end();
    } catch (e) { res.status(500).send(e.message); }
};

exports.atualizarStatus = async (req, res) => {
    const { id } = req.params; const { status } = req.body;
    try { await pool.query('UPDATE propostas SET status = $1 WHERE id = $2', [status, id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); }
};

exports.deletarProposta = async (req, res) => {
    try { await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); }
};