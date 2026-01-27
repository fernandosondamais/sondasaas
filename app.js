const pool = require('../config/db');
const PDFDocument = require('pdfkit');

// --- CONTROLLER DE PROPOSTAS (SaaS) ---

exports.listarPropostas = async (req, res) => {
    try {
        // SEGURANÇA: Só lista propostas da MINHA empresa
        const empresaId = req.session.user.empresa_id;
        const result = await pool.query('SELECT * FROM propostas WHERE empresa_id = $1 ORDER BY data_criacao DESC', [empresaId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.criarProposta = async (req, res) => {
    const d = req.body;
    // Pega o ID da empresa e do usuário logado AUTOMATICAMENTE da sessão
    const empresaId = req.session.user.empresa_id;
    const responsavel = req.session.user.nome;

    try {
        // Cálculos Financeiros
        const metragem = parseFloat(d.metragem) || 0;
        const valorMetro = parseFloat(d.valor_metro) || 0; // Se quiser salvar valor unitário, crie coluna no banco depois
        const art = parseFloat(d.art) || 0;
        const mob = parseFloat(d.mobilizacao) || 0;
        const desc = parseFloat(d.desconto) || 0;
        
        // Total = (Metragem * Preço) + ART + Mob - Desconto
        // Nota: Como não estamos salvando 'valor_metro' no banco ainda, assumimos que o cálculo vem do front ou simplificamos.
        // Vamos salvar o valor total direto por enquanto.
        const valorTotalCalculado = (metragem * valorMetro) + art + mob - desc;

        const sql = `
            INSERT INTO propostas 
            (empresa_id, cliente, telefone, email, endereco, furos_previstos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, tecnico_responsavel) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
            RETURNING *`;
        
        const values = [
            empresaId, 
            d.cliente, d.telefone, d.email, d.endereco, 
            d.furos, d.metragem, 
            art, mob, desc, valorTotalCalculado,
            responsavel
        ];
        
        const result = await pool.query(sql, values);
        
        // Gera o PDF e manda baixar
        // (Aqui você pode chamar sua função de PDF antiga ou usar uma nova, mantive a lógica de resposta)
        const novaProposta = result.rows[0];
        
        // ... Lógica de Gerar PDF aqui (resumida para não ficar gigante, use a sua função montarLayoutPDF) ...
        // Para simplificar: apenas retorna sucesso por enquanto, o PDF é gerado na rota GET especifica ou aqui mesmo.
        
        res.redirect('/orcamento'); // Ou lógica de download do PDF

    } catch (e) {
        console.error(e);
        res.status(500).send('Erro ao criar proposta: ' + e.message);
    }
};

exports.gerarPDFComercial = async (req, res) => {
    // ... (Sua lógica de PDF aqui, lembrando de filtrar por empresa_id)
};

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

exports.deletarProposta = async (req, res) => {
    const empresaId = req.session.user.empresa_id;
    try {
        await pool.query('DELETE FROM propostas WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId]);
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json(err);
    }
};

// Placeholder para relatorio técnico (você pode mover a lógica do app.js antigo pra cá)
exports.gerarRelatorioTecnico = async (req, res) => {
    res.send("Funcionalidade em migração para o novo controller...");
};