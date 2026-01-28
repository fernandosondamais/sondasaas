const pool = require('../config/db');
const PDFDocument = require('pdfkit');

const COLORS = { SONDA_GREEN: '#8CBF26', DARK_TEXT: '#333333', LIGHT_BG: '#f5f5f5', BORDER: '#dddddd' };

// Layout do PDF mantido, apenas ajuste de dados
const montarLayoutPDF = (doc, p, empresa) => {
    doc.rect(0, 0, 600, 80).fill(COLORS.SONDA_GREEN);
    doc.fillColor('#ffffff').fontSize(22).text(empresa.nome_fantasia ? empresa.nome_fantasia.toUpperCase() : 'SONDA SAAS', 30, 30);
    doc.fontSize(10).text('RELATÓRIO DE ORÇAMENTO TÉCNICO', 30, 55);

    doc.fillColor(COLORS.DARK_TEXT).fontSize(12).text('DADOS DO CLIENTE', 30, 110, { underline: true });
    doc.fontSize(10).text(`Cliente: ${p.cliente}`, 30, 130);
    doc.text(`Endereço: ${p.endereco || 'Não informado'}`, 30, 145);
    doc.text(`Contato: ${p.telefone || '-'} | ${p.email || '-'}`, 30, 160);

    let y = 200;
    doc.rect(30, y, 535, 20).fill(COLORS.LIGHT_BG);
    doc.fillColor(COLORS.DARK_TEXT).text('Descrição', 35, y + 5);
    doc.text('Qtd/Metragem', 300, y + 5);
    doc.text('Total', 480, y + 5);

    y += 30;
    const valTotal = parseFloat(p.valor_total || 0);
    const valArt = parseFloat(p.valor_art || 0);
    const valMob = parseFloat(p.valor_mobilizacao || 0);
    const valDesc = parseFloat(p.valor_desconto || 0);
    const valSondagem = valTotal - valArt - valMob + valDesc;

    doc.text('Sondagem à Percussão (SPT)', 35, y);
    doc.text(`${p.metragem_total || 0} m`, 300, y);
    doc.text(`R$ ${valSondagem.toFixed(2)}`, 480, y);

    y += 20;
    doc.text('Mobilização', 35, y);
    doc.text('1 un', 300, y);
    doc.text(`R$ ${valMob.toFixed(2)}`, 480, y);

    y += 20;
    doc.text('ART', 35, y);
    doc.text('1 un', 300, y);
    doc.text(`R$ ${valArt.toFixed(2)}`, 480, y);

    if (valDesc > 0) {
        y += 20;
        doc.fillColor('red').text('Desconto', 35, y);
        doc.text(`- R$ ${valDesc.toFixed(2)}`, 480, y);
    }

    y += 50;
    doc.rect(350, y, 215, 40).stroke(COLORS.BORDER);
    doc.fillColor(COLORS.DARK_TEXT).fontSize(12).text(`TOTAL: R$ ${valTotal.toFixed(2)}`, 360, y + 15, { bold: true });
};

exports.listarPropostas = async (req, res) => {
    try {
        const empresaId = req.session.user.empresa_id;
        // Ordenação por data_criacao DESC
        const result = await pool.query('SELECT * FROM propostas WHERE empresa_id = $1 ORDER BY data_criacao DESC', [empresaId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.criarProposta = async (req, res) => {
    const d = req.body;
    const empresaId = req.session.user.empresa_id;
    // Ajuste: tecnico_responsavel ou nome do user
    const userNome = req.session.user.nome;

    try {
        // Cálculo no backend para segurança
        const valorTotal = (parseFloat(d.metragem)*parseFloat(d.valor_metro)) + parseFloat(d.art) + parseFloat(d.mobilizacao) - parseFloat(d.desconto);
        
        // QUERY V2 (Compatível com UUID)
        // Note: removemos "id" do insert para deixar o uuid_generate_v4() atuar
        const sql = `
            INSERT INTO propostas 
            (empresa_id, cliente, telefone, email, endereco, furos_previstos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, tecnico_responsavel, status) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ORCAMENTO') 
            RETURNING *
        `;
        const values = [
            empresaId, 
            d.cliente, d.telefone, d.email, d.endereco, 
            d.furos, d.metragem, 
            d.art, d.mobilizacao, d.desconto, valorTotal, 
            userNome
        ];
        
        const result = await pool.query(sql, values);
        
        // Gera PDF
        const empRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [empresaId]);
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        doc.pipe(res);
        montarLayoutPDF(doc, result.rows[0], empRes.rows[0]);
        doc.end();

    } catch (e) { 
        console.error(e);
        res.status(500).send('Erro V2: ' + e.message); 
    }
};

exports.gerarPDFComercial = async (req, res) => {
    try {
        const { id } = req.params; // ID é UUID agora
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
    const { id } = req.params; 
    const { status } = req.body;
    try { 
        await pool.query('UPDATE propostas SET status = $1 WHERE id = $2', [status, id]); 
        res.sendStatus(200); 
    } catch (e) { res.status(500).json(e); }
};

exports.deletarProposta = async (req, res) => {
    try { 
        await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]); 
        res.sendStatus(200); 
    } catch (e) { res.status(500).json(e); }
};