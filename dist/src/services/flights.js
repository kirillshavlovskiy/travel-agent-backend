import { AmadeusService } from './amadeus.js';
import { logger } from '../utils/logger.js';
export class FlightService {
    constructor() {
        this.amadeusService = new AmadeusService();
    }
    async searchFlights(params) {
        try {
            logger.info('[FlightService] Searching flights:', params);
            const flights = await this.amadeusService.searchFlights({
                originLocationCode: params.origin,
                destinationLocationCode: params.destination,
                departureDate: params.departureDate,
                returnDate: params.returnDate,
                adults: params.adults || 1,
                currencyCode: params.currency || 'USD'
            });
            return {
                success: true,
                data: flights
            };
        }
        catch (error) {
            logger.error('[FlightService] Error searching flights:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                params
            });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to search flights'
            };
        }
    }
    async getFlightDetails(flightId) {
        try {
            logger.info('[FlightService] Getting flight details:', { flightId });
            const details = await this.amadeusService.getFlightDetails(flightId);
            return {
                success: true,
                data: details
            };
        }
        catch (error) {
            logger.error('[FlightService] Error getting flight details:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                flightId
            });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get flight details'
            };
        }
    }
}
