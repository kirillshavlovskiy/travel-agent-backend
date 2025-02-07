import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

// Load environment variables
dotenv.config();

interface PerplexityConfig {
  perplexityApiKey: string;
  viatorApiKey: string;
  apis: {
    perplexity: {
      baseUrl: string;
      version: string;
      endpoints: {
        chat: string;
        activities: string;
        enrichment: string;
      };
    };
  };
}

const config: PerplexityConfig = {
  perplexityApiKey: process.env.PERPLEXITY_API_KEY || '',
  viatorApiKey: process.env.VIATOR_API_KEY || '',
  apis: {
    perplexity: {
      baseUrl: process.env.PERPLEXITY_API_URL || 'https://api.perplexity.ai',
      version: 'v1',
      endpoints: {
        chat: '/chat/completions',
        activities: '/activities',
        enrichment: '/enrichment'
      }
    }
  }
};

// Validate required environment variables
const requiredEnvVars = ['PERPLEXITY_API_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required environment variables:', missingEnvVars);
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

logger.info('Environment configuration loaded successfully');

export { config };