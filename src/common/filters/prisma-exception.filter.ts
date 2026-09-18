import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
}

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(
    exception: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();

    if (exception.code === 'P2002') {
      const error = new ConflictException('A record with these values exists');
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }

    if (exception.code === 'P2025') {
      const error = new NotFoundException('Record not found');
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }

    response.status(500).json({
      statusCode: 500,
      message: 'Database operation failed',
      error: 'Internal Server Error',
    });
  }
}
