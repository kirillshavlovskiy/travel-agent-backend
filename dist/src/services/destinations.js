import { PrismaClient } from '@prisma/client';
import { ViatorService } from './viator.js';
import { AmadeusService } from './amadeus.js';
import { logger } from '../utils/logger.js';
const prisma = new PrismaClient();
export class DestinationsService {
    constructor() {
        this.lastUpdateTime = null;
        this.UPDATE_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
        this.viatorService = new ViatorService();
        this.amadeusService = new AmadeusService();
    }
    static getInstance() {
        if (!DestinationsService.instance) {
            DestinationsService.instance = new DestinationsService();
        }
        return DestinationsService.instance;
    }
    async shouldUpdate() {
        if (!this.lastUpdateTime) {
            const lastDestination = await prisma.destination.findFirst({
                orderBy: { lastUpdated: 'desc' }
            });
            this.lastUpdateTime = lastDestination?.lastUpdated || new Date(0);
        }
        return Date.now() - this.lastUpdateTime.getTime() > this.UPDATE_INTERVAL;
    }
    async fetchViatorDestinations() {
        try {
            const viatorDestinations = await this.viatorService.getDestinations();
            return viatorDestinations.map(dest => ({
                code: dest.destinationId,
                label: `${dest.name}, ${dest.country || ''}`.trim(),
                country: dest.country,
                lastUpdated: new Date(),
                source: 'VIATOR'
            }));
        }
        catch (error) {
            logger.error('[Destinations] Error fetching Viator destinations:', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return [];
        }
    }
    async fetchAmadeusDestinations() {
        try {
            const defaultCities = ['Paris', 'London', 'New York', 'Tokyo', 'Dubai', 'Rome', 'Barcelona', 'Singapore'];
            const destinations = [];
            for (const city of defaultCities) {
                try {
                    const locations = await this.amadeusService.searchLocations(city);
                    if (locations.length > 0) {
                        const location = locations[0];
                        destinations.push({
                            code: location.iataCode,
                            label: `${location.name}, ${location.address.countryName}`,
                            cityCode: location.address.cityCode,
                            country: location.address.countryName,
                            lastUpdated: new Date(),
                            source: 'AMADEUS'
                        });
                    }
                }
                catch (error) {
                    logger.warn(`[Destinations] Failed to fetch Amadeus location for ${city}:`, {
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
            }
            return destinations;
        }
        catch (error) {
            logger.error('[Destinations] Error fetching Amadeus destinations:', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return [];
        }
    }
    async updateDestinations() {
        if (!await this.shouldUpdate()) {
            logger.info('[Destinations] Skipping update - not due yet');
            return;
        }
        logger.info('[Destinations] Starting weekly destination update');
        try {
            // Fetch destinations from both services
            const [viatorDestinations, amadeusDestinations] = await Promise.all([
                this.fetchViatorDestinations(),
                this.fetchAmadeusDestinations()
            ]);
            // Combine and deduplicate destinations
            const allDestinations = [...viatorDestinations, ...amadeusDestinations];
            const uniqueDestinations = new Map();
            allDestinations.forEach(dest => {
                const key = dest.code;
                if (!uniqueDestinations.has(key) ||
                    uniqueDestinations.get(key).source === 'STATIC') {
                    uniqueDestinations.set(key, dest);
                }
            });
            // Update database
            await prisma.$transaction(async (tx) => {
                // Clear old destinations
                await tx.destination.deleteMany({});
                // Insert new destinations
                await tx.destination.createMany({
                    data: Array.from(uniqueDestinations.values())
                });
            });
            this.lastUpdateTime = new Date();
            logger.info('[Destinations] Successfully updated destinations', {
                total: uniqueDestinations.size,
                viator: viatorDestinations.length,
                amadeus: amadeusDestinations.length,
                timestamp: this.lastUpdateTime
            });
        }
        catch (error) {
            logger.error('[Destinations] Error updating destinations:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
    async getDestinations() {
        try {
            // Try to update if needed
            await this.updateDestinations();
            // Fetch from database
            const destinations = await prisma.destination.findMany({
                orderBy: { label: 'asc' }
            });
            return destinations;
        }
        catch (error) {
            logger.error('[Destinations] Error getting destinations:', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
}
