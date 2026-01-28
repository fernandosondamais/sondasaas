const pool = require('../config/db');

exports.listarFuros = async (req, res) => {
    try {
        const { obraId } = req.params; // É um UUID
        // Busca furos da proposta
        const result = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY data_inicio", [obraId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.criarFuro = async (req, res) => {
    const { proposta_id, nome_furo, coordenadas } = req.body;
    try {
        // Tabela furos não tem coluna 'sondador' no script V2 (tem sondador_id), 
        // mas vamos permitir inserir sem sondador por enquanto ou adaptar se o front mandar
        const result = await pool.query(
            "INSERT INTO furos (proposta_id, nome_furo, coordenadas, data_inicio) VALUES ($1, $2, $3, NOW()) RETURNING *",
            [proposta_id, nome_furo, coordenadas]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.listarAmostras = async (req, res) => {
    try {
        const { furoId } = req.params;
        const result = await pool.query("SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini", [furoId]);
        res.json(result.rows);
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

exports.salvarFoto = async (req, res) => {
    // ATENÇÃO: Seu script V2 pede 'url_imagem', não 'imagem_base64'.
    // Vamos salvar o base64 na coluna url_imagem por enquanto para não quebrar a lógica,
    // mas o nome da coluna no INSERT deve respeitar o script: url_imagem
    const { furo_id, imagem_base64, legenda } = req.body;
    try {
        await pool.query(
            "INSERT INTO fotos (furo_id, url_imagem, legenda) VALUES ($1, $2, $3)", 
            [furo_id, imagem_base64, legenda]
        );
        res.sendStatus(200);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.atualizarFuro = async (req, res) => {
    const { id } = req.params; // UUID
    const { nivel_agua_inicial, nivel_agua_final, data_inicio, data_termino, coordenadas } = req.body;
    try {
        await pool.query(
            "UPDATE furos SET nivel_agua_inicial=$1, nivel_agua_final=$2, data_inicio=$3, data_termino=$4, coordenadas=$5 WHERE id=$6",
            [nivel_agua_inicial, nivel_agua_final, data_inicio, data_termino, coordenadas, id]
        );
        res.sendStatus(200);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// Nova função para popular a tela de engenharia.html
exports.dadosCompletosObra = async (req, res) => {
    try {
        const { id } = req.params; // ID da Proposta (UUID)
        
        // 1. Pega Proposta
        const pRes = await pool.query("SELECT * FROM propostas WHERE id = $1", [id]);
        if (pRes.rows.length === 0) return res.status(404).json({error: 'Obra não encontrada'});
        const proposta = pRes.rows[0];

        // 2. Pega Furos
        const fRes = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY nome_furo", [id]);
        const furos = fRes.rows;

        // 3. Para cada furo, pega amostras e fotos
        // (Solução simples: loop async, para produção ideal seria JOIN)
        for (let f of furos) {
            const aRes = await pool.query("SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini", [f.id]);
            f.amostras = aRes.rows;

            const fotoRes = await pool.query("SELECT * FROM fotos WHERE furo_id = $1", [f.id]);
            f.fotos = fotoRes.rows;
        }

        res.json({ proposta, furos });

    } catch (err) { res.status(500).json({ error: err.message }); }
};