const asaasService = require('../services/asaasService');
const { Condominio } = require('../models');

// Função chamada pelo painel do Síndico
exports.assinarGateOS = async (req, res) => {
    const { cnpj, qtdUnidades } = req.body;
    const VALOR_POR_UNIDADE = 5.00;
    
    try {
        const condominio = await Condominio.findByPk(req.user.condominioId);
        
        // 1. Cadastra o condomínio como cliente no Asaas (se não existir)
        let asaasCustomerId = condominio.asaasId;
        
        if (!asaasCustomerId) {
            const clienteAsaas = await asaasService.criarCliente(condominio.nome, req.user.email, cnpj);
            asaasCustomerId = clienteAsaas.id;
            
            // Salva o ID do Asaas no nosso banco para referência futura
            await condominio.update({ asaasId: asaasCustomerId });
        }

        // 2. Cria a assinatura mensal baseada na quantidade de portas/apartamentos
        const valorTotal = qtdUnidades * VALOR_POR_UNIDADE;
        const assinatura = await asaasService.criarAssinatura(asaasCustomerId, valorTotal);

        res.status(200).json({ 
            message: 'Assinatura gerada com sucesso!',
            linkPagamento: assinatura.invoiceUrl // O síndico clica e paga
        });

    } catch (error) {
        res.status(500).json({ error: 'Erro ao processar assinatura.' });
    }
};

// O Webhook - Extremamente Seguro
exports.webhookAsaas = async (req, res) => {
    // Validação de Segurança do Webhook
    const webhookToken = req.headers['asaas-access-token'];
    
    if (webhookToken !== process.env.ASAAS_WEBHOOK_TOKEN) {
        console.warn('Tentativa de fraude no Webhook interceptada!');
        return res.status(401).json({ error: 'Não autorizado' });
    }

    const evento = req.body.event;
    const pagamento = req.body.payment;

    // Responda o Asaas IMEDIATAMENTE com 200 OK para eles não derrubarem a requisição
    res.sendStatus(200);

    // Agora processa de forma assíncrona
    setImmediate(async () => {
        try {
            if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {
                console.log(`Pagamento confirmado para o cliente Asaas: ${pagamento.customer}`);
                
                // Encontra qual condomínio é dono desse customerId
                const condominio = await Condominio.findOne({ where: { asaasId: pagamento.customer } });
                
                if (condominio) {
                    // Libera o acesso do condomínio no sistema
                    await condominio.update({ statusPagamento: 'EM_DIA' });
                    console.log(`✅ Acesso liberado para o condomínio: ${condominio.nome}`);
                }
            } else if (evento === 'PAYMENT_OVERDUE') {
                console.log(`Inadimplência detectada para o cliente: ${pagamento.customer}`);
                // Lógica para bloquear acesso temporariamente ou enviar aviso
            }
        } catch (err) {
            console.error('Erro no processamento interno do webhook:', err);
        }
    });
};