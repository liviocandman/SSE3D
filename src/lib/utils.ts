import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
};

/**
 * Parses a NASA/SPICE or ISO timestamp string into milliseconds.
 * Ensures UTC consistency.
 */
export function parseTimestampMs(timestamp: string): number {
  if (!timestamp) return NaN;
  const trimmed = timestamp.trim();
  
  // 1. ISO-ish format: YYYY-MM-DD ...
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const utcString = trimmed.includes('Z') ? trimmed : `${trimmed}Z`;
    return new Date(utcString).getTime();
  }

  // 2. NASA/SPICE format: YYYY-Mon-DD HH:mm:ss.sss
  const nasaMatch = trimmed.match(/^(\d{4})-([A-Za-z]{3})-(\d{2})(?:\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?))?/);
  if (nasaMatch) {
    const year = nasaMatch[1];
    const mon = nasaMatch[2];
    const day = nasaMatch[3];
    const time = nasaMatch[4] ?? '00:00:00';
    const month = MONTHS[mon[0].toUpperCase() + mon.slice(1).toLowerCase()];
    if (month) {
      return new Date(`${year}-${month}-${day}T${time}Z`).getTime();
    }
  }

  // Fallback to native (risky for NASA formats in some browsers)
  const fallback = new Date(trimmed);
  return fallback.getTime();
}
