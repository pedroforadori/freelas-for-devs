import { Controller } from '@nestjs/common';
import { apiRoutes, SETTINGS, type Setting } from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import {
  CurrentPrincipal,
  type Principal,
  RequestContext,
} from '../../../shared/interface/http/auth/principal.js';
import {
  type ContractRequest,
  ContractRoute,
  ValidRequest,
} from '../../../shared/interface/http/contract-route.js';
import { ListSettings, type SettingView, UpdateSetting } from '../application/use-cases.js';

const routes = apiRoutes.settings;

const toDto = (setting: SettingView): Setting => ({
  key: setting.key,
  value: setting.value,
  defaultValue: setting.defaultValue,
  label: SETTINGS[setting.key].label,
  description: SETTINGS[setting.key].description,
  usedFrom: SETTINGS[setting.key].usedFrom,
  version: setting.version,
  updatedAt: setting.updatedAt?.toISOString() ?? null,
  updatedBy: setting.updatedBy,
});

@Controller()
export class SettingsController {
  constructor(
    private readonly listSettings: ListSettings,
    private readonly updateSetting: UpdateSetting,
  ) {}

  @ContractRoute(routes.adminListSettings)
  async list(): Promise<{ items: Setting[] }> {
    return { items: (await this.listSettings.execute()).map(toDto) };
  }

  @ContractRoute(routes.adminUpdateSetting)
  async update(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminUpdateSetting>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<Setting> {
    return toDto(await this.updateSetting.execute(principal.userId, params.key, body, meta));
  }
}
