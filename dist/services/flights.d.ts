export interface FlightSearchParams {
    origin: string;
    destination: string;
    departureDate: string;
    returnDate?: string;
    adults?: number;
    currency?: string;
    travelClass?: string;
}
export interface FlightSearchResult {
    success: boolean;
    data?: any;
    error?: string;
}
export declare class FlightService {
    private amadeusService;
    constructor();
    searchFlights(params: FlightSearchParams): Promise<FlightSearchResult>;
    getFlightDetails(flightId: string): Promise<FlightSearchResult>;
}
