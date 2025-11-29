import dotenv from 'dotenv';

dotenv.config({ override: false, quiet: true });

export const config = {
  privateKey: process.env.PRIVATE_KEY || '',
  apiKey: process.env.API_KEY || '',
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT, 10) || 3000,
};
