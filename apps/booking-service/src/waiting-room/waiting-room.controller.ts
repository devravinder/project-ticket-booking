import { Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { parse, USER_HEADER, userSchema } from "@tix/kit";
import { showIdSchema } from "../shows/shows.controller.js";
import { WaitingRoom } from "./waiting-room.service.js";

@Controller()
export class WaitingRoomController {
  constructor(@Inject(WaitingRoom) private readonly room: WaitingRoom) {}

  @Post("shows/:id/queue")
  @HttpCode(200)
  join(@Param("id") id: string, @Headers(USER_HEADER) user: unknown) {
    return this.room.join(parse(showIdSchema, id), parse(userSchema, user));
  }

  @Get("shows/:id/queue/me")
  me(@Param("id") id: string, @Headers(USER_HEADER) user: unknown) {
    return this.room.me(parse(showIdSchema, id), parse(userSchema, user));
  }

  @Get("shows/:id/queue")
  stats(@Param("id") id: string) {
    return this.room.stats(parse(showIdSchema, id));
  }

  // Lab: empty the line and forget every admission for this show.
  @Delete("admin/shows/:id/queue")
  async reset(@Param("id") id: string) {
    await this.room.reset(parse(showIdSchema, id));
    return { reset: id };
  }
}
