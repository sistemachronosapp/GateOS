const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;

// Configura o Pool de conexões nativo do Postgres
const pool = new Pool({ connectionString });

// Conecta o adaptador do Postgres ao Prisma
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

module.exports = prisma;