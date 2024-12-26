export interface Airport {
  value: string;
  label: string;
}

export const airports: Airport[] = [
  { value: 'JFK', label: 'New York (JFK)' },
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
  { value: 'EWR', label: 'Newark (EWR)' }
]; 