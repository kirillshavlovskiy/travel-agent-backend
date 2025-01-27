import fetch from 'node-fetch';
const SYSTEM_MESSAGE = `You are an AI travel budget expert. Your role is to:
1. Provide accurate cost estimates for travel expenses
2. Consider seasonality, location, and number of travelers
3. Always return responses in valid JSON format
4. Include min and max ranges for each price tier
5. Provide brief descriptions explaining the estimates
6. Consider local market conditions and currency
7. Base estimates on real-world data and current market rates`;
export class VacationBudgetAgent {
    async fetchWithRetry(url, options, retries = 3) {
        let lastError;
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, options);
                return response;
            }
            catch (error) {
                lastError = error;
                await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
            }
        }
        throw lastError || new Error('Failed to fetch after retries');
    }
    generateFlightSearchUrl(flight) {
        try {
            const [from, to] = (flight.route || '').split(' to ').map((s) => s.trim());
            if (!from || !to)
                return '';
            const fromCode = from.match(/\(([A-Z]{3})\)/) ? from.match(/\(([A-Z]{3})\)/)?.[1] : from;
            const toCode = to.match(/\(([A-Z]{3})\)/) ? to.match(/\(([A-Z]{3})\)/)?.[1] : to;
            const outDate = new Date(flight.outbound).toISOString().split('T')[0];
            const inDate = new Date(flight.inbound).toISOString().split('T')[0];
            return `https://www.kayak.com/flights/${fromCode}-${toCode}/${outDate}/${inDate}`;
        }
        catch (error) {
            console.error('[Flight URL] Error generating flight URL:', error);
            return '';
        }
    }
    generateHotelSearchUrl(hotel) {
        try {
            const hotelName = encodeURIComponent(hotel.name);
            const location = encodeURIComponent(hotel.location);
            return `https://www.booking.com/search.html?ss=${hotelName}+${location}`;
        }
        catch {
            return '';
        }
    }
    async queryPerplexity(prompt, category) {
        try {
            const startTime = Date.now();
            console.log(`[${category.toUpperCase()}] Making Perplexity API request`);
            const response = await this.fetchWithRetry('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'llama-3.1-sonar-small-128k-online',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a travel expert who searches real booking websites to find current activities and prices. Always verify information from official sources.

CRITICAL JSON FORMATTING RULES:
1. Return ONLY a valid JSON object
2. Do NOT include any text before or after the JSON
3. Do NOT use markdown formatting or code blocks
4. Use ONLY double quotes for strings and property names
5. Do NOT use single quotes anywhere
6. Do NOT include any comments
7. Do NOT include any trailing commas
8. Ensure all strings are properly escaped
9. Ensure all arrays and objects are properly closed
10. All numbers must be valid JSON numbers (no ranges like "35-40", use average value instead)
11. All dates must be valid ISO strings
12. All URLs must be valid and properly escaped
13. All property names must be double-quoted
14. Do NOT escape quotes in the response
15. For price ranges, use the average value (e.g., for "35-40", use 37.5)`
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    options: {
                        search: true,
                        system_prompt: "You are a travel expert who searches real booking websites to find current activities and prices. Always verify information from official sources.",
                        temperature: 0.1,
                        max_tokens: 4000
                    }
                })
            }, 3);
            if (!response.ok) {
                throw new Error(`Perplexity API request failed: ${response.status} ${response.statusText}`);
            }
            const result = await response.json();
            if (!result.choices?.[0]?.message?.content) {
                throw new Error('Invalid response from Perplexity API');
            }
            const content = result.choices[0].message.content;
            console.log(`[${category.toUpperCase()}] Raw Perplexity API response:`, content);
            try {
                // Enhanced JSON cleaning
                let cleanContent = content;
                // Step 1: Remove markdown code blocks and any text before/after JSON
                cleanContent = cleanContent.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1');
                cleanContent = cleanContent.replace(/^[^{]*({[\s\S]*})[^}]*$/, '$1');
                console.log(`[${category.toUpperCase()}] After removing markdown:`, cleanContent);
                // Step 2: Handle price ranges by converting to average
                cleanContent = cleanContent.replace(/(\d+)-(\d+)/g, (_, min, max) => {
                    const average = (parseInt(min) + parseInt(max)) / 2;
                    return average.toString();
                });
                console.log(`[${category.toUpperCase()}] After handling price ranges:`, cleanContent);
                // Step 3: Fix quotes and escape characters
                cleanContent = cleanContent
                    .replace(/[\u2018\u2019]/g, "'") // Replace smart quotes
                    .replace(/[\u201C\u201D]/g, '"') // Replace smart double quotes
                    .replace(/\\'/g, "'") // Fix escaped single quotes
                    .replace(/:\s*'([^']*?)'/g, ':"$1"') // Convert single-quoted values to double-quoted
                    .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Ensure property names are quoted
                    .replace(/\\/g, '\\\\') // Properly escape backslashes
                    .replace(/\n/g, ' ') // Remove newlines
                    .replace(/€/g, '') // Remove euro symbol
                    .replace(/\s+/g, ' '); // Normalize whitespace
                console.log(`[${category.toUpperCase()}] After fixing quotes:`, cleanContent);
                // Step 4: Remove trailing commas and fix arrays/objects
                cleanContent = cleanContent
                    .replace(/,(\s*[}\]])/g, '$1')
                    .replace(/\}\s*,\s*\}/g, '}}')
                    .replace(/\]\s*,\s*\]/g, ']]')
                    .replace(/\}\s*,\s*\]/g, '}]')
                    .replace(/,\s*,/g, ',') // Remove duplicate commas
                    .replace(/\[\s*,/g, '[') // Remove leading commas in arrays
                    .replace(/,\s*\]/g, ']'); // Remove trailing commas in arrays
                console.log(`[${category.toUpperCase()}] After fixing commas:`, cleanContent);
                // Step 5: Fix any remaining issues
                cleanContent = cleanContent
                    .replace(/\\\\/g, '\\')
                    .replace(/\s+/g, ' ')
                    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // Fix double-quoted property names
                    .replace(/:\s*"([^"]*?)"/g, (_match, p1) => {
                    // Escape special characters in string values
                    const escapeMap = {
                        '"': '\\"',
                        '\\': '\\\\',
                        '\n': '\\n',
                        '\r': '\\r',
                        '\t': '\\t'
                    };
                    return `:"${p1.replace(/["\\\n\r\t]/g, (char) => escapeMap[char] || char)}"`;
                })
                    .trim();
                console.log(`[${category.toUpperCase()}] Final cleaned content:`, cleanContent);
                // Attempt to parse the cleaned JSON
                try {
                    const parsedData = JSON.parse(cleanContent);
                    console.log(`[${category.toUpperCase()}] Successfully parsed JSON:`, parsedData);
                    return parsedData;
                }
                catch (parseError) {
                    const positionMatch = parseError instanceof SyntaxError ?
                        parseError.message.match(/position (\d+)/) : null;
                    const position = positionMatch?.[1] ? parseInt(positionMatch[1]) : -1;
                    console.error(`[${category.toUpperCase()}] JSON parse error:`, {
                        error: parseError instanceof Error ? parseError.message : 'Unknown error',
                        position: position >= 0 ? position : 'unknown',
                        content: cleanContent,
                        contentLength: cleanContent.length,
                        contentSubstring: position >= 0
                            ? cleanContent.substring(Math.max(0, position - 50), Math.min(cleanContent.length, position + 50))
                            : 'unknown'
                    });
                    // Try one more time with a more aggressive cleaning
                    const lastAttempt = cleanContent
                        .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
                        .replace(/\s+/g, ' ') // Normalize whitespace
                        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // Ensure property names are quoted
                        .replace(/:\s*'([^']*?)'/g, ':"$1"') // Convert remaining single quotes to double quotes
                        .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
                        .replace(/\}\s*,\s*\}/g, '}}') // Fix object separators
                        .replace(/\]\s*,\s*\]/g, ']]') // Fix array separators
                        .replace(/\}\s*,\s*\]/g, '}]') // Fix mixed separators
                        .replace(/[^{}[\]"':,.\w\s-]/g, '') // Remove any other non-JSON characters
                        .trim();
                    console.log(`[${category.toUpperCase()}] Last attempt content:`, lastAttempt);
                    return JSON.parse(lastAttempt);
                }
            }
            catch (error) {
                console.error(`[${category.toUpperCase()}] Error processing Perplexity response:`, error);
                throw new Error(`Failed to process ${category} response: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        catch (error) {
            console.error(`[${category.toUpperCase()}] Perplexity API error:`, error);
            throw error;
        }
    }
    getDefaultCategoryData(category) {
        const defaultTier = {
            min: 0,
            max: 0,
            average: 0,
            confidence: 0,
            source: 'Default due to API error',
            references: []
        };
        switch (category) {
            case 'flights':
                return {
                    flights: {
                        budget: defaultTier,
                        medium: defaultTier,
                        premium: defaultTier
                    }
                };
            case 'hotels':
                return {
                    hotels: {
                        searchDetails: {
                            location: '',
                            dates: {
                                checkIn: '',
                                checkOut: ''
                            },
                            guests: 0
                        },
                        budget: defaultTier,
                        medium: defaultTier,
                        premium: defaultTier
                    }
                };
            case 'activities':
                return {
                    activities: {
                        budget: defaultTier,
                        medium: defaultTier,
                        premium: defaultTier
                    }
                };
            case 'localTransportation':
                return {
                    localTransportation: {
                        budget: defaultTier,
                        medium: defaultTier,
                        premium: defaultTier
                    }
                };
            case 'food':
                return {
                    food: {
                        budget: defaultTier,
                        medium: defaultTier,
                        premium: defaultTier
                    }
                };
            default:
                return {
                    food: {
                        budget: defaultTier,
                        medium: defaultTier,
                        premium: defaultTier
                    }
                };
        }
    }
    async handleTravelRequest(request) {
        try {
            const startTime = Date.now();
            console.log('[TIMING] Starting budget calculation');
            const formattedRequest = {
                ...request,
                departureLocation: {
                    ...request.departureLocation,
                    name: request.departureLocation.label
                }
            };
            // Determine which categories to process with Perplexity
            const categories = request.flightData ?
                ['localTransportation', 'food', 'activities'] : // Skip flights if we have Amadeus data
                ['flights', 'localTransportation', 'food', 'activities'];
            console.log(`[TIMING] Processing ${categories.length} categories in parallel`);
            const results = await Promise.all(categories.map(async (category) => {
                const categoryStart = Date.now();
                console.log(`[TIMING][${category}] Starting category processing`);
                const prompt = this.constructPrompt(category, formattedRequest);
                console.log(`[TIMING][${category}] Prompt constructed in ${Date.now() - categoryStart}ms`);
                const data = await this.queryPerplexity(prompt, category);
                console.log(`[TIMING][${category}] Perplexity query completed in ${Date.now() - categoryStart}ms`);
                return { category, data };
            }));
            console.log(`[TIMING] All categories processed in ${Date.now() - startTime}ms`);
            // Create the response object with request details
            const response = {
                requestDetails: {
                    departureLocation: formattedRequest.departureLocation,
                    destinations: formattedRequest.destinations,
                    travelers: formattedRequest.travelers,
                    startDate: formattedRequest.startDate,
                    endDate: formattedRequest.endDate,
                    currency: formattedRequest.currency
                }
            };
            // Add category data to the response
            results.forEach(({ category, data }) => {
                response[category] = data[category];
            });
            // If we have Amadeus flight data, use it instead of Perplexity data
            if (request.flightData && request.flightData.length > 0) {
                // Group flights by tier
                const groupedFlights = request.flightData.reduce((acc, flight) => {
                    const tier = this.determineFlightTier(flight);
                    if (!acc[tier]) {
                        acc[tier] = {
                            min: Infinity,
                            max: -Infinity,
                            average: 0,
                            confidence: 0.9, // Higher confidence for real data
                            source: 'Amadeus',
                            references: []
                        };
                    }
                    const price = parseFloat(flight.price.total);
                    acc[tier].min = Math.min(acc[tier].min, price);
                    acc[tier].max = Math.max(acc[tier].max, price);
                    acc[tier].references.push(this.transformAmadeusFlight(flight));
                    return acc;
                }, {});
                // Calculate averages
                Object.keys(groupedFlights).forEach(tier => {
                    const refs = groupedFlights[tier].references;
                    groupedFlights[tier].average =
                        refs.reduce((sum, ref) => sum + ref.price, 0) / refs.length;
                });
                response.flights = {
                    budget: groupedFlights.budget || this.getDefaultCategoryData('flights').flights.budget,
                    medium: groupedFlights.medium || this.getDefaultCategoryData('flights').flights.medium,
                    premium: groupedFlights.premium || this.getDefaultCategoryData('flights').flights.premium
                };
            }
            const totalTime = Date.now() - startTime;
            console.log(`[TIMING] Total budget calculation completed in ${totalTime}ms`);
            if (totalTime > 25000) {
                console.warn(`[TIMING] Warning: Budget calculation took longer than 25 seconds`);
            }
            return response;
        }
        catch (error) {
            console.error('[VacationBudgetAgent] Error:', error);
            throw error;
        }
    }
    determineFlightTier(flight) {
        const cabinClass = flight.travelerPricings[0].fareDetailsBySegment[0].cabin;
        const price = parseFloat(flight.price.total);
        if (cabinClass === 'FIRST' || cabinClass === 'BUSINESS') {
            return 'premium';
        }
        else if (cabinClass === 'PREMIUM_ECONOMY') {
            return 'medium';
        }
        else if (price <= 1000) {
            return 'budget';
        }
        else if (price <= 2000) {
            return 'medium';
        }
        else {
            return 'premium';
        }
    }
    transformAmadeusFlight(flight) {
        const firstSegment = flight.itineraries[0].segments[0];
        const lastOutboundSegment = flight.itineraries[0].segments[flight.itineraries[0].segments.length - 1];
        const inboundSegments = flight.itineraries[1]?.segments || [];
        const lastInboundSegment = inboundSegments[inboundSegments.length - 1];
        // Calculate total duration in minutes
        const totalDurationMinutes = flight.itineraries[0].segments.reduce((total, segment) => {
            const durationStr = segment.duration || '0';
            const minutes = parseInt(durationStr.replace(/[^0-9]/g, ''), 10) || 0;
            return total + minutes;
        }, 0);
        // Format duration as "X hours Y minutes"
        const hours = Math.floor(totalDurationMinutes / 60);
        const minutes = totalDurationMinutes % 60;
        const formattedDuration = `${hours}h ${minutes}m`;
        return {
            airline: flight.validatingAirlineCodes[0],
            route: `${firstSegment.departure.iataCode} to ${lastOutboundSegment.arrival.iataCode}`,
            price: parseFloat(flight.price.total),
            outbound: firstSegment.departure.at,
            inbound: lastInboundSegment?.arrival.at || lastOutboundSegment.arrival.at,
            duration: formattedDuration,
            layovers: flight.itineraries[0].segments.length - 1,
            flightNumber: `${firstSegment.carrierCode}${firstSegment.number}`,
            tier: this.determineFlightTier(flight),
            referenceUrl: this.generateFlightSearchUrl({
                route: `${firstSegment.departure.iataCode} to ${lastOutboundSegment.arrival.iataCode}`,
                outbound: firstSegment.departure.at,
                inbound: lastInboundSegment?.arrival.at || lastOutboundSegment.arrival.at
            })
        };
    }
    constructPrompt(category, params) {
        switch (category) {
            case 'flights':
                return `Search for current flight prices from ${params.departureLocation?.label} to ${params.country}.
        Return a JSON object with flight estimates.
        
        Consider these details:
        - Departure: ${params.departureLocation?.label}
        - Destination: ${params.country}
        - Type: ${params.departureLocation?.isRoundTrip ? 'round-trip' : 'one-way'} flight
        - Outbound Date: ${params.departureLocation?.outboundDate}
        - Inbound Date: ${params.departureLocation?.inboundDate}
        - Travelers: ${params.travelers}
        - Currency: ${params.currency}

        Use this exact JSON structure:
        {
          "flights": {
            "budget": {
              "min": number (lowest price in this tier),
              "max": number (highest price in this tier),
              "average": number (average price in this tier),
              "confidence": number (between 0 and 1),
              "source": "string (data source)",
              "references": [
                {
                  "airline": "string (airline name)",
                  "route": "string (e.g., 'LAX to CDG')",
                  "price": number (exact price),
                  "outbound": "string (ISO date, e.g., '2024-12-26T10:00:00Z')",
                  "inbound": "string (ISO date, e.g., '2024-12-31T15:00:00Z')",
                  "duration": "string (e.g., '10 hours')",
                  "layovers": number (0 for direct flights),
                  "flightNumber": "string (e.g., 'AA123')",
                  "tier": "string (budget, medium, or premium)",
                  "referenceUrl": "string (booking URL)"
                }
              ]
            },
            "medium": { same structure as budget },
            "premium": { same structure as budget }
          }
        }

        IMPORTANT FORMATTING RULES:
        1. All fields are required - do not omit any fields
        2. Dates must be in ISO format with timezone (e.g., "2024-12-26T10:00:00Z")
        3. Price must be a number (not a string or range)
        4. Layovers must be a number (0 for direct flights)
        5. Each tier must have at least 2 flight references
        6. Flight numbers should be in standard format (e.g., "AA123", "UA456")
        7. Include actual booking URLs from major travel sites (Kayak, Google Flights, Skyscanner)
        8. Ensure all prices are in ${params.currency}
        9. Route should be in format "AIRPORT_CODE to AIRPORT_CODE" (e.g., "LAX to CDG")
        10. Do not include any explanatory text, only return the JSON object
        11. Do not use single quotes, only double quotes
        12. Do not include any trailing commas
        13. Ensure all URLs are properly formatted and complete
        14. Do not wrap the response in markdown code blocks
        15. Return ONLY the JSON object, no additional text`;
            case 'hotels':
                return `Find accommodation options in ${params.country} for ${params.travelers} travelers.
        Stay details:
        - Location: ${params.country}
        - Check-in: ${params.departureLocation.outboundDate}
        - Check-out: ${params.departureLocation.inboundDate}
        - Guests: ${params.travelers}
        ${params.budget ? `- Budget: ${params.budget} ${params.currency}` : ''}

        Return a valid JSON object with this EXACT structure:
        {
          "hotels": {
            "searchDetails": {
              "location": "${params.country}",
              "dates": {
                "checkIn": "${params.departureLocation.outboundDate}",
                "checkOut": "${params.departureLocation.inboundDate}"
              },
              "guests": ${params.travelers}
            },
            "budget": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [
                {
                  "name": "string",
                  "location": "string",
                  "price": number,
                  "type": "string",
                  "amenities": "string",
                  "rating": number,
                  "reviewScore": number,
                  "reviewCount": number,
                  "images": ["string"],
                  "referenceUrl": "string",
                  "coordinates": {
                    "latitude": number,
                    "longitude": number
                  },
                  "features": ["string"],
                  "policies": {
                    "checkIn": "string",
                    "checkOut": "string",
                    "cancellation": "string"
                  }
                }
              ]
            },
            "medium": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [/* same structure as budget references */]
            },
            "premium": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [/* same structure as budget references */]
            }
          }
        }

        IMPORTANT RULES:
        1. Use ONLY double quotes for all strings and property names
        2. Do NOT use single quotes anywhere
        3. Do NOT include any trailing commas
        4. All prices must be numbers (no currency symbols or commas)
        5. All coordinates must be valid numbers
        6. All arrays must be properly closed
        7. All objects must be properly closed
        8. Include at least 2 references per tier
        9. All prices must be in ${params.currency}
        10. All URLs must be valid and properly escaped
        11. Return ONLY the JSON object, no additional text`;
            case 'localTransportation':
                return `Analyze local transportation options in ${params.country} for ${params.travelers} travelers.
        Details:
        - Location: ${params.country}
        - Duration: ${params.departureLocation.outboundDate} to ${params.departureLocation.inboundDate}
        - Travelers: ${params.travelers}
        ${params.budget ? `- Budget: ${params.budget} ${params.currency}` : ''}

        Include:
        - Public transportation (buses, trains, metro)
        - Taxis and ride-sharing
        - Car rentals
        - Airport transfers

        Provide a detailed JSON response with:
        {
          "localTransportation": {
            "budget": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [
                {
                  "type": "string",
                  "description": "string",
                  "price": number,
                  "unit": "string"
                }
              ]
            },
            "medium": { same structure },
            "premium": { same structure }
          }
        }`;
            case 'food':
                return `Estimate daily food costs in ${params.country} for ${params.travelers} travelers.
        Details:
        - Location: ${params.country}
        - Duration: ${params.departureLocation.outboundDate} to ${params.departureLocation.inboundDate}
        - Travelers: ${params.travelers}
        ${params.budget ? `- Budget: ${params.budget} ${params.currency}` : ''}

        Include:
        - Local restaurants
        - Cafes and street food
        - Grocery stores
        - Fine dining

        Provide a detailed JSON response with:
        {
          "food": {
            "budget": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [
                {
                  "type": "string",
                  "description": "string",
                  "price": number,
                  "mealType": "string"
                }
              ]
            },
            "medium": { same structure },
            "premium": { same structure }
          }
        }`;
            case 'activities':
                return `Research tourist activities and attractions in ${params.country} for ${params.travelers} travelers.
        Details:
        - Location: ${params.country}
        - Duration: ${params.departureLocation.outboundDate} to ${params.departureLocation.inboundDate}
        - Travelers: ${params.travelers}
        ${params.budget ? `- Budget: ${params.budget} ${params.currency}` : ''}

        Include:
        - Tourist attractions
        - Guided tours
        - Cultural experiences
        - Entertainment
        - Adventure activities

        Provide a detailed JSON response with:
        {
          "activities": {
            "budget": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [
                {
                  "name": "string",
                  "description": "string",
                  "price": number,
                  "duration": "string"
                }
              ]
            },
            "medium": { same structure },
            "premium": { same structure }
          }
        }`;
            default:
                throw new Error(`Invalid category: ${category}`);
        }
    }
    constructHotelPrompt(request) {
        const destination = request.destinations[0].label;
        const checkIn = request.startDate;
        const checkOut = request.endDate;
        const travelers = request.travelers;
        const budget = request.budget;
        let prompt = `Provide detailed hotel recommendations in ${destination} for ${travelers} travelers, checking in on ${checkIn} and checking out on ${checkOut}.`;
        if (budget) {
            prompt += `\nConsider total budget of ${budget} USD when suggesting options.`;
        }
        prompt += `\n\nIMPORTANT RULES:
1. Prioritize hotels with direct booking websites
2. All URLs must be complete and include check-in/out dates when possible
3. All images must be from official hotel sources
4. Prices must reflect actual rates for the specified dates
5. Only include hotels that can be booked online
6. Verify that all links and images are accessible
7. Include major hotel chains when available in each tier`;
        return prompt;
    }
    cleanJsonResponse(response) {
        try {
            // Remove markdown code block markers and any text before/after them
            let cleaned = response.replace(/^[\s\S]*?```(?:json)?\s*|\s*```[\s\S]*$/g, '');
            // Find the first '{' and last '}'
            const startIndex = cleaned.indexOf('{');
            const endIndex = cleaned.lastIndexOf('}');
            if (startIndex === -1 || endIndex === -1) {
                throw new Error('No valid JSON object found in response');
            }
            // Extract just the JSON object
            cleaned = cleaned.substring(startIndex, endIndex + 1);
            // Additional cleaning steps
            cleaned = cleaned
                .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
                .replace(/\\[rnt]/g, '') // Remove escaped whitespace
                .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
                .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // Ensure property names are quoted
                .replace(/:\s*'([^']*?)'/g, ':"$1"') // Convert single quotes to double quotes
                .replace(/\}\s*,\s*\}/g, '}}') // Fix object separators
                .replace(/\]\s*,\s*\]/g, ']]') // Fix array separators
                .replace(/\}\s*,\s*\]/g, '}]') // Fix mixed separators
                .trim();
            return cleaned;
        }
        catch (error) {
            console.error('[Clean JSON] Error:', error);
            throw new Error('Failed to clean JSON response');
        }
    }
    async querySingleActivity(prompt) {
        try {
            const response = await this.fetchWithRetry('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'llama-3.1-sonar-small-128k-online',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a travel expert who searches real booking websites to find current activities and prices. Always verify information from official sources.

CRITICAL JSON FORMATTING RULES:
1. Return ONLY a valid JSON object
2. Do NOT include any text before or after the JSON
3. Do NOT use markdown formatting or code blocks
4. Use ONLY double quotes for strings and property names
5. Do NOT use single quotes anywhere
6. Do NOT include any comments
7. Do NOT include any trailing commas
8. Ensure all strings are properly escaped
9. Ensure all arrays and objects are properly closed
10. All numbers must be valid JSON numbers (no ranges like "35-40", use average value instead)
11. All dates must be valid ISO strings
12. All URLs must be valid and properly escaped
13. All property names must be double-quoted
14. Do NOT escape quotes in the response
15. For price ranges, use the average value (e.g., for "35-40", use 37.5)`
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    options: {
                        search: true,
                        system_prompt: "You are a travel expert who searches real booking websites to find current activities and prices. Always verify information from official sources.",
                        temperature: 0.1,
                        max_tokens: 4000
                    }
                })
            }, 3);
            if (!response.ok) {
                throw new Error(`Perplexity API request failed: ${response.status} ${response.statusText}`);
            }
            const result = await response.json();
            if (!result.choices?.[0]?.message?.content) {
                throw new Error('Invalid response from Perplexity API');
            }
            return result.choices[0].message.content;
        }
        catch (error) {
            console.error('[Single Activity] Perplexity API error:', error);
            throw error;
        }
    }
    async generateSingleActivity(params) {
        const prompt = `Generate a single activity recommendation for ${params.destination} during ${params.timeOfDay} on day ${params.dayNumber} with a budget of ${params.budget} ${params.currency}. The response should be a valid JSON object with the following structure:
    {
      "name": "Activity name",
      "description": "Detailed description",
      "duration": "Duration in hours (number)",
      "price": "Price in ${params.currency} (number)",
      "category": "Category (e.g., Cultural, Adventure, Relaxation)",
      "location": "Specific location in ${params.destination}",
      "rating": "Rating out of 5 (number)",
      "timeOfDay": "${params.timeOfDay}",
      "referenceUrl": "Optional booking URL",
      "provider": "Activity provider name",
      "highlights": ["Array of key highlights"]
    }`;
        try {
            const response = await this.querySingleActivity(prompt);
            const cleanedResponse = this.cleanJsonResponse(response);
            return JSON.parse(cleanedResponse);
        }
        catch (error) {
            console.error('[Activity Generation] Error:', error);
            throw new Error('Failed to generate activity recommendation');
        }
    }
}
//# sourceMappingURL=agents.js.map