import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { DatabaseModule } from "./db/database.module.js";
import { AccountsController } from "./http/accounts.controller.js";
import { ApiKeyGuard } from "./http/api-key.guard.js";
import { ErrorsFilter } from "./http/errors.filter.js";
import { SystemController } from "./http/system.controller.js";
import { LedgerModule } from "./ledger/ledger.module.js";
import { PaymentsModule } from "./payments/payments.module.js";

@Module({
  imports: [DatabaseModule, LedgerModule, PaymentsModule],
  controllers: [AccountsController, SystemController],
  providers: [
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: ErrorsFilter },
  ],
})
export class AppModule {}
