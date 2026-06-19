const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, isAdmin } = require('../middlewares/auth');
const asaasService = require('../services/asaasService');

router.post('/checkout', authenticate, isAdmin, async (req, res) => {
    try {
        const condominio = await prisma.condominio.findUnique({ where: { id: req.user.condominioId } });
        if (!condominio || !condominio.asaasId) return res.status(400).json({ error: 'Condomínio não possui integração financeira.' });

        const linkPagamento = await asaasService.obterFaturaPendente(condominio.asaasId);

        if (linkPagamento) {
            res.json({ linkPagamento });
        } else {
            res.status(404).json({ error: 'Você não tem faturas em aberto no momento!' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Erro ao conectar com a operadora financeira.' });
    }
});

router.post('/webhook', async (req, res) => {
    const webhookToken = req.headers['asaas-access-token'];
    
    if (webhookToken !== process.env.ASAAS_WEBHOOK_TOKEN) {
        return res.status(401).json({ error: 'Acesso negado.' });
    }

    const { event, payment } = req.body;
    if (!event || !payment || !payment.customer) return res.status(400).json({ error: 'Estrutura inválida.' });

    res.sendStatus(200);

    setImmediate(async () => {
        try {
            const condominio = await prisma.condominio.findFirst({ where: { asaasId: payment.customer } });
            if (!condominio) return;

            switch (event) {
                case 'PAYMENT_RECEIVED':
                case 'PAYMENT_CONFIRMED':
                    await prisma.condominio.update({ 
                        where: { id: condominio.id }, data: { statusPagamento: 'EM_DIA' } 
                    });
                    break;
                case 'PAYMENT_OVERDUE':
                    await prisma.condominio.update({ 
                        where: { id: condominio.id }, data: { statusPagamento: 'PENDENTE' } 
                    });
                    break;
            }
        } catch (err) {
            console.error('Erro webhook:', err);
        }
    });
});
// Rota para puxar as informações rápidas pro Dashboard
router.get('/resumo', authenticate, isAdmin, async (req, res) => {
    try {
        const condominio = await prisma.condominio.findUnique({ where: { id: req.user.condominioId } });
        
        if (!condominio || !condominio.asaasId) {
            return res.json({ resumo: null });
        }

        const resumo = await asaasService.obterResumoFinanceiro(condominio.asaasId);
        res.json({ resumo });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar resumo financeiro.' });
    }
});
module.exports = router;