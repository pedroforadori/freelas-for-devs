import { Controller, Get, NotFoundException, Inject } from '@nestjs/common';
import { buildOpenApiDocument, type OpenApiDocument } from '@f4d/contracts/openapi';
import { SkipThrottle } from '@nestjs/throttler';
import { ENV } from '../../config/config.module.js';
import { Public } from './auth/principal.js';
import type { Env } from '../../config/env.js';

/** Expõe o OpenAPI fora de produção (em produção o arquivo é publicado pelo CI). */
@Public()
@SkipThrottle()
@Controller()
export class OpenApiController {
  private document: OpenApiDocument | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('/v1/openapi.json')
  openapi(): OpenApiDocument {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
    this.document ??= buildOpenApiDocument();
    return this.document;
  }
}
