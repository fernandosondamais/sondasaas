// routes/propostas.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/propostasController');

router.get('/', controller.listarPropostas);
router.post('/', controller.criarProposta);
router.patch('/:id/status', controller.atualizarStatus);
router.delete('/:id', controller.deletarProposta);
router.get('/:id/pdf', controller.gerarPDFComercial); // Rota do PDF Novo

module.exports = router;