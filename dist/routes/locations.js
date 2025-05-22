import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { AmadeusService } from '../services/amadeus';
const router = Router();
const amadeusService = new AmadeusService();
// Define supported locations with their details
const supportedLocations = [
    {
        id: 'amsterdam',
        name: 'Amsterdam',
        country: 'Netherlands',
        displayName: 'Amsterdam, Netherlands',
        coordinates: {
            latitude: 52.3676,
            longitude: 4.9041
        },
        airports: ['AMS'],
        timezone: 'Europe/Amsterdam',
        currency: 'EUR',
        languages: ['Dutch', 'English'],
        popularSeasons: {
            high: ['Jun', 'Jul', 'Aug'],
            shoulder: ['Apr', 'May', 'Sep', 'Oct'],
            low: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar']
        }
    },
    {
        id: 'paris',
        name: 'Paris',
        country: 'France',
        displayName: 'Paris, France',
        coordinates: {
            latitude: 48.8566,
            longitude: 2.3522
        },
        airports: ['CDG', 'ORY'],
        timezone: 'Europe/Paris',
        currency: 'EUR',
        languages: ['French', 'English'],
        popularSeasons: {
            high: ['Jun', 'Jul', 'Aug', 'Sep'],
            shoulder: ['Apr', 'May', 'Oct'],
            low: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar']
        }
    },
    {
        id: 'london',
        name: 'London',
        country: 'United Kingdom',
        displayName: 'London, United Kingdom',
        coordinates: {
            latitude: 51.5074,
            longitude: -0.1278
        },
        airports: ['LHR', 'LGW', 'STN', 'LTN', 'LCY'],
        timezone: 'Europe/London',
        currency: 'GBP',
        languages: ['English'],
        popularSeasons: {
            high: ['Jun', 'Jul', 'Aug'],
            shoulder: ['Apr', 'May', 'Sep', 'Oct'],
            low: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar']
        }
    }
];
// Get all supported locations
router.get('/', async (req, res) => {
    try {
        logger.info('Fetching all supported locations');
        // Try to get some default locations from Amadeus
        try {
            const defaultCities = ['Paris', 'London', 'New York', 'Tokyo', 'Dubai'];
            const locations = [];
            for (const city of defaultCities) {
                try {
                    const cityLocations = await amadeusService.searchLocations(city);
                    if (cityLocations.length > 0) {
                        locations.push(cityLocations[0]);
                    }
                }
                catch (cityError) {
                    logger.warn(`Failed to fetch location for ${city}`, {
                        error: cityError instanceof Error ? cityError.message : 'Unknown error'
                    });
                }
            }
            if (locations.length > 0) {
                logger.info('Successfully fetched default locations', { count: locations.length });
                return res.json({
                    success: true,
                    data: locations,
                    count: locations.length
                });
            }
        }
        catch (amadeusError) {
            logger.error('Failed to fetch locations from Amadeus', {
                error: amadeusError instanceof Error ? amadeusError.message : 'Unknown error'
            });
        }
        // Fallback to static locations if Amadeus fails
        logger.info('Using fallback static locations', { count: supportedLocations.length });
        return res.json({
            success: true,
            data: supportedLocations,
            count: supportedLocations.length
        });
    }
    catch (error) {
        logger.error('Error fetching locations', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch locations'
        });
    }
});
// Search locations by query
router.get('/search', async (req, res) => {
    try {
        const { keyword } = req.query;
        if (!keyword || typeof keyword !== 'string') {
            logger.warn('Invalid or missing keyword parameter', { keyword });
            return res.status(400).json({
                success: false,
                error: 'Missing or invalid keyword parameter'
            });
        }
        logger.info('Searching locations', { keyword });
        try {
            const locations = await amadeusService.searchLocations(keyword);
            logger.info('Successfully retrieved locations', {
                count: locations.length,
                keyword
            });
            return res.json({
                success: true,
                data: locations,
                count: locations.length
            });
        }
        catch (amadeusError) {
            logger.error('Amadeus API error', {
                error: amadeusError instanceof Error ? amadeusError.message : 'Unknown error',
                stack: amadeusError instanceof Error ? amadeusError.stack : undefined,
                keyword
            });
            // If no locations found, return empty array instead of error
            if (amadeusError instanceof Error && amadeusError.message.includes('No location found')) {
                return res.json({
                    success: true,
                    data: [],
                    count: 0
                });
            }
            throw amadeusError;
        }
    }
    catch (error) {
        logger.error('Error searching locations', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        return res.status(500).json({
            success: false,
            error: 'Failed to search locations'
        });
    }
});
// Get location by ID
router.get('/:id', (req, res) => {
    const { id } = req.params;
    logger.info('Fetching location by ID', { id });
    const location = supportedLocations.find(loc => loc.id === id);
    if (!location) {
        logger.warn('Location not found', { id });
        return res.status(404).json({
            success: false,
            error: 'Location not found'
        });
    }
    res.json({
        success: true,
        data: location
    });
});
// Endpoint to get city names for airport codes
router.get('/airport-city-names', async (req, res) => {
    try {
        const { codes } = req.query;
        if (!codes) {
            return res.status(400).json({
                success: false,
                error: 'Missing airport codes'
            });
        }
        // Handle both comma-separated string and array formats
        const airportCodes = Array.isArray(codes)
            ? codes
            : (typeof codes === 'string' ? codes.split(',') : []);
        if (airportCodes.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid airport codes provided'
            });
        }
        // Clean up the codes (trim whitespace, convert to uppercase)
        const cleanedCodes = airportCodes
            .map(code => typeof code === 'string' ? code.trim().toUpperCase() : '')
            .filter(code => code.length >= 3);
        logger.info('Airport city names requested', {
            originalCodes: airportCodes,
            cleanedCodes,
            count: cleanedCodes.length
        });
        const cityNames = await amadeusService.getAirportCityNames(cleanedCodes);
        return res.json({
            success: true,
            data: cityNames
        });
    }
    catch (error) {
        logger.error('Error retrieving airport city names', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        return res.status(500).json({
            success: false,
            error: 'Failed to retrieve airport city names'
        });
    }
});
export default router;
