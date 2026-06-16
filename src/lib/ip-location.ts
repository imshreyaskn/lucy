// src/lib/ip-location.ts
export interface IPLocation {
  ip: string;
  city: string;
  region: string;
  country: string;
  country_name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export async function fetchUserLocation(): Promise<IPLocation | null> {
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch IP location', err);
    return null;
  }
}
