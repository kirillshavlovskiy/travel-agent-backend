import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { AmadeusService } from '../services/amadeus.js';

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

// Common airport code to city name mapping
const airportCityMapping = {
  // North America
  'JFK': 'New York',
  'LGA': 'New York',
  'EWR': 'Newark',
  'LAX': 'Los Angeles',
  'SFO': 'San Francisco',
  'ORD': 'Chicago',
  'ATL': 'Atlanta',
  'DFW': 'Dallas',
  'MIA': 'Miami',
  'YYZ': 'Toronto',
  'YUL': 'Montreal',
  'MEX': 'Mexico City',
  
  // Europe
  'LHR': 'London',
  'LGW': 'London',
  'CDG': 'Paris',
  'ORY': 'Paris',
  'AMS': 'Amsterdam',
  'FRA': 'Frankfurt',
  'MAD': 'Madrid',
  'BCN': 'Barcelona',
  'FCO': 'Rome',
  'MUC': 'Munich',
  'VIE': 'Vienna',
  'ZRH': 'Zurich',
  'BRU': 'Brussels',
  'CPH': 'Copenhagen',
  'ARN': 'Stockholm',
  'OSL': 'Oslo',
  
  // Asia & Middle East
  'HND': 'Tokyo',
  'NRT': 'Tokyo',
  'PEK': 'Beijing',
  'PVG': 'Shanghai',
  'HKG': 'Hong Kong',
  'SIN': 'Singapore',
  'BKK': 'Bangkok',
  'KUL': 'Kuala Lumpur',
  'DEL': 'Delhi',
  'BOM': 'Mumbai',
  'DXB': 'Dubai',
  'DOH': 'Doha',
  
  // Australia & Oceania
  'SYD': 'Sydney',
  'MEL': 'Melbourne',
  'BNE': 'Brisbane',
  'AKL': 'Auckland',
  
  // Africa
  'JNB': 'Johannesburg',
  'CPT': 'Cape Town',
  'CAI': 'Cairo'
};

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
        } catch (cityError) {
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
    } catch (amadeusError) {
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
    
  } catch (error) {
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
    } catch (amadeusError) {
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
  } catch (error) {
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

// New endpoint to get city names from airport codes
router.get('/airport-city-names', async (req, res) => {
  try {
    const { codes } = req.query;
    
    if (!codes) {
      logger.warn('Missing airport codes parameter');
      return res.status(400).json({
        success: false,
        error: 'Missing airport codes parameter'
      });
    }
    
    const airportCodes = String(codes).split(',');
    logger.info('Fetching city names for airport codes', { count: airportCodes.length });
    
    // Create mapping of airport code to city name
    const cityNames = {};
    
    // First pass: check static mappings and supported locations
    const codesForAmadeus = [];
    
    for (const code of airportCodes) {
      // Look up in our predefined mapping first
      if (airportCityMapping[code]) {
        cityNames[code] = airportCityMapping[code];
        continue;
      }
      
      // Try to find in supported locations
      let found = false;
      for (const location of supportedLocations) {
        if (location.airports && location.airports.includes(code)) {
          cityNames[code] = location.name;
          found = true;
          break;
        }
      }
      
      // If not found in static mappings, add to batch for Amadeus lookup
      if (!found) {
        codesForAmadeus.push(code);
        // Initialize with code itself as fallback
        cityNames[code] = code;
      }
    }
    
    // Second pass: batch lookup for Amadeus
    if (codesForAmadeus.length > 0) {
      try {
        logger.info('Performing batch lookup via Amadeus API', { 
          count: codesForAmadeus.length,
          codes: codesForAmadeus.slice(0, 5).join(', ') + (codesForAmadeus.length > 5 ? '...' : '')
        });
        
        // Use the batch lookup method for better performance
        const amadeusCityNames = await amadeusService.getAirportCityNames(codesForAmadeus);
        
        // Update our results with any found city names
        Object.entries(amadeusCityNames).forEach(([code, cityName]) => {
          if (cityName) {
            cityNames[code] = cityName;
          }
        });
        
        logger.info('Batch lookup results', {
          requested: codesForAmadeus.length,
          found: Object.keys(amadeusCityNames).length
        });
      } catch (error) {
        logger.error('Error in batch lookup via Amadeus API', {
          error: error instanceof Error ? error.message : 'Unknown error',
          codesCount: codesForAmadeus.length
        });
        // We'll keep the fallback values for any codes that couldn't be looked up
      }
    }
    
    logger.info('Successfully mapped airport codes to city names', {
      requestedCount: airportCodes.length,
      mappedCount: Object.keys(cityNames).length
    });
    
    return res.json({
      success: true,
      data: cityNames
    });
    
  } catch (error) {
    logger.error('Error fetching airport city names', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch airport city names'
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

export default router; 