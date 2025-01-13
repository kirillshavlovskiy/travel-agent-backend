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
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
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
                cleanContent = cleanContent.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1');
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
                    .replace(/\n/g, ' '); // Remove newlines
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
            const categories = ['flights', 'localTransportation', 'food', 'activities'];
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
        return `Provide detailed hotel recommendations in ${destination} for ${travelers} travelers, checking in on ${checkIn} and checking out on ${checkOut}.
For each price category (budget, medium, premium), provide at least 5 real hotels with:
1. Full hotel name (use real, well-known hotels)
2. Exact location within ${destination}
3. Price per night in USD (realistic market rates)
4. Star rating (out of 5)
5. At least 3-5 key amenities (e.g., "Free WiFi, Pool, Restaurant")
6. Direct booking URL - IMPORTANT:
   - Prefer direct hotel website booking URLs (e.g., hilton.com, marriott.com)
   - Include the specific dates: ${checkIn} to ${checkOut}
   - Include number of guests: ${travelers}
   - Only use Booking.com as a last resort
7. At least 2 high-quality images of the hotel:
   - Exterior view
   - Room or amenity view
   - Must be real images from the hotel's website or official sources

Return in this exact JSON structure:
{
  "hotels": {
    "searchDetails": {
      "location": "${destination}",
      "dates": {
        "checkIn": "${checkIn}",
        "checkOut": "${checkOut}"
      },
      "guests": ${travelers}
    },
    "budget": {
      "min": [minimum price in category],
      "max": [maximum price in category],
      "average": [average price in category],
      "confidence": 0.9,
      "source": "Direct hotel websites and market research",
      "references": [
        {
          "name": "Hotel Name",
          "location": "Exact address",
          "price": 100,
          "rating": 4.5,
          "amenities": ["amenity1", "amenity2", "amenity3"],
          "link": "https://www.hilton.com/...",
          "images": [
            "https://www.hotel-website.com/image1.jpg",
            "https://www.hotel-website.com/image2.jpg"
          ],
          "hotelChain": "Hilton/Marriott/etc or Independent",
          "directBooking": true
        }
      ]
    },
    "medium": { [same structure as budget] },
    "premium": { [same structure as budget] }
  }
}

${budget ? `Consider total budget of ${budget} USD when suggesting options.` : ''}
IMPORTANT RULES:
1. Prioritize hotels with direct booking websites
2. All URLs must be complete and include check-in/out dates when possible
3. All images must be from official hotel sources
4. Prices must reflect actual rates for the specified dates
5. Only include hotels that can be booked online
6. Verify that all links and images are accessible
7. Include major hotel chains when available in each tier`;
    }
    async generateSingleActivity(params) {
        console.log('[VacationBudgetAgent] Generating single activity:', {
            destination: params.destination,
            dayNumber: params.dayNumber,
            timeSlot: params.timeSlot,
            tier: params.tier,
            category: params.category,
            userPreferences: params.userPreferences,
            hasExistingActivities: !!params.existingActivities?.length,
            flightTimes: params.flightTimes
        });
        const prompt = `Search ONLY on GetYourGuide, Viator, or official venue websites to find a real, currently bookable ${params.category || ''} activity in ${params.destination} for ${params.timeSlot} of day ${params.dayNumber}.

CRITICAL PRICE REQUIREMENTS:
You MUST find an activity with an EXACT price that matches the ${params.tier} tier:
- Budget tier: $0-30 per person
- Medium tier: $30-100 per person (MUST BE AT LEAST $30)
- Premium tier: $100-1000 per person (MUST BE AT LEAST $100)

DO NOT return an activity if its price does not EXACTLY match the ${params.tier} tier range.
For ${params.tier} tier, the price MUST be between $${params.tier === 'budget' ? '0-30' : params.tier === 'medium' ? '30-100' : '100-1000'}.

${params.userPreferences ? `The activity should match these preferences: ${params.userPreferences}` : ''}
${params.existingActivities.length > 0 ? `It should not overlap with or be similar to these existing activities: ${params.existingActivities.map(a => a.name).join(', ')}.` : ''}

CRITICAL REQUIREMENTS - ALL MUST BE MET:
1. You MUST search real booking websites (GetYourGuide, Viator, or official venue sites) and provide the EXACT booking URL
2. The price MUST be the current, exact price from the booking site and MUST be within the specified range for ${params.tier} tier
3. The activity MUST be in the "${params.category}" category and match the user preferences
4. All details (name, description, duration, etc.) MUST be copied exactly from the real listing
5. Include the specific meeting point or venue address in ${params.destination}
6. For tours/activities, include the actual tour operator's name from the listing
7. DO NOT make up or generate any details - all information must come from a real, bookable listing
8. DO NOT reuse the user's input text in the response - find a real activity that matches their preferences

Format the response EXACTLY as this JSON object:
{
  "name": "EXACT activity name from booking site",
  "description": "Full description from the listing",
  "duration": "Duration in hours (number only) from listing",
  "price": number,
  "category": "${params.category || 'Any category'}",
  "location": "Exact meeting point/address from listing",
  "rating": "Rating from booking site (number out of 5)",
  "timeOfDay": "${params.timeSlot}",
  "referenceUrl": "REQUIRED - Full direct booking URL",
  "provider": "REQUIRED - Exact tour operator/venue name",
  "highlights": ["Copy", "the", "exact", "highlights", "from", "the", "listing"]
}

IMPORTANT RULES:
1. The price field MUST be a number without any currency symbols or formatting (e.g., 35 not "$35" or "35 USD")
2. The price MUST be within the specified range for ${params.tier} tier (${params.tier === 'budget' ? '$0-30' : params.tier === 'medium' ? '$30-100' : '$100-1000'} per person)
3. If you cannot find a real, bookable activity with an exact price and URL, respond with an error message instead of making up details
4. You MUST verify that the activity exists and is currently bookable
5. You MUST include the exact booking URL from GetYourGuide, Viator, or the official venue website
6. The description and highlights MUST be copied directly from the listing - do not generate or modify them

${params.flightTimes?.arrival && params.dayNumber === 1 ?
            `Note: This is arrival day. Flight arrives at ${new Date(params.flightTimes.arrival).toLocaleTimeString()}. Activity should start at least 2 hours after arrival.` : ''}
${params.flightTimes?.departure ? `Note: Flight departs at ${new Date(params.flightTimes.departure).toLocaleTimeString()}. Activity should end at least 3 hours before departure.` : ''}`;
        try {
            console.log('[VacationBudgetAgent] Calling Perplexity API with prompt...');
            const response = await this.queryPerplexity(prompt, 'single-activity');
            if (!response) {
                throw new Error('Failed to generate activity');
            }
            // Validate category
            if (params.category && (!response.category || response.category.toLowerCase() !== params.category.toLowerCase())) {
                console.warn('[VacationBudgetAgent] Generated activity has wrong category:', {
                    requested: params.category,
                    received: response.category || 'undefined'
                });
                throw new Error(`Generated activity does not match requested category. Requested: ${params.category}, Received: ${response.category || 'undefined'}`);
            }
            // Stricter URL validation
            if (!response.referenceUrl || !response.referenceUrl.startsWith('http')) {
                console.warn('[VacationBudgetAgent] Generated activity missing valid URL:', response.referenceUrl);
                throw new Error('Generated activity must include a valid booking URL starting with http:// or https://');
            }
            // Validate URL domain
            const validDomains = [
                'getyourguide.com',
                'viator.com',
                'tripadvisor.com',
                'expedia.com',
                'booking.com',
                'airbnb.com',
                'opentable.com',
                'resy.com'
            ];
            const url = new URL(response.referenceUrl);
            const isValidDomain = validDomains.some(domain => url.hostname.includes(domain)) ||
                url.hostname.includes(params.destination.toLowerCase()) ||
                url.hostname.endsWith('.com') ||
                url.hostname.endsWith('.net') ||
                url.hostname.endsWith('.org');
            if (!isValidDomain) {
                console.warn('[VacationBudgetAgent] Invalid booking URL domain:', url.hostname);
                throw new Error('Booking URL must be from GetYourGuide, Viator, or an official venue website');
            }
            // Validate that description is not just repeating user preferences
            if (params.userPreferences && response.description.toLowerCase().includes(params.userPreferences.toLowerCase())) {
                console.warn('[VacationBudgetAgent] Description appears to be copying user preferences');
                throw new Error('Activity description must be from the actual listing, not generated from user preferences');
            }
            // Validate provider
            if (!response.provider || response.provider.length < 3) {
                console.warn('[VacationBudgetAgent] Missing or invalid provider:', response.provider);
                throw new Error('Activity must include a valid provider name from the listing');
            }
            // Validate highlights
            if (!Array.isArray(response.highlights) || response.highlights.length === 0) {
                console.warn('[VacationBudgetAgent] Missing highlights array');
                throw new Error('Activity must include at least one highlight from the listing');
            }
            // Validate price format and range
            const parsePriceString = (priceStr) => {
                if (typeof priceStr === 'number')
                    return priceStr;
                // Remove any currency symbols and whitespace
                const numericStr = priceStr.toString().replace(/[^0-9.]/g, '').trim();
                const parsed = parseFloat(numericStr);
                if (isNaN(parsed) || parsed <= 0) {
                    throw new Error(`Invalid price format: ${priceStr}`);
                }
                return parsed;
            };
            let parsedPrice;
            try {
                parsedPrice = parsePriceString(response.price);
                console.log('[VacationBudgetAgent] Parsed price:', {
                    original: response.price,
                    parsed: parsedPrice
                });
            }
            catch (error) {
                console.warn('[VacationBudgetAgent] Price parsing error:', {
                    price: response.price,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                throw new Error('Generated activity must include a valid positive price');
            }
            // Validate price matches tier
            const minPrice = params.tier === 'budget' ? 0 : params.tier === 'medium' ? 30 : 90;
            const maxPrice = params.tier === 'budget' ? 30 : params.tier === 'medium' ? 90 : 1000;
            // Additional validation for medium and premium tiers
            if (params.tier === 'medium' && parsedPrice < 30) {
                console.warn('[VacationBudgetAgent] Price too low for medium tier:', {
                    price: parsedPrice,
                    minimumRequired: 30
                });
                throw new Error(`Price ${parsedPrice} is too low for medium tier (minimum $30 required)`);
            }
            if (params.tier === 'premium' && parsedPrice < 90) {
                console.warn('[VacationBudgetAgent] Price too low for premium tier:', {
                    price: parsedPrice,
                    minimumRequired: 90
                });
                throw new Error(`Price ${parsedPrice} is too low for premium tier (minimum $90 required)`);
            }
            if (parsedPrice < minPrice || parsedPrice > maxPrice) {
                console.warn('[VacationBudgetAgent] Price does not match tier:', {
                    price: parsedPrice,
                    tier: params.tier,
                    expectedRange: `${minPrice}-${maxPrice}`
                });
                throw new Error(`Price ${parsedPrice} does not match ${params.tier} tier range (${minPrice}-${maxPrice})`);
            }
            // Log successful price validation
            console.log('[VacationBudgetAgent] Price validation passed:', {
                price: parsedPrice,
                tier: params.tier,
                range: `${minPrice}-${maxPrice}`
            });
            // Transform the activity into the expected format
            const activity = {
                id: `${params.dayNumber}-${params.timeSlot}-${Date.now()}`,
                name: response.name,
                description: response.description,
                duration: response.duration,
                price: {
                    amount: parsedPrice,
                    currency: params.currency || 'USD'
                },
                location: response.location,
                rating: response.rating,
                category: params.category || response.category || 'Undefined',
                timeSlot: params.timeSlot,
                dayNumber: params.dayNumber,
                startTime: params.timeSlot === 'morning' ? '09:00' :
                    params.timeSlot === 'afternoon' ? '14:00' :
                        params.timeSlot === 'evening' ? '19:00' : '12:00',
                tier: params.tier,
                suggestedOption: true,
                referenceUrl: response.referenceUrl,
                provider: response.provider,
                highlights: response.highlights || []
            };
            console.log('[VacationBudgetAgent] Successfully generated activity:', {
                id: activity.id,
                name: activity.name,
                price: activity.price,
                referenceUrl: activity.referenceUrl,
                provider: activity.provider
            });
            return activity;
        }
        catch (error) {
            console.error('[VacationBudgetAgent] Error generating single activity:', {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
}
//# sourceMappingURL=agents.js.map