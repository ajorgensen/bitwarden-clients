import { ApiService } from "../../abstractions/api.service";
import { CryptoService } from "../../abstractions/crypto.service";
import { CryptoFunctionService } from "../../abstractions/cryptoFunction.service";
import { LogService } from "../../abstractions/log.service";
import { StateService } from "../../abstractions/state.service";
import { OrganizationService } from "../../admin-console/abstractions/organization/organization.service.abstraction";
import { OrganizationUserType } from "../../admin-console/enums";
import { Utils } from "../../misc/utils";
import { SymmetricCryptoKey } from "../../models/domain/symmetric-crypto-key";
import { KeysRequest } from "../../models/request/keys.request";
import { KeyConnectorService as KeyConnectorServiceAbstraction } from "../abstractions/key-connector.service";
import { TokenService } from "../abstractions/token.service";
import { KdfConfig } from "../models/domain/kdf-config";
import { KeyConnectorUserKeyRequest } from "../models/request/key-connector-user-key.request";
import { SetKeyConnectorKeyRequest } from "../models/request/set-key-connector-key.request";
import { IdentityTokenResponse } from "../models/response/identity-token.response";

export class KeyConnectorService implements KeyConnectorServiceAbstraction {
  constructor(
    private stateService: StateService,
    private cryptoService: CryptoService,
    private apiService: ApiService,
    private tokenService: TokenService,
    private logService: LogService,
    private organizationService: OrganizationService,
    private cryptoFunctionService: CryptoFunctionService,
    private logoutCallback: (expired: boolean, userId?: string) => void
  ) {}

  setUsesKeyConnector(usesKeyConnector: boolean) {
    return this.stateService.setUsesKeyConnector(usesKeyConnector);
  }

  async getUsesKeyConnector(): Promise<boolean> {
    return await this.stateService.getUsesKeyConnector();
  }

  async userNeedsMigration() {
    const loggedInUsingSso = await this.tokenService.getIsExternal();
    const requiredByOrganization = (await this.getManagingOrganization()) != null;
    const userIsNotUsingKeyConnector = !(await this.getUsesKeyConnector());

    return loggedInUsingSso && requiredByOrganization && userIsNotUsingKeyConnector;
  }

  async migrateUser() {
    const organization = await this.getManagingOrganization();
    const key = await this.cryptoService.getKey();
    const keyConnectorRequest = new KeyConnectorUserKeyRequest(key.encKeyB64);

    try {
      await this.apiService.postUserKeyToKeyConnector(
        organization.keyConnectorUrl,
        keyConnectorRequest
      );
    } catch (e) {
      this.handleKeyConnectorError(e);
    }

    await this.apiService.postConvertToKeyConnector();
  }

  async getAndSetKey(url: string) {
    try {
      const userKeyResponse = await this.apiService.getUserKeyFromKeyConnector(url);
      const keyArr = Utils.fromB64ToArray(userKeyResponse.key);
      const k = new SymmetricCryptoKey(keyArr);
      await this.cryptoService.setKey(k);
    } catch (e) {
      this.handleKeyConnectorError(e);
    }
  }

  async getManagingOrganization() {
    const orgs = await this.organizationService.getAll();
    return orgs.find(
      (o) =>
        o.keyConnectorEnabled &&
        o.type !== OrganizationUserType.Admin &&
        o.type !== OrganizationUserType.Owner &&
        !o.isProviderUser
    );
  }

  async convertNewSsoUserToKeyConnector(tokenResponse: IdentityTokenResponse, orgId: string) {
    const { kdf, kdfIterations, kdfMemory, kdfParallelism, keyConnectorUrl } = tokenResponse;
    const password = await this.cryptoFunctionService.randomBytes(64);
    const kdfConfig = new KdfConfig(kdfIterations, kdfMemory, kdfParallelism);

    const k = await this.cryptoService.makeKey(
      Utils.fromBufferToB64(password),
      await this.tokenService.getEmail(),
      kdf,
      kdfConfig
    );
    const keyConnectorRequest = new KeyConnectorUserKeyRequest(k.encKeyB64);
    await this.cryptoService.setKey(k);

    const encKey = await this.cryptoService.makeEncKey(k);
    await this.cryptoService.setEncKey(encKey[1].encryptedString);

    const [pubKey, privKey] = await this.cryptoService.makeKeyPair();

    try {
      await this.apiService.postUserKeyToKeyConnector(keyConnectorUrl, keyConnectorRequest);
    } catch (e) {
      this.handleKeyConnectorError(e);
    }

    const keys = new KeysRequest(pubKey, privKey.encryptedString);
    const setPasswordRequest = new SetKeyConnectorKeyRequest(
      encKey[1].encryptedString,
      kdf,
      kdfConfig,
      orgId,
      keys
    );
    await this.apiService.postSetKeyConnectorKey(setPasswordRequest);
  }

  async setConvertAccountRequired(status: boolean) {
    await this.stateService.setConvertAccountToKeyConnector(status);
  }

  async getConvertAccountRequired(): Promise<boolean> {
    return await this.stateService.getConvertAccountToKeyConnector();
  }

  async removeConvertAccountRequired() {
    await this.stateService.setConvertAccountToKeyConnector(null);
  }

  async clear() {
    await this.removeConvertAccountRequired();
  }

  private handleKeyConnectorError(e: any) {
    this.logService.error(e);
    if (this.logoutCallback != null) {
      this.logoutCallback(false);
    }
    throw new Error("Key Connector error");
  }
}
