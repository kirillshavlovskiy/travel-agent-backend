import { logger } from '../utils/logger';
import { API_CONFIG } from '../config/api';

interface Flight {
  price: number;
  cabinClass: string;
  id: string;
  airline: string;
  route: string;
  duration: string;
  layovers: number;
  outbound: string;
  inbound: string;
  referenceUrl?: string;
  details?: any;
}

interface FlightTier {
  maxPrice: number;
  allowedClasses: string[];
}

interface SearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: number;
  tier?: 'budget' | 'medium' | 'premium';
}

interface SearchResult {
  flights: Record<string, Flight[]>;
}

const TIER_CONFIGS: Record<string, FlightTier> = {
  budget: {
    maxPrice: 1000,
    allowedClasses: ['ECONOMY']
  },
  medium: {
    maxPrice: 2000,
    allowedClasses: ['ECONOMY', 'PREMIUM_ECONOMY']
  },
  premium: {
    maxPrice: Infinity,
    allowedClasses: ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']
  }
};

export class FlightService {
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessing = false;
  private readonly RATE_LIMIT_DELAY = 500; // ms between requests

  constructor() {}

  public async searchFlightsAndActivities(params: SearchParams): Promise<SearchResult> {
    return new Promise((resolve) => {
      this.requestQueue.push(async () => {
        try {
          const flightResults = await this.searchFlights(params);
          resolve({ flights: flightResults });
        } catch (error) {
          logger.error('Search failed:', error);
          resolve({ flights: {} });
        }
      });

      this.processQueue();
    });
  }

  private async searchFlights(params: SearchParams): Promise<Record<string, Flight[]>> {
    try {
      // Implement actual flight search logic here
      const flights: Flight[] = []; // Replace with actual API call
      
      const groupedFlights = {
        budget: this.filterFlightsByTier(flights, 'budget'),
        medium: this.filterFlightsByTier(flights, 'medium'),
        premium: this.filterFlightsByTier(flights, 'premium')
      };

      return this.validateFlightDistribution(groupedFlights);
    } catch (error) {
      logger.error('Flight search failed:', error);
      return {};
    }
  }

  private filterFlightsByTier(flights: Flight[], tier: 'budget' | 'medium' | 'premium'): Flight[] {
    const config = TIER_CONFIGS[tier];
    
    return flights.filter(flight => {
      return flight.price <= config.maxPrice && 
             config.allowedClasses.includes(flight.cabinClass);
    });
  }

  private validateFlightDistribution(groupedFlights: Record<string, Flight[]>) {
    const counts = {
      budget: groupedFlights.budget?.length || 0,
      medium: groupedFlights.medium?.length || 0,
      premium: groupedFlights.premium?.length || 0
    };

    // Ensure we have at least some budget options
    if (counts.budget === 0) {
      logger.warn('No budget flights found, retrying with relaxed price constraints');
      return this.searchWithRelaxedConstraints();
    }

    // Aim for reasonable distribution
    const total = counts.budget + counts.medium + counts.premium;
    const budgetPercentage = (counts.budget / total) * 100;

    if (budgetPercentage < 20) {
      logger.warn('Insufficient budget flight options', { 
        distribution: counts,
        budgetPercentage 
      });
      return this.searchWithRelaxedConstraints();
    }

    return groupedFlights;
  }

  private async searchWithRelaxedConstraints(): Promise<Record<string, Flight[]>> {
    // Implement relaxed search logic here
    // For example, increase price thresholds or expand date range
    return {};
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        try {
          await request();
        } catch (error) {
          logger.error('Error processing flight request:', error);
        }
        await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY));
      }
    }

    this.isProcessing = false;
  }
} 