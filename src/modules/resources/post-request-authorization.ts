import { hash } from '../authority/authority-policy';
import type { SpendGrant } from '../authority/spend-grant';
import type { HttpResourceRequest, X402Resource } from './http-resource';

export class ResourcePostApprovalError extends Error {
  readonly code = 'RESOURCE_POST_APPROVAL_REQUIRED';
  constructor() { super('RESOURCE_POST_APPROVAL_REQUIRED'); }
}

/** Immutable resource scope: future valid POST instances are explicitly delegated by the user. */
export function postRequestPolicyHash(resource: X402Resource) {
  return hash({ resourceId: resource.resourceId, providerId: resource.providerId,
    request: resource.request, requestInputs: resource.requestInputs ?? null });
}

/** No network, signing or spending. The native confirmation shows this actual request. */
export function postRequestReview(request: HttpResourceRequest, resource?: X402Resource) {
  const policyHash = resource ? postRequestPolicyHash(resource) : null;
  return { request, requestHash: hash({ request, policyHash }),
    requestInputs: resource?.requestInputs ?? null, paymentSent: false };
}

/** Only a caller behind authenticated management may supply this approval argument. */
export function assertPostRequestApproval(request: HttpResourceRequest, approvedHash?: string, resource?: X402Resource) {
  if (request.method === 'POST' && approvedHash !== postRequestReview(request, resource).requestHash)
    throw new ResourcePostApprovalError();
}

export function assertGrantPostScope(resource: X402Resource, grant: SpendGrant | undefined, now = Date.now()) {
  if (resource.request.method === 'POST' && (!grant || grant.status !== 'ACTIVE' || grant.expiresAt <= now
    || grant.resourceId !== resource.resourceId || grant.postPolicyHash !== postRequestPolicyHash(resource)))
    throw new ResourcePostApprovalError();
}
