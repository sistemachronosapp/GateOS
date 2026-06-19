const axios = require('axios');

// Alterna automaticamente entre Sandbox (Testes) e Produção
const ASAAS_URL = process.env.NODE_ENV === 'production' 
    ? 'https://api.asaas.com/v3' 
    : 'https://sandbox.asaas.com/api/v3';

const asaasApi = axios.create({
    baseURL: ASAAS_URL,
    headers: {
        'access_token': process.env.ASAAS_API_KEY,
        'Content-Type': 'application/json'
    }
});

exports.criarCliente = async (nome, email, cpfCnpj) => {
    try {
        const response = await asaasApi.post('/customers', {
            name: nome,
            email: email,
            cpfCnpj: cpfCnpj
        });
        return response.data; // Retorna os dados, incluindo o id (cus_...)
    } catch (error) {
        console.error('Erro ao criar cliente no Asaas:', error.response?.data || error.message);
        throw new Error('Falha na integração de cliente (Asaas)');
    }
};

exports.criarAssinatura = async (customerId, valorTotal, dataPrimeiroVencimento) => {
    try {
        const response = await asaasApi.post('/subscriptions', {
            customer: customerId,
            billingType: 'UNDEFINED', // Permite que o síndico pague via PIX, Boleto ou Cartão
            value: valorTotal,
            nextDueDate: dataPrimeiroVencimento, // Ex: Daqui a 7 dias
            cycle: 'MONTHLY', // A mágica da automação: a cada 30 dias repete
            description: 'Licença de Uso - GateOS'
        });
        return response.data; // Retorna os dados da assinatura, incluindo o link de pagamento
    } catch (error) {
        console.error('Erro ao criar assinatura no Asaas:', error.response?.data || error.message);
        throw new Error('Falha ao gerar cobrança recorrente (Asaas)');
    }
};

exports.obterFaturaPendente = async (customerId) => {
    try {
        // Busca faturas PENDENTES
        const responsePending = await asaasApi.get(`/payments?customer=${customerId}&status=PENDING`);
        if (responsePending.data.data && responsePending.data.data.length > 0) {
            return responsePending.data.data[0].invoiceUrl; // Retorna o link da fatura mais recente
        }
        
        // Se não achar pendente, busca se tem alguma ATRASADA
        const responseOverdue = await asaasApi.get(`/payments?customer=${customerId}&status=OVERDUE`);
        if (responseOverdue.data.data && responseOverdue.data.data.length > 0) {
            return responseOverdue.data.data[0].invoiceUrl;
        }

        return null; // Nenhuma fatura em aberto
    } catch (error) {
        console.error('Erro ao buscar fatura no Asaas:', error.response?.data || error.message);
        throw new Error('Falha ao consultar faturas.');
    }
};
exports.obterResumoFinanceiro = async (customerId) => {
    try {
        // Busca a fatura mais recente do cliente
        const res = await asaasApi.get(`/payments?customer=${customerId}&limit=1`);
        if (res.data.data && res.data.data.length > 0) {
            return {
                dueDate: res.data.data[0].dueDate, // Puxa a data de vencimento
                value: res.data.data[0].value
            };
        }
        return null;
    } catch (error) {
        console.error('Erro ao buscar resumo:', error.message);
        return null;
    }
};