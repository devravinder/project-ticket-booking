import { Body, Controller, Delete, Get, Inject, Param, Post } from "@nestjs/common";
import { parse } from "@tix/kit";
import { z } from "zod";
import { ShowsRepository } from "./shows.repository.js";

export const showIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "invalid show id");

const createShowSchema = z.object({
  id: showIdSchema,
  movieId: z.string().min(1),
  screenId: z.string().min(1),
  startsAt: z.iso
    .datetime({ offset: true })
    .default(() => new Date(Date.now() + 86_400_000).toISOString()),
  regularCents: z.number().int().positive().default(20000),
  premiumCents: z.number().int().positive().default(35000),
});

@Controller()
export class ShowsController {
  constructor(@Inject(ShowsRepository) private readonly shows: ShowsRepository) {}

  @Get("shows")
  list() {
    return this.shows.list();
  }

  @Get("shows/:id")
  detail(@Param("id") id: string) {
    return this.shows.detail(parse(showIdSchema, id));
  }

  @Post("admin/shows")
  create(@Body() body: unknown) {
    return this.shows.create(parse(createShowSchema, body));
  }

  // Tests clean up after themselves; seats, holds and bookings go with the show.
  @Delete("admin/shows/:id")
  async remove(@Param("id") id: string) {
    return { deleted: await this.shows.remove(parse(showIdSchema, id)) };
  }
}
