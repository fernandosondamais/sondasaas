const pool = require('../config/db');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const COLORS = { 
    SONDA_GREEN: '#2c3e50', // Ajustado para o tema do sistema
    DARK_TEXT: '#333333',
    LIGHT_BG: '#f5f5f5'
};

// --- FUNÇÃO AUXILIAR: DESENHA O LAYOUT DO PDF ---
const montarLayoutPDF = (doc, proposta, dadosEmpresa) => {
    // 1. CABEÇALHO (Agora dinâmico com dados da empresa logada)
    
    // Tenta carregar logo (futuramente virá do S3/URL da empresa)
    // Por enquanto, texto simples se não tiver logo
    doc.fillColor(COLORS.SONDA_GREEN).fontSize(20).font('Helvetica-Bold').text(dadosEmpresa.nome_fantasia || 'SISTEMA DE SONDAGEM', 30, 40);

    // Dados da Empresa (Lado Direito)
    doc.fillColor('#555').fontSize(9).font('Helvetica')
       .text(dadosEmpresa.email_dono || '', 350, 45, { align: 'right' })
       .text(`CNPJ: ${dadosEmpresa.cnpj || 'Não informado'}`, 350, 60, { align: 'right' });

    // Título
    doc.fillColor(COLORS.SONDA_GREEN).fontSize(16).font('Helvetica-Bold').text('ORÇAMENTO DE SONDAGEM', 30, 140);
    doc.rect(30, 160, 535, 2).fill(COLORS.SONDA_GREEN);

    // 2. DADOS DA PROPOSTA
    let y = 170;
    
    // Linha 1: Metadados
    doc.fillColor('black').fontSize(10).font('Helvetica-Bold').text('Data:', 30, y);
    doc.font('Helvetica').text(new Date(proposta.data_criacao).toLocaleDateString('pt-BR'), 30, y + 15);
    
    // Como o ID agora é UUID (longo), mostramos apenas os primeiros 8 caracteres para ficar bonito no PDF
    const idCurto = proposta.id.split('-')[0].toUpperCase();
    doc.font('Helvetica-Bold').text('Proposta Nº:', 150, y);
    doc.font('Helvetica').text(`${idCurto}/${new Date().getFullYear()}`, 150, y + 15);

    doc.font('Helvetica-Bold').text('Responsável:', 300, y);
    doc.font('Helvetica').text(proposta.tecnico_responsavel || 'Equipe Técnica', 300, y + 15);

    y += 40;
    // Linha 2: Cliente
    doc.font('Helvetica-Bold').text('Cliente:', 30, y);
    doc.font('Helvetica').text(proposta.cliente, 80, y);
    
    y += 15;
    doc.font('Helvetica-Bold').text('Local:', 30, y);
    doc.font('Helvetica').text(proposta.endereco || 'Não informado', 80, y);

    y += 15;
    doc.font('Helvetica-Bold').text('Contato:', 30, y);
    let contato = proposta.telefone || '';
    if(proposta.email) contato += ` | ${proposta.email}`;
    doc.font('Helvetica').text(contato, 80, y);

    // 3. TABELA DE ITENS
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

    // Cálculos para exibição
    const valorTotal = parseFloat(proposta.valor_total);
    const valorDesc = parseFloat(proposta.valor_desconto) || 0;
    const valorArt = parseFloat(proposta.valor_art) || 0;
    const valorMob = parseFloat(proposta.valor_mobilizacao) || 0;
    const metragem = parseFloat(proposta.metragem_total) || 0;

    // Valor da Sondagem Pura (Total - Extras + Desconto)
    const totalSondagem = valorTotal + valorDesc - valorArt - valorMob;
    const unitSondagem = metragem > 0 ? (totalSondagem / metragem) : 0;

    // Item 1: Sondagem
    doc.text('Sondagem SPT (NBR 6484:2020)', col.DESC, y);
    doc.fontSize(8).fillColor('#666')
       .text('Execução de sondagem à percussão.', col.DESC, y + 12, { width: 250 });
    
    doc.fontSize(9).fillColor('black');
    doc.text(`${metragem}m`, col.QTD, y);
    doc.text(`R$ ${unitSondagem.toFixed(2)}`, col.UNIT, y);
    doc.text(`R$ ${totalSondagem.toFixed(2)}`, col.TOTAL, y);

    // Item 2: Mobilização
    y += 35;
    doc.text('Mobilização de Equipe/Equipamentos', col.DESC, y);
    doc.text('1', col.QTD, y);
    doc.text(`R$ ${valorMob.toFixed(2)}`, col.UNIT, y);
    doc.text(`R$ ${valorMob.toFixed(2)}`, col.TOTAL, y);

    // Item 3: ART
    y += 20;
    doc.text('Emissão de ART', col.DESC, y);
    doc.text('1', col.QTD, y);
    doc.text(`R$ ${valorArt.toFixed(2)}`, col.UNIT, y);
    doc.text(`R$ ${valorArt.toFixed(2)}`, col.TOTAL, y);

    // Item 4: Desconto
    if (valorDesc > 0) {
        y += 20;
        doc.fillColor('red');
        doc.text('Desconto Comercial', col.DESC, y);
        doc.text('-', col.QTD, y);
        doc.text(`- R$ ${valorDesc.toFixed(2)}`, col.UNIT, y);
        doc.text(`- R$ ${valorDesc.toFixed(2)}`, col.TOTAL, y);
    }

    // Linha Total
    y += 30;
    doc.moveTo(30, y).lineTo(565, y).stroke();
    y += 10;
    doc.fillColor('black').font('Helvetica-Bold').fontSize(12);
    doc.text('TOTAL GERAL', 300, y);
    doc.fillColor(COLORS.SONDA_GREEN).fontSize(14);
    doc.text(`R$ ${valorTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y - 2);

    // Pagamento
    y += 30;
    doc.fillColor('black').fontSize(10).font('Helvetica-Bold').text('CONDIÇÕES DE PAGAMENTO:', 30, y);
    doc.fontSize(10).font('Helvetica').text('50% no Aceite + 50% na Entrega do Relatório.', 30, y + 15);

    // Textos Legais
    y += 45;
    if(y > 700) { doc.addPage(); y = 50; }

    doc.rect(30, y, 535, 100).fill('#f9f9f9');
    doc.fillColor('#333').fontSize(8).font('Helvetica-Bold');
    doc.text('CRITÉRIOS TÉCNICOS:', 40, y + 10);
    doc.font('Helvetica').fontSize(8).text(
        'Serviços executados conforme norma NBR 6484. Paralisamos o furo conforme critérios normativos de impenetrábilidade.',
        40, y + 25, { width: 510 }
    );
    
    // Rodapé
    doc.fontSize(8).fillColor('#aaa').text('Gerado via SondaSaaS', 30, 780, { align: 'center', width: 535 });
};

// --- CONTROLLERS ---

// LISTAR (Filtrado por Empresa)
exports.listarPropostas = async (req, res) => {
    try {
        const empresaId = req.session.user.empresa_id;
        // Só busca propostas da empresa logada
        const result = await pool.query(
            'SELECT * FROM propostas WHERE empresa_id = $1 ORDER BY data_criacao DESC', 
            [empresaId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// CRIAR (Vinculado à Empresa)
exports.criarProposta = async (req, res) => {
    const d = req.body;
    const empresaId = req.session.user.empresa_id; // Pega ID da sessão
    const userNome = req.session.user.nome;

    try {
        // 1. Cálculos
        const metragem = parseFloat(d.metragem) || 0;
        const valorMetro = parseFloat(d.valor_metro) || 0; // valor_metro vem do front, mas não salvamos no banco pra simplificar
        const art = parseFloat(d.art) || 0;
        const mob = parseFloat(d.mobilizacao) || 0;
        const desc = parseFloat(d.desconto) || 0;
        const valorTotal = (metragem * valorMetro) + art + mob - desc;

        // 2. Salvar no Banco (Com empresa_id)
        const sql = `
            INSERT INTO propostas 
            (empresa_id, cliente, telefone, email, endereco, furos_previstos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, tecnico_responsavel) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
            RETURNING *`;
        
        const values = [
            empresaId, 
            d.cliente, d.telefone, d.email, d.endereco, 
            d.furos, d.metragem, 
            art, mob, desc, valorTotal,
            userNome // Usa o nome do usuário logado como responsável
        ];
        
        const result = await pool.query(sql, values);
        const novaProposta = result.rows[0];

        // 3. Buscar dados da empresa para o PDF
        const empRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [empresaId]);
        const dadosEmpresa = empRes.rows[0];

        // 4. Gerar PDF
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${d.cliente.replace(/ /g, '_')}.pdf"`);
        
        doc.pipe(res);
        montarLayoutPDF(doc, novaProposta, dadosEmpresa);
        doc.end();

    } catch (e) {
        console.error(e);
        res.status(500).send('Erro ao criar proposta: ' + e.message);
    }
};

// GERAR PDF (Via Botão na Lista)
exports.gerarPDFComercial = async (req, res) => {
    try {
        const { id } = req.params;
        const empresaId = req.session.user.empresa_id;

        // Busca Proposta (Segura: filtra por empresa)
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
        
        if (result.rows.length === 0) return res.status(404).send('Proposta não encontrada ou acesso negado');
        const p = result.rows[0];

        // Busca Empresa
        const empRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [empresaId]);
        const dadosEmpresa = empRes.rows[0];

        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${p.cliente.replace(/ /g, '_')}.pdf"`);
        
        doc.pipe(res);
        montarLayoutPDF(doc, p, dadosEmpresa);
        doc.end();

    } catch (e) {
        console.error(e);
        res.status(500).send('Erro ao gerar PDF');
    }
};

// ATUALIZAR STATUS (Kanban)
exports.atualizarStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const empresaId = req.session.user.empresa_id;

    try {
        await pool.query('UPDATE propostas SET status = $1 WHERE id = $2 AND empresa_id = $3', [status, id, empresaId]);
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json(err);
    }
};

// DELETAR
exports.deletarProposta = async (req, res) => {
    const empresaId = req.session.user.empresa_id;
    try {
        await pool.query('DELETE FROM propostas WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId]);
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json(err);
    }
};