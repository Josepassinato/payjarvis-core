-- Add MERCADOPAGO to PaymentProvider enum
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'MERCADOPAGO';
