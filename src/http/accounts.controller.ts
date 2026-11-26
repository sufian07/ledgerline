import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { LedgerService, type EntryResult } from "../ledger/ledger.service.js";
import { idempotencyKey, moveBody, openAccountBody, pageQuery } from "./schemas.js";

@Controller("v1")
export class AccountsController {
  constructor(private readonly ledger: LedgerService) {}

  @Post("accounts")
  openAccount(@Body() body: unknown) {
    return this.ledger.openAccount(openAccountBody.parse(body).code);
  }

  @Get("accounts")
  listAccounts(@Query() query: unknown) {
    return this.ledger.listAccounts(pageQuery.parse(query));
  }

  @Get("accounts/:accountId")
  getAccount(@Param("accountId") accountId: string) {
    return this.ledger.getAccount(accountId);
  }

  @Get("accounts/:accountId/entries")
  listEntries(@Param("accountId") accountId: string, @Query() query: unknown) {
    return this.ledger.listEntries(accountId, pageQuery.parse(query));
  }

  @Get("entries/:entryId")
  getEntry(@Param("entryId") entryId: string) {
    return this.ledger.getEntry(entryId);
  }

  @Post("accounts/:accountId/purchases")
  @HttpCode(201)
  async purchase(
    @Param("accountId") accountId: string,
    @Headers("idempotency-key") key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = moveBody.parse(body);
    return replayAware(res, await this.ledger.purchase({ accountId, idempotencyKey: idempotencyKey.parse(key), ...input }));
  }

  @Post("accounts/:accountId/spends")
  @HttpCode(201)
  async spend(
    @Param("accountId") accountId: string,
    @Headers("idempotency-key") key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = moveBody.parse(body);
    return replayAware(res, await this.ledger.spend({ accountId, idempotencyKey: idempotencyKey.parse(key), ...input }));
  }

  @Post("purchases/:purchaseId/refunds")
  @HttpCode(201)
  async refund(
    @Param("purchaseId") purchaseId: string,
    @Headers("idempotency-key") key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = moveBody.parse(body);
    return replayAware(res, await this.ledger.refund({ purchaseId, idempotencyKey: idempotencyKey.parse(key), ...input }));
  }

  @Get("ledger/verify")
  verify() {
    return this.ledger.verify();
  }
}

// A repeated request gets the original result with 200 and a header, rather than 201.
function replayAware(res: Response, result: EntryResult) {
  if (result.replayed) {
    res.status(200);
    res.setHeader("Idempotent-Replayed", "true");
  }
  return { entry: result.entry, balance: result.balance };
}
