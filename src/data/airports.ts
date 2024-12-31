export interface Airport {
  value: string;
  label: string;
  cityCode?: string;  // Reference to the city this airport serves
}

export const airports: Airport[] = [
  // North America
  { value: 'JFK', label: 'New York (JFK)', cityCode: 'NYC' },
  { value: 'LAX', label: 'Los Angeles (LAX)' },
  { value: 'ORD', label: 'Chicago (ORD)' },
  { value: 'SFO', label: 'San Francisco (SFO)' },
  { value: 'MIA', label: 'Miami (MIA)' },
  { value: 'DFW', label: 'Dallas/Fort Worth (DFW)' },
  { value: 'SEA', label: 'Seattle (SEA)' },
  { value: 'BOS', label: 'Boston (BOS)' },
  { value: 'LAS', label: 'Las Vegas (LAS)' },
  { value: 'ATL', label: 'Atlanta (ATL)' },
  { value: 'DEN', label: 'Denver (DEN)' },
  { value: 'IAH', label: 'Houston (IAH)' },
  { value: 'PHX', label: 'Phoenix (PHX)' },
  { value: 'MCO', label: 'Orlando (MCO)' },
  { value: 'EWR', label: 'Newark (EWR)', cityCode: 'NYC' },
  { value: 'YVR', label: 'Vancouver (YVR)' },

  // Europe
  { value: 'LHR', label: 'London Heathrow (LHR)', cityCode: 'LON' },
  { value: 'LGW', label: 'London Gatwick (LGW)', cityCode: 'LON' },
  { value: 'CDG', label: 'Paris Charles de Gaulle (CDG)', cityCode: 'PAR' },
  { value: 'ORY', label: 'Paris Orly (ORY)', cityCode: 'PAR' },
  { value: 'FCO', label: 'Rome Fiumicino (FCO)', cityCode: 'ROM' },
  { value: 'BCN', label: 'Barcelona (BCN)' },
  { value: 'AMS', label: 'Amsterdam Schiphol (AMS)' },
  { value: 'BER', label: 'Berlin Brandenburg (BER)' },
  { value: 'PRG', label: 'Prague Václav Havel (PRG)' },
  { value: 'VIE', label: 'Vienna International (VIE)' },
  { value: 'LIS', label: 'Lisbon Portela (LIS)' },
  { value: 'MAD', label: 'Madrid Barajas (MAD)' },
  { value: 'ATH', label: 'Athens International (ATH)' },

  // Middle East & Asia
  { value: 'DXB', label: 'Dubai International (DXB)' },
  { value: 'HND', label: 'Tokyo Haneda (HND)', cityCode: 'TYO' },
  { value: 'NRT', label: 'Tokyo Narita (NRT)', cityCode: 'TYO' },
  { value: 'SIN', label: 'Singapore Changi (SIN)' },

  // Australia
  { value: 'SYD', label: 'Sydney Kingsford Smith (SYD)' }
]; 