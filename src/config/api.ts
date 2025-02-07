import dotenv from 'dotenv';
dotenv.config();

export const API_CONFIG = {
  PORT: process.env.PORT || 3001,
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3001',
  ENDPOINTS: {
    LOCATIONS: '/api/locations',
    BUDGET: '/api/budget/calculate',
    ACTIVITIES: '/api/activities',
    GENERATE_ACTIVITIES: '/api/activities/generate',
    FLIGHTS: '/api/flights',
    HOTELS: '/api/hotels',
    ENRICHMENT: '/api/enrichment'
  },
  PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || '',
  AMADEUS_API_KEY: process.env.AMADEUS_API_KEY || '',
  AMADEUS_API_SECRET: process.env.AMADEUS_API_SECRET || '',
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || '',
  VIATOR_API_KEY: process.env.VIATOR_API_KEY || ''
};

// Add validation function
export const validateApiConfig = () => {
  if (!process.env.BACKEND_URL) {
    console.warn('[API Config] BACKEND_URL is not set, using default');
  }

  // Validate required API keys
  const requiredKeys = [
    'PERPLEXITY_API_KEY',
    'AMADEUS_API_KEY',
    'AMADEUS_API_SECRET',
    'VIATOR_API_KEY'
  ];

  const missingKeys = requiredKeys.filter(key => !process.env[key]);
  if (missingKeys.length > 0) {
    console.warn('[API Config] Missing required API keys:', missingKeys);
  }

  return true;
};

// Export helper function to construct API URLs
export const getApiUrl = (endpoint: keyof typeof API_CONFIG.ENDPOINTS): string => {
  try {
    const baseUrl = API_CONFIG.BACKEND_URL.replace(/\/$/, '');
    const endpointPath = API_CONFIG.ENDPOINTS[endpoint].replace(/^\//, '');
    return `${baseUrl}/${endpointPath}`;
  } catch (error) {
    console.error(`[API Config] Error constructing URL for ${endpoint}:`, error);
    throw new Error(`Invalid API URL construction: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export default API_CONFIG; 