declare module 'amadeus' {
  export interface AmadeusOptions {
    clientId: string;
    clientSecret: string;
    hostname?: string;
  }

  export interface AmadeusClient {
    get(endpoint: string, params?: Record<string, any>): Promise<{
      data: any[];
      meta?: any;
      dictionaries?: any;
    }>;
  }

  export default class Amadeus {
    constructor(options: AmadeusOptions);
    client: AmadeusClient;
  }
} 