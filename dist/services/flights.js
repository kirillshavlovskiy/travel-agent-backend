import { AmadeusService } from './amadeus.js';
import { logger } from '../utils/logger.js';
export class FlightService {
    amadeusService;
    constructor() {
        this.amadeusService = new AmadeusService();
    }
    async searchFlights(params) {
        try {
            logger.info('[FlightService] Searching flights:', params);
            // Create segments array in the format required by AmadeusService
            const segments = [
                {
                    originLocationCode: params.origin,
                    destinationLocationCode: params.destination,
                    departureDate: params.departureDate
                }
            ];
            // Add return segment if returnDate is provided
            if (params.returnDate) {
                segments.push({
                    originLocationCode: params.destination,
                    destinationLocationCode: params.origin,
                    departureDate: params.returnDate
                });
            }
            logger.info('[FlightService] Formatted flight segments:', { segments });
            const flights = await this.amadeusService.searchFlights({
                segments: segments,
                travelClass: params.travelClass || 'ECONOMY',
                adults: params.adults || 1,
                max: 50 // Reasonable default for max results
            });
            return {
                success: true,
                data: flights
            };
        }
        catch (error) {
            logger.error('[FlightService] Error searching flights:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
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
            logger.info('[FlightService] Getting flight details requested for:', { flightId });
            // This is a stub implementation as the method is not available in AmadeusService
            logger.warn('[FlightService] Flight details retrieval not implemented yet');
            return {
                success: false,
                error: 'Flight details retrieval not currently supported'
            };
        }
        catch (error) {
            logger.error('[FlightService] Error in flight details stub:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                flightId
            });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to process flight details request'
            };
        }
    }
}
