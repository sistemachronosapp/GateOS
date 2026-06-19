const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, isAdmin } = require('../middlewares/auth');
const crypto = require('crypto');

router.use(authenticate, isAdmin);

router.post('/gerar-convite', async (req, res) => {
    try {
        const code = crypto.randomBytes(3).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await prisma.condominio.update({
            where: { id: req.user.condominioId },
            data: { accessCode: code, codeExpiresAt: expiresAt }
        });

        res.json({ code, expiresAt });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao gerar token temporário' });
    }
});

module.exports = router;