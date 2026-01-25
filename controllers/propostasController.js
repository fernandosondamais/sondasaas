// controllers/propostasController.js
const pool = require('../config/db');
const PDFDocument = require('pdfkit');

const COLORS = { SONDA_GREEN: '#8CBF26' };

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

exports.gerarPDFComercial = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).send('Proposta não encontrada');

        const p = result.rows[0];
        const doc = new PDFDocument({ margin: 50, size: 'A4' });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${p.cliente.replace(/ /g, '_')}.pdf"`);
        doc.pipe(res);

        doc.rect(0, 0, 595, 100).fill(COLORS.SONDA_GREEN);
        doc.fillColor('white').fontSize(24).font('Helvetica-Bold').text('SONDAMAIS', 50, 40);
        doc.fontSize(10).text('Engenharia de Solos', 50, 65);

        doc.fillColor('black').moveDown(4);
        doc.font('Helvetica-Bold').fontSize(16).text('ORÇAMENTO COMERCIAL', { align: 'center' });
        doc.moveDown();

        doc.font('Helvetica-Bold').fontSize(12).text('Cliente:');
        doc.font('Helvetica').text(`${p.cliente} - ${p.endereco}`);
        doc.moveDown();

        const startY = doc.y;
        doc.font('Helvetica-Bold').text('Descrição', 50, startY);
        doc.text('Valor (R$)', 450, startY, { align: 'right' });
        doc.moveTo(50, startY + 15).lineTo(545, startY + 15).stroke();

        let currentY = startY + 30;
        doc.font('Helvetica');

        const valSonda = (parseFloat(p.valor_total) + parseFloat(p.valor_desconto) - parseFloat(p.valor_art) - parseFloat(p.valor_mobilizacao));
        doc.text(`Sondagem SPT (${p.metragem_total}m)`, 50, currentY);
        doc.text(valSonda.toLocaleString('pt-BR', {minimumFractionDigits: 2}), 450, currentY, { align: 'right' });
        currentY += 20;

        doc.font('Helvetica-Bold').fontSize(14);
        doc.text('TOTAL:', 50, currentY + 20);
        doc.text(`R$ ${parseFloat(p.valor_total).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 450, currentY + 20, { align: 'right' });

        doc.end();
    } catch (e) {
        console.error(e);
        res.status(500).send('Erro ao gerar PDF');
    }
};