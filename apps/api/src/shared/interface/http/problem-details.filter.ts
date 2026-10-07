import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorCode, type ProblemDetails } from '@f4d/contracts';
import * as Sentry from '@sentry/nestjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '../../kernel/domain-error.js';
import { RequestValidationError } from './request-validation.error.js';

const DOMAIN_STATUS: Record<string, number> = {
  [ErrorCode.NotFound]: HttpStatus.NOT_FOUND,
  [ErrorCode.Conflict]: HttpStatus.CONFLICT,
  [ErrorCode.InvalidStateTransition]: HttpStatus.CONFLICT,
  [ErrorCode.Forbidden]: HttpStatus.FORBIDDEN,
};

const HTTP_CODE: Record<number, ErrorCode> = {
  400: ErrorCode.ValidationFailed,
  401: ErrorCode.Unauthenticated,
  403: ErrorCode.Forbidden,
  404: ErrorCode.NotFound,
  409: ErrorCode.Conflict,
  429: ErrorCode.RateLimited,
};

const TITLES: Record<number, string> = {
  400: 'Requisição inválida',
  401: 'Não autenticado',
  403: 'Acesso negado',
  404: 'Recurso não encontrado',
  409: 'Conflito',
  422: 'Regra de negócio violada',
  429: 'Muitas requisições',
  500: 'Erro interno',
};

/**
 * Converte qualquer erro em Problem Details (RFC 9457). Erros 5xx nunca expõem detalhes internos
 * ao cliente; são logados e enviados ao Sentry com o requestId para correlação.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const problem = this.toProblem(exception);
    problem.instance = req.url;
    problem.requestId = String(req.id);

    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: req.id }, 'Erro não tratado');
      Sentry.captureException(exception, { tags: { requestId: String(req.id) } });
    }

    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .send(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof RequestValidationError) {
      return this.problem(
        400,
        ErrorCode.ValidationFailed,
        'Um ou mais campos são inválidos.',
        exception.issues,
      );
    }
    if (exception instanceof DomainError) {
      const status = DOMAIN_STATUS[exception.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
      const code = (Object.values(ErrorCode) as string[]).includes(exception.code)
        ? (exception.code as ErrorCode)
        : ErrorCode.InvalidStateTransition;
      return this.problem(status, code, exception.message);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status < 500) {
        return this.problem(
          status,
          HTTP_CODE[status] ?? ErrorCode.ValidationFailed,
          exception.message,
        );
      }
    }
    return this.problem(500, ErrorCode.Internal, 'Ocorreu um erro inesperado. Tente novamente.');
  }

  private problem(
    status: number,
    code: ErrorCode,
    detail: string,
    errors?: ProblemDetails['errors'],
  ): ProblemDetails {
    return {
      type: 'about:blank',
      title: TITLES[status] ?? 'Erro',
      status,
      code,
      detail,
      ...(errors ? { errors } : {}),
    };
  }
}
