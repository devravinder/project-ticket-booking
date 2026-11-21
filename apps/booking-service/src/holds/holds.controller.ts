import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, Query } from "@nestjs/common";
import { MAX_SEATS_PER_HOLD } from "@tix/contracts";
import { parse, USER_HEADER, userSchema } from "@tix/kit";
import { z } from "zod";
import { showIdSchema } from "../shows/shows.controller.js";
import { HoldsService } from "./holds.service.js";

const holdSchema = z.object({
  seats: z
    .array(z.string().regex(/^[A-Z][0-9]{1,2}$/, "seat numbers look like A1 or H12"))
    .min(1)
    .max(MAX_SEATS_PER_HOLD, `at most ${MAX_SEATS_PER_HOLD} seats per hold`),
});

@Controller()
export class HoldsController {
  constructor(@Inject(HoldsService) private readonly holds: HoldsService) {}

  @Post("shows/:id/holds")
  hold(@Param("id") id: string, @Headers(USER_HEADER) user: unknown, @Body() body: unknown) {
    const { seats } = parse(holdSchema, body);
    return this.holds.hold(parse(showIdSchema, id), parse(userSchema, user), seats);
  }

  @Get("holds")
  mine(@Headers(USER_HEADER) user: unknown, @Query("showId") showId?: string) {
    return this.holds.live(
      parse(userSchema, user),
      showId === undefined ? undefined : parse(showIdSchema, showId),
    );
  }

  @Get("holds/:id")
  get(@Param("id") id: string) {
    return this.holds.get(parse(z.uuid(), id));
  }

  @Delete("holds/:id")
  release(@Param("id") id: string, @Headers(USER_HEADER) user: unknown) {
    return this.holds.release(parse(z.uuid(), id), parse(userSchema, user));
  }
}
