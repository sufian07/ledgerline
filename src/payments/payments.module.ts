import { Module } from "@nestjs/common";
import { LedgerModule } from "../ledger/ledger.module.js";
import { PAYMENTS_CONFIG, paymentsConfigFromEnv } from "./payments.config.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { FETCH, StripeGateway } from "./stripe-gateway.js";

@Module({
  imports: [LedgerModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    StripeGateway,
    { provide: PAYMENTS_CONFIG, useFactory: () => paymentsConfigFromEnv() },
    { provide: FETCH, useValue: (url: string, init: RequestInit) => fetch(url, init) },
  ],
})
export class PaymentsModule {}
