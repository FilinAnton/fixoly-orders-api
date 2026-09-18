import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus, WindowType } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Orders API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.order.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.order.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  it('registers, authenticates, and completes the order lifecycle', async () => {
    const registration = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'assessment@example.com',
        password: 'StrongPassword123!',
      })
      .expect(201);

    const token = registration.body.accessToken as string;
    expect(token).toEqual(expect.any(String));

    const created = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientName: 'Jane Smith',
        address: '42 King Street, Toronto, ON',
        windowType: WindowType.tilt_turn,
        width: 120.5,
        height: 140,
      })
      .expect(201);

    const orderId = created.body.id as string;
    expect(created.body.status).toBe(OrderStatus.new);

    const list = await request(app.getHttpServer())
      .get('/api/orders')
      .query({ status: OrderStatus.new, page: 1, limit: 10 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].id).toBe(orderId);

    await request(app.getHttpServer())
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: OrderStatus.in_progress })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe(OrderStatus.in_progress);
      });

    await request(app.getHttpServer())
      .delete(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
