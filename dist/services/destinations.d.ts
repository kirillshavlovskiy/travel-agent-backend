interface Destination {
    code: string;
    label: string;
    cityCode?: string;
    country?: string;
    lastUpdated: Date;
    source: 'VIATOR' | 'AMADEUS' | 'STATIC';
}
export declare class DestinationsService {
    private viatorService;
    private amadeusService;
    private static instance;
    private lastUpdateTime;
    private readonly UPDATE_INTERVAL;
    private constructor();
    static getInstance(): DestinationsService;
    private shouldUpdate;
    private fetchViatorDestinations;
    private fetchAmadeusDestinations;
    updateDestinations(): Promise<void>;
    getDestinations(): Promise<Destination[]>;
}
export {};
