/**
 * UK-specific type definitions for city-data-mcp
 */

/** UK Local Authority District config */
export interface UkCityConfig {
  name: string;
  ladCode: string;       // GSS code e.g. "E09000001"
  region: string;        // e.g. "London", "North West"
  country: string;       // "England" | "Wales" | "Scotland" | "Northern Ireland"
  population: number;
  lat: number;
  lon: number;
  aliases: string[];
  postcode?: string;     // Representative postcode for the city centre
}

export type UkCityRegistry = Record<string, UkCityConfig>;

/** Resolved UK geography */
export interface UkGeoResolution {
  input: string;
  city: string;
  ladCode: string;
  ladName: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  postcode: string | null;
  cached: boolean;
}

/** Police UK crime result */
export interface UkCrimeResult {
  city: string;
  lat: number;
  lon: number;
  totalCrimes: number;
  month: string;
  categories: Record<string, number>;
  recentCrimes: Array<{
    category: string;
    location: string;
    month: string;
    outcome?: string;
  }>;
}

/** Environment Agency flood/water result */
export interface UkFloodWaterResult {
  city: string;
  stations: Array<{
    name: string;
    river: string;
    parameter: string;
    value: number;
    unit: string;
    dateTime: string;
    typicalHigh?: number;
    typicalLow?: number;
  }>;
  floodWarnings: Array<{
    severity: string;
    description: string;
    area: string;
    timeRaised: string;
  }>;
}

/** ONS demographics result */
export interface UkDemographicsResult {
  city: string;
  ladCode: string;
  population: number;
  medianAge?: number;
  medianEarnings?: number;
  households?: number;
  densityPerSqKm?: number;
  ethnicGroups?: Record<string, number>;
  deprivation?: {
    imdRank?: number;
    imdDecile?: number;
    domains?: Record<string, number>;
  };
}

/** UK economics result */
export interface UkEconomicsResult {
  city: string;
  claimantCount?: {
    rate: number;
    count: number;
    month: string;
  };
  medianEarnings?: {
    annual: number;
    weekly: number;
    year: string;
  };
  bankOfEngland?: {
    baseRate: number;
    cpiInflation: number;
    gdpGrowth?: number;
    housePrice?: {
      index: number;
      annualChange: number;
    };
  };
}

/** UK housing result */
export interface UkHousingResult {
  city: string;
  pricePaid?: {
    averagePrice: number;
    medianPrice: number;
    transactionCount: number;
    period: string;
    byType?: Record<string, number>;
  };
  rental?: {
    median: number;
    lowerQuartile: number;
    upperQuartile: number;
    byBedrooms?: Record<string, number>;
    period: string;
  };
}

/** UK schools result */
export interface UkSchoolsResult {
  city: string;
  totalSchools: number;
  byType: Record<string, number>;
  byOfsted: Record<string, number>;
  totalPupils: number;
  attainment?: {
    ks2?: { meetingExpected: number };
    ks4?: { averageAttainment8: number };
  };
}

/** UK planning result */
export interface UkPlanningResult {
  city: string;
  recentApplications: number;
  byDecision: Record<string, number>;
  byType: Record<string, number>;
  period: string;
}

/** UK weather result */
export interface UkWeatherResult {
  city: string;
  current?: {
    temperature: number;
    weatherType: string;
    humidity: number;
    windSpeed: number;
    windDirection: string;
    visibility: string;
    pressure: number;
  };
  forecast: Array<{
    date: string;
    dayMaxTemp: number;
    nightMinTemp: number;
    weatherType: string;
    precipitation: number;
    windSpeed: number;
  }>;
}

/** UK air quality result */
export interface UkAirQualityResult {
  city: string;
  daqi: number;          // 1-10 Daily Air Quality Index
  daqiBand: string;      // "Low" | "Moderate" | "High" | "Very High"
  pollutants: Array<{
    name: string;        // e.g. "PM2.5", "NO2", "O3"
    value: number;
    unit: string;
    index: number;
    band: string;
  }>;
  forecast?: Array<{
    date: string;
    daqi: number;
    band: string;
  }>;
}

/** UK transport result */
export interface UkTransportResult {
  city: string;
  tfl?: {
    lines: Array<{
      name: string;
      mode: string;
      status: string;
      reason?: string;
    }>;
  };
  bus?: {
    operators: number;
    routes: number;
  };
}

/** UK local gov finance result */
export interface UkLocalGovFinanceResult {
  city: string;
  ladCode: string;
  totalExpenditure?: number;
  perCapita?: number;
  councilTaxBandD?: number;
  byService?: Record<string, number>;
  year: string;
}

/** UK representatives result */
export interface UkRepresentativesResult {
  city: string;
  mp?: {
    name: string;
    party: string;
    constituency: string;
    enteredHouse: string;
  };
  councillors?: Array<{
    name: string;
    party: string;
    ward: string;
  }>;
}
