import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt-payload';
import { ContractorsService } from './contractors.service';
import { CreateConnectAccountDto } from './dto/create-connect-account.dto';

interface AuthenticatedRequest {
  user: JwtPayload;
}

@ApiTags('contractors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contractors/connect')
export class ContractorsController {
  constructor(private readonly contractors: ContractorsService) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Stripe Express connected account created or reused',
  })
  connect(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateConnectAccountDto,
  ) {
    return this.contractors.connect(
      request.user.sub,
      request.user.email,
      dto.country,
    );
  }

  @Get('status')
  @ApiOkResponse({ description: 'Latest Stripe onboarding status' })
  status(@Req() request: AuthenticatedRequest) {
    return this.contractors.getStatus(request.user.sub);
  }

  @Get('onboarding-link')
  @ApiOkResponse({ description: 'Single-use Stripe-hosted KYC URL' })
  onboardingLink(@Req() request: AuthenticatedRequest) {
    return this.contractors.createOnboardingLink(request.user.sub);
  }
}
