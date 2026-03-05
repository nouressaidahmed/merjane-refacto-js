import {
	describe, it, expect, beforeEach,
	afterEach,
} from 'vitest';
import { type FastifyInstance } from 'fastify';
import supertest from 'supertest';
import { eq } from 'drizzle-orm';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';
import { asValue } from 'awilix';
import { type INotificationService } from '@/services/notifications.port.js';
import {
	type ProductInsert,
	products,
	orders,
	ordersToProducts,
} from '@/db/schema.js';
import { type Database } from '@/db/type.js';
import { buildFastify } from '@/fastify.js';
import { addDays, subtractDays } from '@/utils/date.utils.js';

describe('MyController Integration Tests', () => {
	let fastify: FastifyInstance;
	let database: Database;
	let notificationServiceMock: DeepMockProxy<INotificationService>;

	beforeEach(async () => {
		notificationServiceMock = mockDeep<INotificationService>();

		fastify = await buildFastify();
		fastify.diContainer.register({
			ns: asValue(notificationServiceMock as INotificationService),
		});
		await fastify.ready();
		database = fastify.database;
	});

	afterEach(async () => {
		await fastify.close();
	});

	it('ProcessOrderShouldReturn', async () => {
		const client = supertest(fastify.server);
		const allProducts = createProducts();

		const orderId = database.transaction(tx => {
			const productList = tx
				.insert(products)
				.values(allProducts)
				.returning({ productId: products.id })
				.all();

			const order = tx
				.insert(orders)
				.values([{}])
				.returning({ orderId: orders.id })
				.get();

			tx
				.insert(ordersToProducts)
				.values(productList.map(p => ({
					orderId: order!.orderId,
					productId: p.productId,
				})))
				.run();

			return order!.orderId;
		});

		await client
			.post(`/orders/${orderId}/processOrder`)
			.expect(200)
			.expect('Content-Type', /application\/json/);

		// Existing assertion: order exists
		const resultOrder = await database.query.orders.findFirst({
			where: eq(orders.id, orderId),
		});
		expect(resultOrder!.id).toBe(orderId);

		// ADDED: assert stock updates end-to-end for simple stable cases
		const usbCable = await database.query.products.findFirst({
			where: (p, { eq }) => eq(p.name, 'USB Cable'),
		});
		expect(usbCable?.available).toBe(29); // 30 -> 29 (decrement)

		const usbDongle = await database.query.products.findFirst({
			where: (p, { eq }) => eq(p.name, 'USB Dongle'),
		});
		expect(usbDongle?.available).toBe(0); // stays 0

		// ADDED: assert notifications are triggered for business scenarios
		expect(notificationServiceMock.sendDelayNotification)
			.toHaveBeenCalledWith(10, 'USB Dongle');

		expect(notificationServiceMock.sendOutOfStockNotification)
			.toHaveBeenCalledWith('Grapes');

		// Expirable expired product should trigger expiration notification
		// (we assert product name + any Date to avoid flakiness)
		expect(notificationServiceMock.sendExpirationNotification)
			.toHaveBeenCalledWith('Milk', expect.any(Date));
	});

function createProducts(): ProductInsert[] {
	const now = new Date();

	return [
		{
			leadTime: 15,
			available: 30,
			type: 'NORMAL',
			name: 'USB Cable',
		},
		{
			leadTime: 10,
			available: 0,
			type: 'NORMAL',
			name: 'USB Dongle',
		},
		{
			leadTime: 15,
			available: 30,
			type: 'EXPIRABLE',
			name: 'Butter',

			// expires in 26 days
			expiryDate: addDays(now, 26),
		},
		{
			leadTime: 90,
			available: 6,
			type: 'EXPIRABLE',
			name: 'Milk',

			// expired 2 days ago
			expiryDate: subtractDays(now, 2),
		},
		{
			leadTime: 15,
			available: 30,
			type: 'SEASONAL',
			name: 'Watermelon',

			// season started 2 days ago
			seasonStartDate: subtractDays(now, 2),

			// season ends in 58 days
			seasonEndDate: addDays(now, 58),
		},
		{
			leadTime: 15,
			available: 30,
			type: 'SEASONAL',
			name: 'Grapes',

			// season starts in 180 days
			seasonStartDate: addDays(now, 180),

			// season ends in 240 days
			seasonEndDate: addDays(now, 240),
		},
	];
}
});