const { pool } = require('../app');

exports.listarObrasAtivas = async (req, res) => {
    try {
        const empresaId = req.session.user.empresa_id;
        // Apenas propostas 'Aprovadas' viram obras na engenharia
        const result = await pool.query("SELECT id, cliente, endereco FROM propostas WHERE empresa_id = $1 AND status = 'Aprovada'", [empresaId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.listarFuros = async (req, res) => {
    try {
        const { propostaId } = req.params;
        const result = await pool.query("SELECT * FROM furos WHERE proposta_id = $1", [propostaId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.salvarFuro = async (req, res) => {
    const { proposta_id, nome_furo, coordenadas } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO furos (proposta_id, nome_furo, coordenadas) VALUES ($1, $2, $3) RETURNING *",
            [proposta_id, nome_furo, coordenadas]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.salvarAmostra = async (req, res) => {
    const { furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO amostras (furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
            [furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
};