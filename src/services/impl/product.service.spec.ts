import {
	describe, it, expect, beforeEach,
	afterEach,
} from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { type INotificationService } from '../notifications.port.js';
import { createDatabaseMock, cleanUp } from '../../utils/test-utils/database-tools.ts.js';
import { ProductService } from './product.service.js';
import { products, type Product } from '@/db/schema.js';
import { type Database } from '@/db/type.js';
import { DAY_MS } from '@/utils/date.utils.js';

// ADDED: helper function to add days to a date (used for seasonal/expiry tests)
const addDays = (base: Date, days: number) =>
	new Date(base.getTime() + days * DAY_MS);

describe("ProductService Tests", () => {
	let notificationServiceMock: DeepMockProxy<INotificationService>;
	let productService: ProductService;
	let databaseMock: Database;
	let databaseName: string;
	let closeDatabase: () => void;

	beforeEach(async () => {
		({
			databaseMock,
			databaseName,
			close: closeDatabase,
		} = await createDatabaseMock());

		notificationServiceMock = mockDeep<INotificationService>();

		productService = new ProductService({
			ns: notificationServiceMock,
			db: databaseMock,
		});
	});

	afterEach(async () => {
		closeDatabase();

		await cleanUp(databaseName);
	});

	it("should handle delay notification correctly", async () => {
		// GIVEN
		const product: Product = {
			id: 1,
			leadTime: 15,
			available: 0,
			type: "NORMAL",
			name: "RJ45 Cable",
			expiryDate: null,
			seasonStartDate: null,
			seasonEndDate: null,
		};

		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.notifyDelay(product.leadTime, product);

		// THEN

		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(
			product.leadTime,
			product.name,
		);

		// FIX: previously the query compared product.id with itself
		// which always returns true. Now we filter by the expected id.
		const result = await databaseMock.query.products.findFirst({
			where: (p, { eq }) => eq(p.id, 1),
		});

		expect(result).toEqual(product);
	});

	// ADDED TEST
	// Seasonal product should be unavailable if the season has not started yet
	it('SEASONAL: should notify out-of-stock if season not started yet', async () => {
		const now = new Date();

		const product: Product = {
			id: 2,
			leadTime: 5,
			available: 10,
			type: 'SEASONAL',
			name: 'Watermelon',
			expiryDate: null,

			// season starts in the future -> considered unavailable by current behavior
			seasonStartDate: addDays(now, 10),
			seasonEndDate: addDays(now, 40),
		};

		await databaseMock.insert(products).values(product);

		// WHEN
		await (productService as any).handleSeasonalProduct(product);

		// THEN
		expect(notificationServiceMock.sendOutOfStockNotification)
			.toHaveBeenCalledWith(product.name);

		const result = await databaseMock.query.products.findFirst({
			where: (p, { eq }) => eq(p.id, 2),
		});

		// NOTE: current implementation keeps stock unchanged in this scenario.
		// We assert current behavior to avoid regression during refactor.
		expect(result?.available).toBe(10);
	});

	// ADDED TEST
	// Restock date happens after season end → product unavailable
	it("SEASONAL: should notify out-of-stock if restock exceeds season end", async () => {
		const now = new Date();

		const product: Product = {
			id: 3,
			leadTime: 10,
			available: 0,
			type: "SEASONAL",
			name: "Strawberries",
			expiryDate: null,

			// season already started
			seasonStartDate: addDays(now, -5),

			// restock will exceed season end
			seasonEndDate: addDays(now, 5),
		};

		await databaseMock.insert(products).values(product);

		await (productService as any).handleSeasonalProduct(product);

		expect(
			notificationServiceMock.sendOutOfStockNotification,
		).toHaveBeenCalledWith(product.name);

		const result = await databaseMock.query.products.findFirst({
			where: (p, { eq }) => eq(p.id, 3),
		});

		expect(result?.available).toBe(0);
	});

	// ADDED TEST
	// Seasonal product with restock inside the season should notify delay
	it("SEASONAL: should send delay notification if restock is within season", async () => {
		const now = new Date();

		const product: Product = {
			id: 4,
			leadTime: 3,
			available: 0,
			type: "SEASONAL",
			name: "Cherries",
			expiryDate: null,

			seasonStartDate: addDays(now, -5),
			seasonEndDate: addDays(now, 20),
		};

		await databaseMock.insert(products).values(product);

		await (productService as any).handleSeasonalProduct(product);

		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(
			product.leadTime,
			product.name,
		);
	});

	// ADDED TEST
	// Expired product should trigger expiration notification
	it("EXPIRABLE: should notify expiration and set available to 0 if expired", async () => {
		const now = new Date();

		const product: Product = {
			id: 5,
			leadTime: 0,
			available: 7,
			type: "EXPIRABLE",
			name: "Milk",

			// expiry date already passed
			expiryDate: addDays(now, -1),

			seasonStartDate: null,
			seasonEndDate: null,
		};

		await databaseMock.insert(products).values(product);

		await (productService as any).handleExpiredProduct(product);

		expect(
			notificationServiceMock.sendExpirationNotification,
		).toHaveBeenCalledWith(product.name, product.expiryDate);

		const result = await databaseMock.query.products.findFirst({
			where: (p, { eq }) => eq(p.id, 5),
		});

		expect(result?.available).toBe(0);
	});

	// ADDED TEST
	// Non-expired product should decrement available stock
	it("EXPIRABLE: should decrement available if not expired and in stock", async () => {
		const now = new Date();

		const product: Product = {
			id: 6,
			leadTime: 0,
			available: 2,
			type: "EXPIRABLE",
			name: "Yogurt",

			// expiry date in the future
			expiryDate: addDays(now, 10),

			seasonStartDate: null,
			seasonEndDate: null,
		};

		await databaseMock.insert(products).values(product);

		await (productService as any).handleExpiredProduct(product);

		expect(
			notificationServiceMock.sendExpirationNotification,
		).not.toHaveBeenCalled();

		const result = await databaseMock.query.products.findFirst({
			where: (p, { eq }) => eq(p.id, 6),
		});

		expect(result?.available).toBe(1);
	});
});
