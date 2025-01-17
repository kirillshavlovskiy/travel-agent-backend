declare module 'amadeus' {
  interface AmadeusConfig {
    clientId: string;
    clientSecret: string;
    hostname?: string;
  }

  interface AmadeusClient {
    get(endpoint: string, params?: Record<string, any>): Promise<any>;
  }

  export default class Amadeus {
    constructor(config: AmadeusConfig);
    client: AmadeusClient;
  }
} 