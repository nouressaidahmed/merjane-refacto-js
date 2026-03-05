import { type Cradle } from '@fastify/awilix';
import { eq } from 'drizzle-orm';
import { type INotificationService } from '../notifications.port.js';
import { products, type Product } from '@/db/schema.js';
import { type Database } from '@/db/type.js';
import { getRestockDate } from '@/utils/date.utils.js';

export class ProductService {
	private readonly ns: INotificationService;
	private readonly db: Database;

	public constructor({ ns, db }: Pick<Cradle, 'ns' | 'db'>) {
		this.ns = ns;
		this.db = db;
	}

	// <<-- Helpers -->>
	// ADDED: helper to centralize database updates for products
	private async updateProduct(p: Product) {
		await this.db.update(products)
			.set(p)
			.where(eq(products.id, p.id));
	}


	public async notifyDelay(leadTime: number, p: Product): Promise<void> {
		p.leadTime = leadTime;
		// Replace direct database update with helper function to reduce code duplication and improve maintainability
		// await this.db.update(products).set(p).where(eq(products.id, p.id));
		await this.updateProduct(p);
		this.ns.sendDelayNotification(leadTime, p.name);
	}

	public async handleSeasonalProduct(p: Product): Promise<void> {
		const currentDate = new Date();

		// Calculate restock date based on lead time and current date, and compare with season end date to determine if out of stock notification is needed
		const restockDate = getRestockDate(p.leadTime,currentDate);
		if (restockDate > p.seasonEndDate!) {
			this.ns.sendOutOfStockNotification(p.name);
			p.available = 0;
			// Replace direct database update with helper function to reduce code duplication and improve maintainability
			// await this.db.update(products).set(p).where(eq(products.id, p.id));
			await this.updateProduct(p);
		} else
			if (p.seasonStartDate! > currentDate) {
				this.ns.sendOutOfStockNotification(p.name);
				// Replace direct database update with helper function to reduce code duplication and improve maintainability
				// await this.db.update(products).set(p).where(eq(products.id, p.id));
				await this.updateProduct(p);
			} else {
				await this.notifyDelay(p.leadTime, p);
			}
	}

	public async handleExpiredProduct(p: Product): Promise<void> {
		const currentDate = new Date();
		// Optimised: optimise condidition check 
		const notExpired = p.expiryDate! > currentDate;

		if (p.available > 0 && notExpired) {
			p.available -= 1;
			// Replace direct database update with helper function to reduce code duplication and improve maintainability
			// await this.db.update(products).set(p).where(eq(products.id, p.id));
			await this.updateProduct(p);
		} else {
			// BUSINESS RULE:
			// When a product is expired we notify customers and mark it unavailable.
			this.ns.sendExpirationNotification(p.name, p.expiryDate!);
			p.available = 0;
			// Replace direct database update with helper function to reduce code duplication and improve maintainability
			// await this.db.update(products).set(p).where(eq(products.id, p.id));
			await this.updateProduct(p);
		}
	}

	// ADDED: single entry point for product processing (used by controller)
	public async processProduct(p: Product): Promise<void> {
		switch (p.type) {
			case 'NORMAL': {
				if (p.available > 0) {
					p.available -= 1;
					await this.updateProduct(p);
				} else if (p.leadTime > 0) {
					await this.notifyDelay(p.leadTime, p);
				}
				return;
			}

			case 'SEASONAL': {
				const now = new Date();

				// keep current behavior: if within season and in stock => decrement, else delegate
				if (now > p.seasonStartDate! && now < p.seasonEndDate! && p.available > 0) {
					p.available -= 1;
					await this.updateProduct(p);
				} else {
					await this.handleSeasonalProduct(p);
				}
				return;
			}

			case 'EXPIRABLE': {
				const now = new Date();

				// keep current behavior: if not expired and in stock => decrement, else delegate
				if (p.available > 0 && p.expiryDate! > now) {
					p.available -= 1;
					await this.updateProduct(p);
				} else {
					await this.handleExpiredProduct(p);
				}
				return;
			}
		}
	}
}
