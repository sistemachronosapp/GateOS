const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { SECRET_KEY } = require('../middlewares/auth');
const crypto = require('crypto');

exports.register = async (req, res) => {
    // Adicionámos cnpj e qtdUnidades na receção dos dados
    const { email, password, tipo, nomeCondominio, cnpj, qtdUnidades, codigoAcesso, unitType, unitNumber, unitBlock } = req.body;

    try {
        const hash = await bcrypt.hash(password, 10);
        let condominio;

        if (tipo === 'novo_condominio') {
            const code = crypto.randomBytes(3).toString('hex').toUpperCase();
            condominio = await prisma.condominio.create({
                data: {
                    nome: nomeCondominio,
                    cnpj: cnpj,
                    qtdUnidades: parseInt(qtdUnidades), // Guarda o limite do plano!
                    accessCode: code
                }
            });

            await prisma.user.create({
                data: {
                    email, password: hash, role: 'admin', condominioId: condominio.id,
                    unitType, unitNumber, unitBlock
                }
            });
        } else {
            condominio = await prisma.condominio.findFirst({ where: { accessCode: codigoAcesso } });

            if (!condominio) return res.status(404).json({ error: 'Código inválido.' });

            if (!condominio.codeExpiresAt || new Date() > condominio.codeExpiresAt) {
                return res.status(403).json({ error: 'Este código expirou. Peça ao síndico para gerar um novo.' });
            }

            // NOVA REGRA DE NEGÓCIO AQUI: Limite de Contas = Qtd de Unidades
            const totalUsuariosAtuais = await prisma.user.count({
                where: { condominioId: condominio.id, role: 'morador' }
            });

            // Se o limite foi atingido (e não for nulo), bloqueia o cadastro
            if (condominio.qtdUnidades && totalUsuariosAtuais >= condominio.qtdUnidades) {
                return res.status(403).json({
                    error: `Limite atingido. O plano atual suporta no máximo ${condominio.qtdUnidades} cadastros.`
                });
            }

            // Se passou da trava, cadastra o usuário normalmente
            await prisma.user.create({
                data: {
                    email, password: hash, role: 'morador', condominioId: condominio.id,
                    unitType, unitNumber, unitBlock
                }
            });
        }
        res.status(201).json({ message: 'Conta criada com sucesso!' });
    } catch (e) {
        console.error(e);
        res.status(400).json({ error: 'Erro ao criar conta. Verifique os dados.' });
    }
};

exports.login = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { email: req.body.email } });
        if (!user || !await bcrypt.compare(req.body.password, user.password)) {
            return res.status(400).json({ error: 'Credenciais inválidas' });
        }

        const token = jwt.sign({
            id: user.id, email: user.email, role: user.role, condominioId: user.condominioId
        }, SECRET_KEY);

        const condominio = await prisma.condominio.findUnique({ where: { id: user.condominioId } });

        res.json({
            token,
            email: user.email,
            role: user.role,
            condominioNome: condominio ? condominio.nome : 'Sem Condomínio',
            accessCode: user.role === 'admin' && condominio ? condominio.accessCode : null,
            mustChangePassword: user.mustChangePassword,
            statusPagamento: condominio ? condominio.statusPagamento : 'TRIAL'
        });
    } catch (e) {
        console.error("Erro no login:", e);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
};

exports.superLogin = (req, res) => {
    const { email, password } = req.body;
    if (email === process.env.SUPER_ADMIN_EMAIL && password === process.env.SUPER_ADMIN_PASS) {
        const token = jwt.sign({
            id: 'cortex-master', email: email, role: 'superadmin'
        }, process.env.JWT_SECRET || 'gateos_super_secret_key_prod', { expiresIn: '8h' });
        return res.json({ token, role: 'superadmin', nome: 'Cortex Technologia' });
    }
    return res.status(401).json({ error: 'Credenciais master inválidas.' });
};

exports.changeInitialPassword = async (req, res) => {
    const { newPassword } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

        const hash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hash, mustChangePassword: false }
        });

        res.json({ message: 'Senha atualizada com sucesso!' });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao atualizar senha' });
    }
};