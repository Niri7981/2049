import { ResourcePostApprovalError } from '../resources/post-request-authorization';
import { ResourceRegistryError } from '../resources/runtime-resource-registry';
import { ManagementApiError } from './management-auth';
export async function resourceManagement<T>(operation: () => T | Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Error && ['RESOURCE_REQUEST_INPUT_REQUIRED', 'RESOURCE_REQUEST_INPUT_INVALID',
      'RESOURCE_REQUEST_INPUT_UNSUPPORTED', 'RESOURCE_BODY_POLICY_INVALID', 'RESOURCE_QUERY_POLICY_INVALID'].includes(error.message))
      throw new ManagementApiError(error.message, 400, 'The request must satisfy the registered input policy.');
    if (error instanceof ResourcePostApprovalError) throw new ManagementApiError(error.code, 409, 'Review and explicitly approve the exact POST request in Yosh before sending it.');
    if (error instanceof ResourceRegistryError) throw new ManagementApiError(error.code,
      error.code === 'RESOURCE_NOT_FOUND' ? 404 : error.code === 'RESOURCE_DISCOVERY_UNAVAILABLE' ? 422 : 409,
      { RESOURCE_REGISTRY_FULL: 'Disable an API before registering another (256 active APIs maximum).', RESOURCE_NOT_FOUND: 'Registered API not found.', RESOURCE_READ_ONLY: 'Built-in APIs are read-only.',
        RESOURCE_REMOVED: 'This API has been removed.', RESOURCE_ID_EXISTS: 'This resource ID is already reserved.',
        RESOURCE_DISCOVERY_UNAVAILABLE: 'No supported Mainnet USDC challenge could be safely retrieved.' }[error.code] ?? 'The resource change was rejected.');
    throw error;
  }
}
