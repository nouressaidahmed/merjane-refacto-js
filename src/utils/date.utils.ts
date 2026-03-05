// src/utils/date.utils.ts

// ADDED: constant representing one day in milliseconds
export const DAY_MS = 24 * 60 * 60 * 1000;

// ADDED: helper to add days to a date
export function addDays(base: Date, days: number): Date {
	return new Date(base.getTime() + days * DAY_MS);
}

// ADDED: helper to subtract days from a date
export function subtractDays(base: Date, days: number): Date {
	return new Date(base.getTime() - days * DAY_MS);
}

// ADDED: helper to check if a date is expired
export function isExpired(expiryDate: Date, now: Date = new Date()): boolean {
	return expiryDate <= now;
}

// ADDED: helper to compute restock date
export function getRestockDate(leadTime: number, now: Date = new Date()): Date {
	return addDays(now, leadTime);
}