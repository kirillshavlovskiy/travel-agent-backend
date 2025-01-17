export interface TransformedHotelOffer {
  id: string;
  name: string;
  location: string;
  price: {
    amount: number;
    currency: string;
  };
  type: string;
  amenities: string;
  rating: number;
  reviewScore: number;
  reviewCount: number;
  images: string[];
  referenceUrl: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  features: string[];
  policies: {
    checkIn: string;
    checkOut: string;
    cancellation: string;
  };
  tier: 'budget' | 'medium' | 'premium';
}

export interface AmadeusHotelOffer {
  id: string;
  hotel: {
    hotelId: string;
    name: string;
    rating?: string;
    description?: {
      text: string;
      lang: string;
    };
    amenities?: string[];
    media?: {
      uri: string;
      category: string;
    }[];
    latitude?: string;
    longitude?: string;
    address?: {
      cityName: string;
    };
  };
  offers?: {
    id: string;
    self: string;
    price: {
      total: string;
      currency: string;
    };
    policies?: {
      checkInTime?: string;
      checkOutTime?: string;
      cancellation?: {
        description?: {
          text: string;
        };
      };
    };
  }[];
}

export interface AmadeusHotelSearchParams {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  roomQuantity: number;
  currency?: string;
  radius?: number;
  ratings?: string;
}

export interface Activity {
  id?: string;
  name: string;
  description: string;
  duration: number;
  price: {
    amount: number;
    currency: string;
  };
  category: string;
  location: string;
  address: string;
  keyHighlights: string[];
  openingHours: string;
  rating: number;
  numberOfReviews: number;
  preferredTimeOfDay: 'morning' | 'afternoon' | 'evening';
  referenceUrl: string;
  images: string[];
  timeSlot?: string;
  dayNumber?: number;
  tier?: string;
} 