declare module 'amadeus' {
  interface AmadeusClient {
    get(params: any): Promise<any>;
    post(params: any): Promise<any>;
  }

  interface AmadeusShoppingFlightOffersSearchPricing {
    post(params: any): Promise<any>;
  }

  interface AmadeusShoppingFlightOffersSearch {
    get(params: any): Promise<any>;
    post(params: any): Promise<any>;
    pricing: AmadeusShoppingFlightOffersSearchPricing;
  }

  interface AmadeusShoppingHotelOffers {
    get(params: any): Promise<any>;
  }

  interface AmadeusShopping {
    flightOffersSearch: AmadeusShoppingFlightOffersSearch;
    hotelOffers: AmadeusShoppingHotelOffers;
  }

  interface AmadeusReferenceDataLocations {
    get(params: any): Promise<any>;
  }

  interface AmadeusReferenceData {
    locations: AmadeusReferenceDataLocations;
  }

  interface AmadeusOptions {
    clientId: string;
    clientSecret: string;
    hostname?: string;
  }

  class Amadeus {
    constructor(options: AmadeusOptions);
    shopping: AmadeusShopping;
    referenceData: AmadeusReferenceData;
  }

  export = Amadeus;
} 