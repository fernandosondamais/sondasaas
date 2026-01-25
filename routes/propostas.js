const express = require('express');
const router = express.Router();
// Importa o controller que tem a lógica
const controller = require('../controllers/propostasController');

// --- Definição das Rotas ---

// GET /api/propostas -> Lista todas
router.get('/', controller.listarPropostas);

// POST /api/propostas -> Cria nova (usado pelo app e form)
router.post('/', controller.criarProposta);

// PATCH /api/propostas/:id/status -> Atualiza status (Kanban)
router.patch('/:id/status', controller.atualizarStatus);

// DELETE /api/propostas/:id -> Remove proposta
router.delete('/:id', controller.deletarProposta);

// GET /api/propostas/:id/pdf -> Gera o PDF Comercial (Novo)
router.get('/:id/pdf', controller.gerarPDFComercial);

module.exports = router;