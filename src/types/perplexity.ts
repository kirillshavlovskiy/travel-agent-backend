import { Activity } from './activities';

export interface PerplexityApiResponse {
  choices?: Array<{
    message?: {
      content: string;
    };
  }>;
}

export class PerplexityError extends Error {
  code: string;
  response?: any;

  constructor(message: string, code: string, response?: any) {
    super(message);
    this.name = 'PerplexityError';
    this.code = code;
    this.response = response;
  }
}

export interface PerplexityErrorResponse {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

export interface PerplexityRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PerplexityRequest {
  messages: PerplexityRequestMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface PerplexityRequestOptions {
  temperature?: number;
  max_tokens?: number;
  model?: string;
}

export interface PerplexityTripResponse {
  tripSummary: {
    overview: string;
    dailyThemes: Array<{
      dayNumber: number;
      theme: string;
      rationale: string;
    }>;
    flowLogic: {
      progression: string;
      locationStrategy: string;
      paceConsiderations: string;
    };
  };
}

export interface PerplexityActivityResponse {
  activities: Array<{
    name: string;
    description?: string;
    duration?: number;
    price?: {
      amount: number;
      currency: string;
    };
    category?: string;
    location?: string;
    timeSlot?: string;
    dayNumber?: number;
  }>;
}

export interface TravelPreferences {
    travelStyle: string;
    pacePreference: string;
    interests: string[];
    accessibility: string[];
    dietaryRestrictions: string[];
} 